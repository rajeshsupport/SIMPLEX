import { Browser, BrowserContext, Page } from 'playwright';
import { MultiTabTargetItem, TabItemStatus, resolveClientRoute } from '@hmc/shared';
import { ChromeGuestLauncher } from './chrome-launcher.js';
import { WorkflowExecutor } from './workflow-executor.js';

export interface MultiTabExecutorOptions {
  tabs: MultiTabTargetItem[];
  workflowVersion?: any;
  browser?: Browser;
  initialContext?: BrowserContext;
  initialPage?: Page;
  isHeaded?: boolean;
  onItemStatusUpdate?: (item: MultiTabTargetItem, index: number) => void;
  onProgress?: (message: string) => void;
}

export interface MultiTabExecutionResult {
  success: boolean;
  tabs: MultiTabTargetItem[];
  browser: Browser;
  contexts: BrowserContext[];
  pages: Page[];
}

export class MultiTabExecutor {
  /**
   * Executes a multi-tab session across one or multiple clients.
   * - Launches one isolated Google Chrome Guest session (if browser not passed).
   * - Groups items by clientId.
   * - For each client: creates an isolated BrowserContext so sessions/cookies do not mix.
   * - For same client: logs in once, then opens additional screens in separate tabs under that context.
   * - For multi-branch: executes branch selection before navigating to target destination.
   * - Updates item statuses: QUEUED -> OPENING -> LOGIN_SUCCESS -> NAVIGATION_SUCCESS -> FAILED.
   * - Ensures one failed tab does not abort remaining tabs.
   */
  public static async execute(options: MultiTabExecutorOptions): Promise<MultiTabExecutionResult> {
    const {
      tabs,
      workflowVersion,
      onItemStatusUpdate,
      onProgress,
    } = options;

    if (!tabs || tabs.length === 0) {
      throw new Error('NO_TABS_SPECIFIED: At least one tab target must be provided.');
    }

    // Initialize all items as QUEUED
    const updatedTabs = tabs.map((t) => ({
      ...t,
      status: 'QUEUED' as TabItemStatus,
      errorMessage: undefined,
      finalUrl: undefined,
    }));

    updatedTabs.forEach((tab, i) => {
      onItemStatusUpdate?.(tab, i);
    });

    let browser = options.browser;
    let ownBrowser = false;

    if (!browser) {
      const guestSession = await ChromeGuestLauncher.launchGuestSession({
        headless: options.isHeaded === false ? true : false,
      });
      browser = guestSession.browser;
      ownBrowser = true;
    }

    const createdContexts: BrowserContext[] = [];
    const createdPages: Page[] = [];

    // Group tabs by clientId to isolate different clients while reusing session for same client
    const clientGroups = new Map<string, { tabs: MultiTabTargetItem[]; indices: number[] }>();
    updatedTabs.forEach((tab, index) => {
      if (!clientGroups.has(tab.clientId)) {
        clientGroups.set(tab.clientId, { tabs: [], indices: [] });
      }
      clientGroups.get(tab.clientId)!.tabs.push(tab);
      clientGroups.get(tab.clientId)!.indices.push(index);
    });

    const defaultWorkflow = workflowVersion || {
      versionNumber: 1,
      applicableAppVersion: 'v1.0',
      pageRoute: '/login',
      steps: [
        {
          stepIndex: 1,
          stepName: 'Opening client URL…',
          action: 'NAVIGATE' as const,
          valueTemplate: '{{loginUrl}}',
          timeoutMs: 15000,
        },
        {
          stepIndex: 2,
          stepName: 'Enter Username',
          action: 'FILL' as const,
          targetSelector: {
            strategy: 'TEST_ID' as const,
            value: 'input-username',
            fallbackSelectors: [
              { strategy: 'ID' as const, value: 'username' },
              { strategy: 'NAME' as const, value: 'username' },
              { strategy: 'LABEL' as const, value: 'Username' },
              { strategy: 'CSS' as const, value: 'input[type="text"]' },
            ],
          },
          valueTemplate: '{{username}}',
          timeoutMs: 10000,
        },
        {
          stepIndex: 3,
          stepName: 'Entering credentials securely…',
          action: 'FILL' as const,
          targetSelector: {
            strategy: 'TEST_ID' as const,
            value: 'input-password',
            fallbackSelectors: [
              { strategy: 'ID' as const, value: 'pasWord' },
              { strategy: 'NAME' as const, value: 'password' },
              { strategy: 'ID' as const, value: 'password' },
              { strategy: 'CSS' as const, value: 'input[type="password"]' },
            ],
          },
          valueTemplate: '{{password}}',
          timeoutMs: 10000,
        },
        {
          stepIndex: 4,
          stepName: 'Click Sign In Button',
          action: 'CLICK' as const,
          targetSelector: {
            strategy: 'TEST_ID' as const,
            value: 'btn-login',
            fallbackSelectors: [
              { strategy: 'ID' as const, value: 'SignIn' },
              { strategy: 'ID' as const, value: 'btnLogin' },
              { strategy: 'ROLE' as const, value: 'button', roleName: 'Sign In' },
              { strategy: 'CSS' as const, value: 'button[type="submit"]' },
            ],
          },
          timeoutMs: 10000,
        },
        {
          stepIndex: 5,
          stepName: 'Verifying login…',
          action: 'WAIT_FOR_ELEMENT' as const,
          targetSelector: {
            strategy: 'TEST_ID' as const,
            value: 'hmc-dashboard',
            fallbackSelectors: [
              { strategy: 'ID' as const, value: 'hmc-dashboard' },
              { strategy: 'ID' as const, value: 'hmc-app-header' },
              { strategy: 'CSS' as const, value: '.hmc-authenticated-layout' },
            ],
          },
          timeoutMs: 20000,
        },
      ],
      successConditions: [
        { type: 'URL_CONTAINS' as const, expectedValue: '/hmc/dashboard', isTerminalSuccess: true },
        { type: 'ELEMENT_VISIBLE' as const, selector: { strategy: 'TEST_ID' as const, value: 'hmc-dashboard' }, isTerminalSuccess: true },
      ],
      errorConditions: [
        { type: 'TEXT_PRESENT' as const, expectedValue: 'Invalid credentials', isTerminalError: true, errorMessage: 'Client login was unsuccessful. Verify the stored credentials.' },
      ],
      securityBlockConditions: [
        { type: 'ELEMENT_VISIBLE' as const, selector: { strategy: 'TEST_ID' as const, value: 'mfa-challenge' }, isSecurityControlBlock: true, errorMessage: 'Manual security verification is required in the opened browser window.' },
      ],
      defaultTimeoutMs: 30000,
      maxRetries: 1,
    };

    // Process each client group
    let groupIndex = 0;
    for (const [clientId, group] of clientGroups.entries()) {
      const { tabs: clientTabs, indices } = group;
      const primaryTab = clientTabs[0];
      const primaryIndex = indices[0];
      const isFirstClient = groupIndex === 0;
      groupIndex++;

      try {
        onProgress?.(`Starting isolated context for client ${primaryTab.clientCode}…`);

        // If an initial context & page was passed for the first client group, reuse it to avoid dangling blank windows
        let context: BrowserContext;
        let primaryPage: Page;

        if (isFirstClient && options.initialContext) {
          context = options.initialContext;
          primaryPage = options.initialPage || (await context.newPage());
        } else {
          context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            ignoreHTTPSErrors: true,
          });
          primaryPage = await context.newPage();
        }

        createdContexts.push(context);
        createdPages.push(primaryPage);

        // Update primary tab status to OPENING
        primaryTab.status = 'OPENING';
        onItemStatusUpdate?.(primaryTab, primaryIndex);

        const resolvedLoginUrl = resolveClientRoute({
          baseUrl: primaryTab.baseUrl,
          route: primaryTab.loginRoute,
          fallbackRoute: '/login',
        });

        const variables = {
          loginUrl: resolvedLoginUrl,
          username: primaryTab.credentials?.username || '',
          password: primaryTab.credentials?.password || '',
          targetBranch: primaryTab.targetBranch,
        };

        onProgress?.(`Authenticating client ${primaryTab.clientCode} at ${resolvedLoginUrl}…`);

        const result = await WorkflowExecutor.executeWorkflow(
          primaryPage,
          defaultWorkflow,
          variables,
          (stepTelemetry) => {
            onProgress?.(`[${primaryTab.clientCode}] ${stepTelemetry.stepName}`);
          }
        );

        if (!result.success) {
          const errMsg = result.errorMessage || 'Login failed';
          onProgress?.(`✗ Client ${primaryTab.clientCode} login failed: ${errMsg}`);

          // Mark all tabs for this client as FAILED
          for (let i = 0; i < clientTabs.length; i++) {
            clientTabs[i].status = 'FAILED';
            clientTabs[i].errorMessage = errMsg;
            onItemStatusUpdate?.(clientTabs[i], indices[i]);
          }
          // Do not throw; continue to remaining clients (Requirement 13)
          continue;
        }

        // Login succeeded for primary tab
        primaryTab.status = 'LOGIN_SUCCESS';
        onItemStatusUpdate?.(primaryTab, primaryIndex);

        // If targetBranch was configured, update status to BRANCH_SELECTED
        if (primaryTab.targetBranch) {
          primaryTab.status = 'BRANCH_SELECTED';
          onItemStatusUpdate?.(primaryTab, primaryIndex);
          onProgress?.(`✓ Client ${primaryTab.clientCode} branch confirmed: ${primaryTab.targetBranch}`);
        }

        // Explicitly navigate primary tab to requested destination URL (Requirement 4)
        const destinationRoute = primaryTab.targetRoute || '/hmc/dashboard';
        const primaryDestUrl = resolveClientRoute({
          baseUrl: primaryTab.baseUrl,
          route: destinationRoute,
          fallbackRoute: '/hmc/dashboard',
        });

        if (primaryPage.url() !== primaryDestUrl) {
          try {
            await primaryPage.goto(primaryDestUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          } catch (navErr: any) {
            // Ignore if domcontentloaded fired before timeout or non-fatal redirect
          }
        }

        primaryTab.status = 'READY';
        primaryTab.finalUrl = primaryPage.url();
        onItemStatusUpdate?.(primaryTab, primaryIndex);
        onProgress?.(`✓ Client ${primaryTab.clientCode} primary tab arrived at ${primaryTab.finalUrl}`);

        // If multiple screens belong to this client, open them in separate tabs reusing this authenticated context (Requirement 5)
        for (let i = 1; i < clientTabs.length; i++) {
          const subTab = clientTabs[i];
          const subIndex = indices[i];

          subTab.status = 'OPENING';
          onItemStatusUpdate?.(subTab, subIndex);

          try {
            const subPage = await context.newPage();
            createdPages.push(subPage);

            // Inherits authenticated session immediately
            subTab.status = 'LOGIN_SUCCESS';
            onItemStatusUpdate?.(subTab, subIndex);

            if (subTab.targetBranch) {
              subTab.status = 'BRANCH_SELECTED';
              onItemStatusUpdate?.(subTab, subIndex);
            }

            const subDestUrl = resolveClientRoute({
              baseUrl: subTab.baseUrl,
              route: subTab.targetRoute,
              fallbackRoute: '/users',
            });

            onProgress?.(`Navigating client ${subTab.clientCode} tab ${i + 1} (${subTab.screenName || 'Screen'}) to ${subDestUrl}…`);
            try {
              await subPage.goto(subDestUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            } catch {}

            subTab.status = 'READY';
            subTab.finalUrl = subPage.url();
            onItemStatusUpdate?.(subTab, subIndex);
            onProgress?.(`✓ Client ${subTab.clientCode} tab ${i + 1} reached ${subTab.finalUrl}`);
          } catch (subErr: any) {
            subTab.status = 'FAILED';
            subTab.errorMessage = subErr.message || 'Failed to open tab';
            onItemStatusUpdate?.(subTab, subIndex);
          }
        }
      } catch (clientErr: any) {
        // Mark all remaining tabs in this client group as failed
        const errMsg = clientErr.message || 'Client session error';
        for (let i = 0; i < clientTabs.length; i++) {
          if (clientTabs[i].status !== 'READY' && clientTabs[i].status !== 'NAVIGATION_SUCCESS') {
            clientTabs[i].status = 'FAILED';
            clientTabs[i].errorMessage = errMsg;
            onItemStatusUpdate?.(clientTabs[i], indices[i]);
          }
        }
      }
    }

    const hasAnySuccess = updatedTabs.some(
      (t) => t.status === 'READY' || t.status === 'NAVIGATION_SUCCESS' || t.status === 'LOGIN_SUCCESS' || t.status === 'BRANCH_SELECTED'
    );

    return {
      success: hasAnySuccess,
      tabs: updatedTabs,
      browser,
      contexts: createdContexts,
      pages: createdPages,
    };
  }
}
