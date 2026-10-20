import { Browser, BrowserContext, Page } from 'playwright';
import { BrowserProfileManager, ProfileOptions } from './profile-manager.js';
import { ChromeGuestLauncher } from './chrome-launcher.js';
import * as crypto from 'crypto';

export type BrowserOwnerType = 'AUTOMATION_OWNED' | 'OPERATOR_OWNED';

export interface BrowserLeaseOptions {
  taskId: string;
  runId: string;
  clientId: string;
  userId: string;
  ownerType: BrowserOwnerType;
  namespace?: 'interactive' | 'sync' | 'mutation';
  isHeaded?: boolean;
  viewport?: { width: number; height: number };
  slowMo?: number;
  timeoutMs?: number;
  existingContext?: BrowserContext;
  useGuestMode?: boolean;
  allowChromiumFallback?: boolean;
  allowMultipleTabs?: boolean;
}

export interface BrowserLease {
  taskId: string;
  runId: string;
  browserInstanceId: string;
  contextId: string;
  ownerType: BrowserOwnerType;
  browser?: Browser;
  context: BrowserContext;
  primaryPage: Page;
  signal: AbortSignal;
  createdAt: number;
  isClosed: boolean;
  launchArgs?: string[];
  executablePath?: string;
  isGuestMode?: boolean;
  allowMultipleTabs?: boolean;
  managedPages?: Set<Page>;
  createManagedPage?: () => Promise<Page>;
  detachInterceptors?: () => void;
  close: (options?: { reason?: string; force?: boolean }) => Promise<void>;
  abort: (reason?: string) => void;
}

export interface BrowserLifecycleTelemetry {
  taskId: string;
  runId: string;
  browserInstanceId: string;
  contextId: string;
  pageId: string;
  ownerType: BrowserOwnerType;
  createdAt: number;
  closedAt?: number;
  closeReason?: string;
  isGuestMode?: boolean;
}

export class BrowserLifecycleManager {
  private static instance: BrowserLifecycleManager;
  private activeLeases: Map<string, BrowserLease> = new Map();
  private telemetryLog: BrowserLifecycleTelemetry[] = [];

  public static getInstance(): BrowserLifecycleManager {
    if (!BrowserLifecycleManager.instance) {
      BrowserLifecycleManager.instance = new BrowserLifecycleManager();
    }
    return BrowserLifecycleManager.instance;
  }

  /**
   * Acquires a managed browser lease adhering to the One-Task = One-Context = One-Page rule.
   * If Guest Mode is requested or configured for visible automation, spawns an isolated Google Chrome instance.
   */
  public async acquireLease(options: BrowserLeaseOptions): Promise<BrowserLease> {
    const browserInstanceId = `inst_${crypto.randomUUID().slice(0, 8)}`;
    const contextId = `ctx_${crypto.randomUUID().slice(0, 8)}`;
    const pageId = `page_${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = Date.now();

    const abortController = new AbortController();
    let timeoutTimer: NodeJS.Timeout | null = null;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        abortController.abort(new Error(`TASK_TIMEOUT: Operation exceeded ${options.timeoutMs}ms limit.`));
      }, options.timeoutMs);
    }

    let browser: Browser | undefined;
    let context: BrowserContext;
    let primaryPage: Page;
    let launchArgs: string[] | undefined;
    let executablePath: string | undefined;
    let isGuestMode = false;

    if (options.existingContext) {
      context = options.existingContext;
    } else {
      const config = ChromeGuestLauncher.getLaunchConfiguration();
      const shouldUseGuest = options.useGuestMode !== undefined
        ? options.useGuestMode
        : (config.chromeGuest && (options.isHeaded || options.namespace === 'mutation' || options.namespace === 'interactive' || options.ownerType === 'AUTOMATION_OWNED'));

      if (shouldUseGuest) {
        try {
          const session = await ChromeGuestLauncher.launchGuestSession({
            headless: options.isHeaded !== undefined ? !options.isHeaded : config.headless,
            viewport: options.viewport,
            slowMo: options.slowMo,
            allowChromiumFallback: options.allowChromiumFallback,
          });
          browser = session.browser;
          context = session.context;
          primaryPage = session.page;
          launchArgs = session.launchArgs;
          executablePath = session.executablePath;
          isGuestMode = true;
        } catch (guestErr: any) {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          throw guestErr;
        }
      } else {
        const profileOptions: ProfileOptions = {
          clientId: options.clientId,
          userId: options.userId,
          isHeaded: options.isHeaded,
          namespace: options.namespace,
          viewport: options.viewport,
          slowMo: options.slowMo,
        };

        try {
          context = await BrowserProfileManager.launchPersistentContext(profileOptions);
        } catch (err: any) {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          throw err;
        }
      }
    }

    // Identify or create the exactly one primary page if not already returned from session
    if (!primaryPage!) {
      const existingPages = context.pages();
      if (existingPages.length > 0) {
        primaryPage = existingPages[0];
        for (let i = 1; i < existingPages.length; i++) {
          try {
            await existingPages[i].close();
          } catch {}
        }
      } else {
        primaryPage = await context.newPage();
      }
    }

    const isOperator =
      options.ownerType === 'OPERATOR_OWNED' ||
      options.taskId === 'OPEN_INTERACTIVE_CLIENT_SESSION' ||
      options.taskId === 'INTERACTIVE_LOGIN' ||
      options.taskId === 'OPEN_MULTIPLE_TABS_SESSION';

    const allowMultipleTabs = options.allowMultipleTabs === true || isOperator;
    const managedPages = new Set<Page>([primaryPage]);

    let pageHandler: ((newPage: Page) => Promise<void>) | undefined;
    let popupHandler: ((popupPage: Page) => Promise<void>) | undefined;

    // Only unattended, background automation tasks (AUTOMATION_OWNED) should intercept and close rogue popups.
    // Operator-owned interactive sessions MUST NEVER intercept, block, or close user-created or duplicated tabs!
    if (!allowMultipleTabs && options.ownerType === 'AUTOMATION_OWNED') {
      pageHandler = async (newPage: Page) => {
        try {
          await new Promise((r) => setTimeout(r, 100));
          const url = newPage.url();
          if (url === 'about:blank' || newPage !== primaryPage) {
            if (!primaryPage.isClosed()) {
              await newPage.close().catch(() => {});
            }
          }
        } catch {}
      };

      popupHandler = async (popupPage: Page) => {
        try {
          if (!popupPage.isClosed() && popupPage !== primaryPage) {
            await popupPage.close().catch(() => {});
          }
        } catch {}
      };

      context.on('page', pageHandler);
      primaryPage.on('popup', popupHandler);
    } else {
      context.on('page', (newPage: Page) => {
        managedPages.add(newPage);
        newPage.on('close', () => managedPages.delete(newPage));
      });
    }

    let isClosed = false;

    const lease: BrowserLease = {
      taskId: options.taskId,
      runId: options.runId,
      browserInstanceId,
      contextId,
      ownerType: options.ownerType,
      browser,
      context,
      primaryPage,
      signal: abortController.signal,
      createdAt,
      launchArgs,
      executablePath,
      isGuestMode,
      allowMultipleTabs,
      managedPages,
      createManagedPage: async () => {
        const p = await context.newPage();
        managedPages.add(p);
        p.on('close', () => managedPages.delete(p));
        return p;
      },
      detachInterceptors: () => {
        if (pageHandler) {
          try { context.off('page', pageHandler); } catch {}
          pageHandler = undefined;
        }
        if (popupHandler) {
          try { primaryPage.off('popup', popupHandler); } catch {}
          popupHandler = undefined;
        }
      },
      get isClosed() {
        return isClosed;
      },
      abort: (reason?: string) => {
        if (!abortController.signal.aborted) {
          abortController.abort(new Error(reason || 'ABORT_REQUESTED'));
        }
      },
      close: async (closeOpts?: { reason?: string; force?: boolean }) => {
        if (isClosed && !closeOpts?.force) return; // Idempotent unless forced teardown
        if (!isClosed) {
          isClosed = true;

          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
          }

          if (pageHandler) {
            try { context.off('page', pageHandler); } catch {}
            pageHandler = undefined;
          }
          if (popupHandler) {
            try { primaryPage.off('popup', popupHandler); } catch {}
            popupHandler = undefined;
          }

          const closedAt = Date.now();
          const closeReason = closeOpts?.reason || 'NORMAL_COMPLETION';

          this.telemetryLog.push({
            taskId: options.taskId,
            runId: options.runId,
            browserInstanceId,
            contextId,
            pageId,
            ownerType: options.ownerType,
            createdAt,
            closedAt,
            closeReason,
            isGuestMode,
          });

          this.activeLeases.delete(options.runId);

          // Close unexpected/extra pages ONLY for unattended background automation (AUTOMATION_OWNED).
          // Interactive operator-owned sessions must never close extra pages.
          if (!allowMultipleTabs && options.ownerType === 'AUTOMATION_OWNED') {
            try {
              const allPages = context.pages();
              for (const p of allPages) {
                if (p !== primaryPage && !p.isClosed()) {
                  await p.close().catch(() => {});
                }
              }
            } catch {}
          }
        }

        // Handle context and browser process closure according to ownership
        if (options.ownerType === 'AUTOMATION_OWNED' || closeOpts?.force) {
          try {
            if (!primaryPage.isClosed()) {
              await primaryPage.close().catch(() => {});
            }
            await context.close().catch(() => {});
            // Guaranteed closing of task-owned browser process without touching operator Chrome processes
            if (browser) {
              await browser.close().catch(() => {});
            }
          } catch {}
        }
      },
    };

    this.activeLeases.set(options.runId, lease);
    return lease;
  }

  /**
   * Closes all automation-owned active leases gracefully.
   * Preserves operator-owned sessions.
   */
  public async closeAllAutomationOwned(reason: string = 'AGENT_SHUTDOWN'): Promise<void> {
    const closePromises: Promise<void>[] = [];
    for (const lease of this.activeLeases.values()) {
      if (lease.ownerType === 'AUTOMATION_OWNED') {
        closePromises.push(lease.close({ reason }));
      }
    }
    await Promise.allSettled(closePromises);
  }

  public getLease(runId: string): BrowserLease | undefined {
    return this.activeLeases.get(runId);
  }

  public getActiveLeasesCount(ownerType?: BrowserOwnerType): number {
    if (!ownerType) return this.activeLeases.size;
    let count = 0;
    for (const l of this.activeLeases.values()) {
      if (l.ownerType === ownerType) count++;
    }
    return count;
  }

  public getActivePagesCount(ownerType?: BrowserOwnerType): number {
    let count = 0;
    for (const l of this.activeLeases.values()) {
      if (!ownerType || l.ownerType === ownerType) {
        count += l.context.pages().filter((p) => !p.isClosed()).length;
      }
    }
    return count;
  }

  public getActiveContextsCount(ownerType?: BrowserOwnerType): number {
    return this.getActiveLeasesCount(ownerType);
  }

  public getTelemetryLog(): BrowserLifecycleTelemetry[] {
    return [...this.telemetryLog];
  }

  public clearTelemetry(): void {
    this.telemetryLog = [];
  }
}
