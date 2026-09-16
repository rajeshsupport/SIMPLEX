import { BrowserContext, Page } from 'playwright';
import { BrowserProfileManager, ProfileOptions } from './profile-manager.js';
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
}

export interface BrowserLease {
  taskId: string;
  runId: string;
  browserInstanceId: string;
  contextId: string;
  ownerType: BrowserOwnerType;
  context: BrowserContext;
  primaryPage: Page;
  signal: AbortSignal;
  createdAt: number;
  isClosed: boolean;
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

    let context: BrowserContext;

    if (options.existingContext) {
      context = options.existingContext;
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

    // Identify or create the exactly one primary page
    const existingPages = context.pages();
    let primaryPage: Page;

    if (existingPages.length > 0) {
      primaryPage = existingPages[0];
      // Close any extraneous leftover pages immediately
      for (let i = 1; i < existingPages.length; i++) {
        try {
          await existingPages[i].close();
        } catch {}
      }
    } else {
      primaryPage = await context.newPage();
    }

    // Register popup and new-page interceptor to prevent multiple tabs or dangling blank pages
    const pageHandler = async (newPage: Page) => {
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

    const popupHandler = async (popupPage: Page) => {
      try {
        if (!popupPage.isClosed() && popupPage !== primaryPage) {
          await popupPage.close().catch(() => {});
        }
      } catch {}
    };

    context.on('page', pageHandler);
    primaryPage.on('popup', popupHandler);

    let isClosed = false;

    const lease: BrowserLease = {
      taskId: options.taskId,
      runId: options.runId,
      browserInstanceId,
      contextId,
      ownerType: options.ownerType,
      context,
      primaryPage,
      signal: abortController.signal,
      createdAt,
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

          context.off('page', pageHandler);
          primaryPage.off('popup', popupHandler);

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
          });

          this.activeLeases.delete(options.runId);

          // Close unexpected/extra pages
          try {
            const allPages = context.pages();
            for (const p of allPages) {
              if (p !== primaryPage && !p.isClosed()) {
                await p.close().catch(() => {});
              }
            }
          } catch {}
        }

        // Handle context closure according to ownership
        if (options.ownerType === 'AUTOMATION_OWNED' || closeOpts?.force) {
          try {
            if (!primaryPage.isClosed()) {
              await primaryPage.close().catch(() => {});
            }
            await context.close().catch(() => {});
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
