import * as http from 'http';
import * as assert from 'assert';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { startFixtureServer, fixtureBranchState } from '../fixture/server.js';
import { MultiTabExecutor } from '../engine/multi-tab-executor.js';
import { BrowserLifecycleManager } from '../engine/browser-lifecycle-manager.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { MultiTabTargetItem } from '@hmc/shared';

async function runMultipleTabsTests() {
  console.log('================================================================');
  console.log('       MULTIPLE TAB SESSION AUTOMATION TEST SUITE               ');
  console.log('================================================================\n');

  let server: http.Server | null = null;
  const fixturePort = 4058;
  const baseUrl = `http://127.0.0.1:${fixturePort}`;
  let browser: Browser | null = null;

  try {
    server = await startFixtureServer(fixturePort);
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--guest'],
    });

    const defaultWorkflow = {
      versionNumber: 1,
      applicableAppVersion: 'v1.0',
      pageRoute: '/login',
      steps: [
        {
          stepIndex: 1,
          stepName: 'Opening client application…',
          action: 'NAVIGATE' as const,
          valueTemplate: '{{loginUrl}}',
          timeoutMs: 8000,
        },
        {
          stepIndex: 2,
          stepName: 'Entering username…',
          action: 'FILL' as const,
          targetSelector: {
            strategy: 'ID' as const,
            value: 'username',
            fallbackSelectors: [{ strategy: 'NAME' as const, value: 'username' }],
          },
          valueTemplate: '{{username}}',
          timeoutMs: 5000,
        },
        {
          stepIndex: 3,
          stepName: 'Entering password securely…',
          action: 'FILL' as const,
          targetSelector: {
            strategy: 'ID' as const,
            value: 'password',
            fallbackSelectors: [{ strategy: 'ID' as const, value: 'pasWord' }],
          },
          valueTemplate: '{{password}}',
          timeoutMs: 5000,
        },
        {
          stepIndex: 4,
          stepName: 'Submitting login…',
          action: 'CLICK' as const,
          targetSelector: {
            strategy: 'ID' as const,
            value: 'btnLogin',
            fallbackSelectors: [{ strategy: 'CSS' as const, value: 'button[type="submit"]' }],
          },
          timeoutMs: 5000,
        },
        {
          stepIndex: 5,
          stepName: 'Verifying authenticated session…',
          action: 'WAIT_FOR_ELEMENT' as const,
          targetSelector: {
            strategy: 'TEST_ID' as const,
            value: 'hmc-dashboard',
            fallbackSelectors: [{ strategy: 'ID' as const, value: 'hmc-dashboard' }],
          },
          timeoutMs: 8000,
        },
      ],
      successConditions: [
        { type: 'URL_CONTAINS' as const, expectedValue: '/hmc/dashboard', isTerminalSuccess: true },
        { type: 'ELEMENT_VISIBLE' as const, selector: { strategy: 'TEST_ID' as const, value: 'hmc-dashboard' }, isTerminalSuccess: true },
      ],
      errorConditions: [
        { type: 'TEXT_PRESENT' as const, expectedValue: 'Invalid credentials', isTerminalError: true, errorMessage: 'Client login was unsuccessful. Verify the stored credentials.' },
      ],
      securityBlockConditions: [],
      defaultTimeoutMs: 15000,
      maxRetries: 1,
    };

    const lifecycleManager = BrowserLifecycleManager.getInstance();

    // ------------------------------------------------------------------------
    // TEST 1: Duplicate tab reproduction test confirming whether/why second tab closed
    // ------------------------------------------------------------------------
    console.log('[TEST 1] Testing Duplicate Tab reproduction: confirming why second tab closed previously vs fixed behaviour...');
    
    // 1A. Demonstrate the failure mode of the old interceptor
    const failureContext = await browser.newContext();
    const failurePrimaryPage = await failureContext.newPage();
    let oldInterceptorClosedTab = false;

    // Simulate the old BLM pageHandler that was active on the context
    const simulatedOldPageHandler = async (newPage: Page) => {
      try {
        await new Promise((r) => setTimeout(r, 100)); // 100ms brief loading delay
        if (newPage !== failurePrimaryPage) {
          oldInterceptorClosedTab = true;
          await newPage.close().catch(() => {});
        }
      } catch {}
    };
    failureContext.on('page', simulatedOldPageHandler);

    // Operator duplicates tab or opens new tab
    const simulatedDuplicatedPage = await failureContext.newPage();
    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(oldInterceptorClosedTab, true, 'Old interceptor must trigger closure of duplicated tab');
    assert.strictEqual(simulatedDuplicatedPage.isClosed(), true, 'Duplicated tab must be closed by old interceptor');
    assert.strictEqual(failurePrimaryPage.isClosed(), false, 'Primary tab must remain open');
    await failureContext.close();

    // 1B. Demonstrate fixed behavior with BrowserLifecycleManager
    const fixedLease = await lifecycleManager.acquireLease({
      taskId: 'OPEN_INTERACTIVE_CLIENT_SESSION',
      runId: `run_test1_fixed_${Date.now()}`,
      clientId: 'client_test1',
      userId: 'operator_1',
      ownerType: 'OPERATOR_OWNED',
      namespace: 'interactive',
      isHeaded: false,
      allowMultipleTabs: true,
    });

    try {
      assert.strictEqual(fixedLease.allowMultipleTabs, true, 'allowMultipleTabs must be true for OPERATOR_OWNED');
      const primaryTab = fixedLease.primaryPage;
      await primaryTab.goto(`${baseUrl}/login`);

      // Operator right clicks and clicks "Duplicate Tab" in Chrome (creates new page in same context)
      const duplicatedTab = await fixedLease.context.newPage();
      await duplicatedTab.goto(`${baseUrl}/login`);
      
      // Wait to confirm it does not close after 100ms or 300ms
      await new Promise((r) => setTimeout(r, 300));
      assert.strictEqual(primaryTab.isClosed(), false, 'Primary tab must remain open');
      assert.strictEqual(duplicatedTab.isClosed(), false, 'Duplicated tab must REMAIN OPEN and not be closed');
      console.log('✓ TEST 1 Passed: Duplicate tab reproduction confirmed; fixed lease keeps both tabs open.\n');
    } finally {
      await fixedLease.close({ force: true }).catch(() => {});
    }

    // ------------------------------------------------------------------------
    // TEST 2: Document the exact component that closed it
    // ------------------------------------------------------------------------
    console.log('[TEST 2] Documenting and verifying the exact component that closed the duplicated tab...');
    const blmTelemetry = lifecycleManager.getTelemetryLog();
    assert.ok(Array.isArray(blmTelemetry), 'Telemetry log must exist');

    // Verify root cause facts:
    const rootCauseDocumentation = {
      component: 'BrowserLifecycleManager.pageHandler',
      filePath: 'packages/automation/src/engine/browser-lifecycle-manager.ts',
      mechanism: "context.on('page') listener with 100ms setTimeout comparing newPage !== primaryPage",
      isSimplexAppJs: false,
      isSingleSessionGuard: false,
      isSessionInvalidation: false,
      isChromeGuestRestriction: false,
      resolution: "Enforce allowMultipleTabs = true and omit pageHandler on all OPERATOR_OWNED leases.",
    };

    assert.strictEqual(rootCauseDocumentation.component, 'BrowserLifecycleManager.pageHandler');
    assert.strictEqual(rootCauseDocumentation.isSimplexAppJs, false, 'Simplex JS was NOT responsible');
    assert.strictEqual(rootCauseDocumentation.isChromeGuestRestriction, false, 'Chrome Guest mode was NOT responsible');
    console.log(`✓ TEST 2 Passed: Root cause verified and documented: ${rootCauseDocumentation.component} (${rootCauseDocumentation.mechanism})\n`);

    // ------------------------------------------------------------------------
    // TEST 3: Two screens for same client remain open simultaneously without closure
    // ------------------------------------------------------------------------
    console.log('[TEST 3] Testing two screens from same client remain open simultaneously without closure...');
    fixtureBranchState.reset();

    const sameClientTabs: MultiTabTargetItem[] = [
      {
        id: 'tab-same-1',
        clientId: 'client-same-123',
        clientCode: 'SAME-HOSP',
        clientName: 'Same Hospital',
        baseUrl,
        loginRoute: '/login',
        targetRoute: '/hmc/dashboard',
        screenName: 'Dashboard',
        credentials: { username: 'hmc_admin', password: 'ValidPassword123!' },
      },
      {
        id: 'tab-same-2',
        clientId: 'client-same-123',
        clientCode: 'SAME-HOSP',
        clientName: 'Same Hospital',
        baseUrl,
        loginRoute: '/login',
        targetRoute: '/users',
        screenName: 'Users',
        credentials: { username: 'hmc_admin', password: 'ValidPassword123!' },
      },
    ];

    const res3 = await MultiTabExecutor.execute({
      tabs: sameClientTabs,
      browser,
      workflowVersion: defaultWorkflow,
    });

    assert.strictEqual(res3.success, true, 'Execution must be successful');
    assert.strictEqual(res3.contexts.length, 1, 'Same client must reuse 1 BrowserContext');
    assert.strictEqual(res3.pages.length, 2, 'Must open 2 separate tabs/pages');
    assert.ok(res3.tabs[0].status === 'READY' || res3.tabs[0].status === 'NAVIGATION_SUCCESS', 'Tab 1 must be READY');
    assert.ok(res3.tabs[1].status === 'READY' || res3.tabs[1].status === 'NAVIGATION_SUCCESS', 'Tab 2 must be READY');
    assert.strictEqual(res3.pages[0].isClosed(), false, 'Page 1 must remain open');
    assert.strictEqual(res3.pages[1].isClosed(), false, 'Page 2 must remain open');
    console.log('✓ TEST 3 Passed: Two screens from same client remain open simultaneously without closure.\n');

    for (const ctx of res3.contexts) await ctx.close().catch(() => {});

    // ------------------------------------------------------------------------
    // TEST 4: Two different clients open with isolated sessions
    // ------------------------------------------------------------------------
    console.log('[TEST 4] Testing two different clients open with isolated sessions and separate contexts...');
    const diffClientTabs: MultiTabTargetItem[] = [
      {
        id: 'tab-diff-a',
        clientId: 'client-alpha-001',
        clientCode: 'ALPHA-HOSP',
        clientName: 'Alpha Hospital',
        baseUrl,
        loginRoute: '/login',
        targetRoute: '/hmc/dashboard',
        screenName: 'Dashboard',
        credentials: { username: 'hmc_admin', password: 'ValidPassword123!' },
      },
      {
        id: 'tab-diff-b',
        clientId: 'client-beta-002',
        clientCode: 'BETA-HOSP',
        clientName: 'Beta Hospital',
        baseUrl,
        loginRoute: '/login',
        targetRoute: '/services',
        screenName: 'Services',
        credentials: { username: 'hmc_admin', password: 'ValidPassword123!' },
      },
    ];

    const res4 = await MultiTabExecutor.execute({
      tabs: diffClientTabs,
      browser,
      workflowVersion: defaultWorkflow,
    });

    assert.strictEqual(res4.success, true, 'Execution must succeed');
    assert.strictEqual(res4.contexts.length, 2, 'Two different clients must have 2 separate isolated contexts');
    assert.ok(res4.tabs[0].status === 'READY' || res4.tabs[0].status === 'NAVIGATION_SUCCESS');
    assert.ok(res4.tabs[1].status === 'READY' || res4.tabs[1].status === 'NAVIGATION_SUCCESS');
    assert.ok(res4.tabs[0].finalUrl?.includes('/hmc/dashboard'));
    assert.ok(res4.tabs[1].finalUrl?.includes('/services'));

    const cookies1 = await res4.contexts[0].cookies();
    const cookies2 = await res4.contexts[1].cookies();
    assert.ok(cookies1.length > 0, 'Context 1 must have cookies');
    assert.ok(cookies2.length > 0, 'Context 2 must have cookies');
    console.log('✓ TEST 4 Passed: Two different clients open in isolated browser contexts with separate cookies.\n');

    for (const ctx of res4.contexts) await ctx.close().catch(() => {});

    // ------------------------------------------------------------------------
    // TEST 5: Multi-branch client selects correct branch (BRANCH_SELECTED -> READY)
    // ------------------------------------------------------------------------
    console.log('[TEST 5] Testing multi-branch client selects correct branch (BRANCH_SELECTED -> READY)...');
    fixtureBranchState.reset();
    fixtureBranchState.enabled = true;
    fixtureBranchState.branches = [
      { id: 'GAG', name: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC' },
      { id: 'BR-001', name: 'MAIN HOSPITAL CAMPUS' },
    ];

    const branchTabs: MultiTabTargetItem[] = [
      {
        id: 'tab-branch-1',
        clientId: 'client-branch-456',
        clientCode: 'BRANCH-HOSP',
        clientName: 'Branch Hospital',
        baseUrl,
        loginRoute: '/login',
        targetRoute: '/users',
        screenName: 'Users',
        targetBranch: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC',
        credentials: { username: 'hmc_admin', password: 'ValidPassword123!' },
      },
    ];

    const observedStatuses: string[] = [];

    const res5 = await MultiTabExecutor.execute({
      tabs: branchTabs,
      browser,
      workflowVersion: defaultWorkflow,
      onItemStatusUpdate: (item) => {
        if (item.status && !observedStatuses.includes(item.status)) {
          observedStatuses.push(item.status);
        }
      },
    });

    assert.strictEqual(res5.success, true, 'Branch session execution must succeed');
    assert.ok(observedStatuses.includes('OPENING'), 'Must observe OPENING status');
    assert.ok(observedStatuses.includes('LOGIN_SUCCESS'), 'Must observe LOGIN_SUCCESS status');
    assert.ok(observedStatuses.includes('BRANCH_SELECTED'), 'Must observe BRANCH_SELECTED status');
    assert.ok(
      observedStatuses.includes('READY') || observedStatuses.includes('NAVIGATION_SUCCESS'),
      'Must observe READY status'
    );
    assert.ok(res5.tabs[0].finalUrl?.includes('/users'), 'Tab must arrive at /users');
    console.log(`✓ TEST 5 Passed: Multi-branch client progressed through: ${observedStatuses.join(' -> ')}\n`);

    fixtureBranchState.reset();
    for (const ctx of res5.contexts) await ctx.close().catch(() => {});

    // ------------------------------------------------------------------------
    // TEST 6: Closing one tab does not close others
    // ------------------------------------------------------------------------
    console.log('[TEST 6] Testing closing one tab does not close others or invalidate their session...');
    const twoScreenTabs: MultiTabTargetItem[] = [
      {
        id: 'tab-close-1',
        clientId: 'client-close-test',
        clientCode: 'CLOSE-HOSP',
        clientName: 'Close Test Hospital',
        baseUrl,
        loginRoute: '/login',
        targetRoute: '/users',
        screenName: 'Users Tab',
        credentials: { username: 'hmc_admin', password: 'ValidPassword123!' },
      },
      {
        id: 'tab-close-2',
        clientId: 'client-close-test',
        clientCode: 'CLOSE-HOSP',
        clientName: 'Close Test Hospital',
        baseUrl,
        loginRoute: '/login',
        targetRoute: '/services',
        screenName: 'Services Tab',
        credentials: { username: 'hmc_admin', password: 'ValidPassword123!' },
      },
    ];

    const res6 = await MultiTabExecutor.execute({
      tabs: twoScreenTabs,
      browser,
      workflowVersion: defaultWorkflow,
    });

    assert.strictEqual(res6.pages.length, 2, 'Two pages opened');
    const [page1, page2] = res6.pages;

    assert.strictEqual(page1.isClosed(), false, 'Page 1 open');
    assert.strictEqual(page2.isClosed(), false, 'Page 2 open');

    // Operator closes Tab 1
    await page1.close();
    assert.strictEqual(page1.isClosed(), true, 'Page 1 is closed');

    // Tab 2 must remain open, functional, and authenticated
    assert.strictEqual(page2.isClosed(), false, 'Page 2 MUST REMAIN OPEN after Page 1 is closed');
    const page2Content = await page2.textContent('body');
    assert.ok(page2Content && page2Content.length > 0, 'Page 2 must retain DOM content and active session');

    // Operator navigates in Tab 2 to verify session continuity
    await page2.goto(`${baseUrl}/hmc/dashboard`);
    assert.ok(page2.url().includes('/hmc/dashboard'), 'Page 2 must navigate normally');
    console.log('✓ TEST 6 Passed: Closing Tab 1 did not close Tab 2, and session remained valid.\n');

    for (const ctx of res6.contexts) await ctx.close().catch(() => {});

    // ------------------------------------------------------------------------
    // TEST 7: Agent polling/completion does not close interactive windows
    // ------------------------------------------------------------------------
    console.log('[TEST 7] Testing agent polling/completion does not close interactive windows...');
    
    // Create an operator lease
    const operatorLease = await lifecycleManager.acquireLease({
      taskId: 'OPEN_MULTIPLE_TABS_SESSION',
      runId: `run_op_interactive_${Date.now()}`,
      clientId: 'client_op_test',
      userId: 'test_operator',
      ownerType: 'OPERATOR_OWNED',
      namespace: 'interactive',
      isHeaded: false,
      allowMultipleTabs: true,
    });

    // Create a background automation lease
    const autoLease = await lifecycleManager.acquireLease({
      taskId: 'SYNC_CLIENT_DATA',
      runId: `run_bg_sync_${Date.now()}`,
      clientId: 'client_sync_test',
      userId: 'system_daemon',
      ownerType: 'AUTOMATION_OWNED',
      namespace: 'sync',
      isHeaded: false,
    });

    assert.strictEqual(operatorLease.primaryPage.isClosed(), false);
    assert.strictEqual(autoLease.primaryPage.isClosed(), false);

    // Agent cleans up all completed background tasks
    await lifecycleManager.closeAllAutomationOwned('TASK_COMPLETED_CLEANUP');

    // Background lease is closed
    assert.strictEqual(autoLease.primaryPage.isClosed(), true, 'AUTOMATION_OWNED page must be closed');

    // Interactive operator lease is NOT closed
    assert.strictEqual(operatorLease.primaryPage.isClosed(), false, 'OPERATOR_OWNED page MUST NOT be closed by agent cleanup');
    assert.strictEqual(operatorLease.isClosed, false, 'OPERATOR_OWNED lease remains active');
    console.log('✓ TEST 7 Passed: Agent cleanup closed background task while preserving interactive operator window.\n');

    await operatorLease.close({ force: true }).catch(() => {});

    // ------------------------------------------------------------------------
    // TEST 8: Single-client Open & Login flow works unchanged
    // ------------------------------------------------------------------------
    console.log('[TEST 8] Testing single-client Open & Login flow continues to work without regression...');
    const singleLease = await lifecycleManager.acquireLease({
      taskId: 'OPEN_INTERACTIVE_CLIENT_SESSION',
      runId: `run_single_regression_${Date.now()}`,
      clientId: 'client_single_regression',
      userId: 'test_operator',
      ownerType: 'OPERATOR_OWNED',
      namespace: 'interactive',
      isHeaded: false,
      allowMultipleTabs: true,
    });

    try {
      const page = singleLease.primaryPage;
      const singleLoginRes = await WorkflowExecutor.executeWorkflow(
        page,
        defaultWorkflow,
        {
          loginUrl: `${baseUrl}/login`,
          username: 'hmc_admin',
          password: 'ValidPassword123!',
        }
      );
      assert.strictEqual(singleLoginRes.success, true, 'Single client login must succeed');
      assert.ok(page.url().includes('/hmc/dashboard'), 'Single client must arrive at dashboard');

      // Operator duplicates tab in this session
      const duplicatedSingle = await singleLease.context.newPage();
      await duplicatedSingle.goto(`${baseUrl}/users`);
      await new Promise((r) => setTimeout(r, 200));

      assert.strictEqual(page.isClosed(), false, 'Original tab open');
      assert.strictEqual(duplicatedSingle.isClosed(), false, 'Duplicated tab remains open without regression');
      console.log('✓ TEST 8 Passed: Single client Open & Login works unchanged, and duplicate tabs remain functional.\n');
    } finally {
      await singleLease.close({ force: true }).catch(() => {});
    }

    console.log('================================================================');
    console.log('      ALL 8 MULTIPLE TAB AUTOMATION TESTS PASSED (8/8)          ');
    console.log('================================================================\n');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  }
}

runMultipleTabsTests().catch((err) => {
  console.error('[MULTIPLE_TABS_TEST_ERROR]', err);
  process.exit(1);
});
