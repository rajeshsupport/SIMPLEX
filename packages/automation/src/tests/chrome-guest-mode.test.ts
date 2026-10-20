import * as assert from 'assert';
import * as fs from 'fs';
import { chromium } from 'playwright';
import {
  ChromeGuestLauncher,
  BrowserLifecycleManager,
  ClientMutationLockManager,
} from '../index.js';

async function runChromeGuestModeTests() {
  console.log('================================================================');
  console.log('       GOOGLE CHROME GUEST MODE & CONCURRENCY TEST SUITE        ');
  console.log('================================================================\n');

  const lifecycleManager = BrowserLifecycleManager.getInstance();
  const lockManager = ClientMutationLockManager.getInstance();

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Installed Google Chrome executable detection & launch configuration
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Testing Google Chrome executable detection and configuration...');
    const detectedPath = ChromeGuestLauncher.detectChromeExecutable();
    console.log(`  Detected Chrome executable: ${detectedPath || 'NONE'}`);

    if (process.platform === 'darwin') {
      assert.ok(detectedPath, 'On macOS, Google Chrome must be detected');
      assert.strictEqual(
        detectedPath,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        'macOS Chrome executable path must match standard location'
      );
      assert.ok(fs.existsSync(detectedPath), 'Detected Chrome binary must exist on disk');
    }

    const config = ChromeGuestLauncher.getLaunchConfiguration();
    assert.strictEqual(config.browser, 'chrome', 'Configured browser must default to chrome');
    assert.strictEqual(config.chromeGuest, true, 'Chrome Guest Mode must be enabled by default');
    assert.strictEqual(config.allowChromiumFallback, false, 'ALLOW_CHROMIUM_FALLBACK must default to false');
    console.log('✓ TEST 1 Passed: Google Chrome binary detected and launch configuration verified.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Google Chrome Guest Mode session launch with --guest argument
    // -------------------------------------------------------------------------
    console.log('[TEST 2] Testing Google Chrome Guest Mode launch with --guest argument...');
    const session = await ChromeGuestLauncher.launchGuestSession({
      headless: false,
    });
    try {
      assert.ok(session.browser, 'Browser must be successfully launched');
      assert.ok(session.context, 'BrowserContext must be created');
      assert.ok(session.page, 'Primary page must be created');
      assert.ok(session.launchArgs.includes('--guest'), 'Launch args must include --guest');
      assert.strictEqual(session.launchArgs[0], '--guest', '--guest must be the leading argument');
      assert.ok(session.launchArgs.includes('--no-first-run'), 'Must include --no-first-run');
      assert.ok(session.launchArgs.includes('--disable-extensions'), 'Must include --disable-extensions');
      assert.ok(session.launchArgs.includes('--disable-sync'), 'Must include --disable-sync');
      assert.strictEqual(session.isFallback, false, 'Must not be a fallback to bundled Chromium');

      const version = session.browser.version();
      console.log(`  Launched Browser Version: ${version}`);
      assert.ok(version.length > 0, 'Browser version must be non-empty');
      console.log('✓ TEST 2 Passed: Google Chrome launched in Guest Mode with correct args.\n');
    } finally {
      await session.page.close().catch(() => {});
      await session.context.close().catch(() => {});
      await session.browser.close().catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST 3: Zero persistent / personal profile directory usage
    // -------------------------------------------------------------------------
    console.log('[TEST 3] Testing zero persistent or personal profile directory usage...');
    const session3 = await ChromeGuestLauncher.launchGuestSession({ headless: false });
    try {
      const cookies = await session3.context.cookies();
      assert.strictEqual(cookies.length, 0, 'Fresh Guest context must start with 0 cookies');

      // Check that no personal profile files or user-data-dir paths were passed in args
      const hasUserDataDirArg = session3.launchArgs.some((a) => a.includes('--user-data-dir'));
      assert.strictEqual(hasUserDataDirArg, false, 'Guest session launch args must not include --user-data-dir');
      console.log('✓ TEST 3 Passed: Zero persistent profile directory or saved credentials used.\n');
    } finally {
      await session3.page.close().catch(() => {});
      await session3.context.close().catch(() => {});
      await session3.browser.close().catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST 4: Two simultaneous tasks receive separate browser processes & contexts
    // -------------------------------------------------------------------------
    console.log('[TEST 4] Testing two simultaneous tasks receive separate browser processes & contexts...');
    const lease1 = await lifecycleManager.acquireLease({
      taskId: 'CREATE_CLIENT_USER',
      runId: `run_simul_1_${Date.now()}`,
      clientId: 'client_alpha',
      userId: 'op_1',
      ownerType: 'AUTOMATION_OWNED',
      namespace: 'mutation',
      isHeaded: true,
      useGuestMode: true,
    });

    const lease2 = await lifecycleManager.acquireLease({
      taskId: 'CREATE_CLIENT_USER',
      runId: `run_simul_2_${Date.now()}`,
      clientId: 'client_beta',
      userId: 'op_1',
      ownerType: 'AUTOMATION_OWNED',
      namespace: 'mutation',
      isHeaded: true,
      useGuestMode: true,
    });

    try {
      assert.ok(lease1.browser, 'Lease 1 must track a browser process');
      assert.ok(lease2.browser, 'Lease 2 must track a browser process');
      assert.notStrictEqual(lease1.browser, lease2.browser, 'Simultaneous tasks must not share one browser process');
      assert.notStrictEqual(lease1.context, lease2.context, 'Simultaneous tasks must not share one context');
      assert.notStrictEqual(lease1.primaryPage, lease2.primaryPage, 'Simultaneous tasks must not share one primary page');
      assert.strictEqual(lease1.isGuestMode, true, 'Lease 1 must be in Guest Mode');
      assert.strictEqual(lease2.isGuestMode, true, 'Lease 2 must be in Guest Mode');

      // Closing lease 1 must close only lease 1 and leave lease 2 untouched
      await lease1.close();
      assert.strictEqual(lease1.isClosed, true, 'Lease 1 must be marked closed');
      assert.strictEqual(lease1.primaryPage.isClosed(), true, 'Lease 1 page must be closed');
      assert.strictEqual(lease2.isClosed, false, 'Lease 2 must remain open and unaffected');
      assert.strictEqual(lease2.primaryPage.isClosed(), false, 'Lease 2 page must remain open');

      console.log('✓ TEST 4 Passed: Separate Chrome processes and contexts isolated across concurrent tasks.\n');
    } finally {
      await lease1.close().catch(() => {});
      await lease2.close().catch(() => {});
    }

    // -------------------------------------------------------------------------
    // TEST 5: Same-client mutation tasks are serialized (run one-by-one)
    // -------------------------------------------------------------------------
    console.log('[TEST 5] Testing same-client mutation tasks are serialized (one-by-one)...');
    lockManager.reset();

    const executionLog: string[] = [];
    let task1FinishTime = 0;
    let task2StartTime = 0;

    const p1 = lockManager.executeWithLock(
      { clientId: 'CLIENT_SAME', runId: 'run_mut_1', taskType: 'CREATE_CLIENT_USER', taskKey: 'CREATE_CLIENT_USER_usr1' },
      async () => {
        executionLog.push('task1_start');
        await new Promise((r) => setTimeout(r, 150));
        task1FinishTime = Date.now();
        executionLog.push('task1_finish');
      }
    );

    const p2 = lockManager.executeWithLock(
      { clientId: 'CLIENT_SAME', runId: 'run_mut_2', taskType: 'SET_CLIENT_USER_STATUS', taskKey: 'SET_CLIENT_USER_STATUS_usr2' },
      async () => {
        task2StartTime = Date.now();
        executionLog.push('task2_start');
        await new Promise((r) => setTimeout(r, 50));
        executionLog.push('task2_finish');
      }
    );

    await Promise.all([p1, p2]);

    assert.deepStrictEqual(
      executionLog,
      ['task1_start', 'task1_finish', 'task2_start', 'task2_finish'],
      'Same-client mutation tasks must execute sequentially'
    );
    assert.ok(
      task2StartTime >= task1FinishTime,
      `Task 2 start (${task2StartTime}) must be >= Task 1 finish (${task1FinishTime})`
    );
    console.log('✓ TEST 5 Passed: Same-client mutation workflows strictly serialized.\n');

    // -------------------------------------------------------------------------
    // TEST 6: Different-client tasks can run concurrently in parallel
    // -------------------------------------------------------------------------
    console.log('[TEST 6] Testing different-client tasks run in parallel...');
    lockManager.reset();

    let clientAStartTime = 0;
    let clientBStartTime = 0;
    const parallelEvents: string[] = [];

    const taskA = lockManager.executeWithLock(
      { clientId: 'CLIENT_AAA', runId: 'run_a', taskType: 'CREATE_USER' },
      async () => {
        clientAStartTime = Date.now();
        parallelEvents.push('clientA_start');
        await new Promise((r) => setTimeout(r, 200));
        parallelEvents.push('clientA_finish');
      }
    );

    const taskB = lockManager.executeWithLock(
      { clientId: 'CLIENT_BBB', runId: 'run_b', taskType: 'CREATE_USER' },
      async () => {
        clientBStartTime = Date.now();
        parallelEvents.push('clientB_start');
        await new Promise((r) => setTimeout(r, 200));
        parallelEvents.push('clientB_finish');
      }
    );

    await Promise.all([taskA, taskB]);

    assert.ok(
      Math.abs(clientAStartTime - clientBStartTime) < 80,
      `Different clients should start at the same time (delta: ${Math.abs(clientAStartTime - clientBStartTime)}ms)`
    );
    assert.strictEqual(parallelEvents[0], 'clientA_start');
    assert.strictEqual(parallelEvents[1], 'clientB_start');
    console.log('✓ TEST 6 Passed: Different clients executed in parallel without blocking.\n');

    // -------------------------------------------------------------------------
    // TEST 7: Duplicate mutation submission prevention while task is active
    // -------------------------------------------------------------------------
    console.log('[TEST 7] Testing duplicate mutation submission prevention while task is active...');
    lockManager.reset();

    let duplicateRejected = false;
    const taskKey = 'CREATE_CLIENT_USER_john_doe';

    const longTask = lockManager.executeWithLock(
      { clientId: 'CLIENT_DUP_TEST', runId: 'run_long_1', taskType: 'CREATE_CLIENT_USER', taskKey },
      async () => {
        await new Promise((r) => setTimeout(r, 200));
      }
    );

    try {
      await lockManager.executeWithLock(
        { clientId: 'CLIENT_DUP_TEST', runId: 'run_dup_2', taskType: 'CREATE_CLIENT_USER', taskKey },
        async () => {}
      );
    } catch (dupErr: any) {
      if (dupErr.code === 'DUPLICATE_TASK_SUBMISSION_REJECTED') {
        duplicateRejected = true;
      }
    }

    await longTask;
    assert.strictEqual(duplicateRejected, true, 'Duplicate active mutation task must be rejected');
    console.log('✓ TEST 7 Passed: Duplicate submission blocked while prior task is unresolved.\n');

    // -------------------------------------------------------------------------
    // TEST 8: Task cleanup closes only the browser it owns, operator untouched
    // -------------------------------------------------------------------------
    console.log('[TEST 8] Testing task cleanup closes only its own browser, operator untouched...');
    // Create an operator context
    const opBrowser = await chromium.launch({ headless: true });
    const opContext = await opBrowser.newContext();
    const opPage = await opContext.newPage();
    await opPage.goto('about:blank');

    const opLease = await lifecycleManager.acquireLease({
      taskId: 'OPERATOR_SESSION',
      runId: 'run_op_session',
      clientId: 'cli_op',
      userId: 'op_user',
      ownerType: 'OPERATOR_OWNED',
      existingContext: opContext,
    });

    const autoLease = await lifecycleManager.acquireLease({
      taskId: 'AUTO_TASK',
      runId: 'run_auto_task',
      clientId: 'cli_auto',
      userId: 'auto_user',
      ownerType: 'AUTOMATION_OWNED',
      namespace: 'mutation',
      isHeaded: true,
      useGuestMode: true,
    });

    assert.strictEqual(lifecycleManager.getActiveLeasesCount(), 2);
    assert.strictEqual(opPage.isClosed(), false);
    assert.strictEqual(autoLease.primaryPage.isClosed(), false);

    // Call closeAllAutomationOwned
    await lifecycleManager.closeAllAutomationOwned('NORMAL_BATCH_END');

    // Automation lease must be closed
    assert.strictEqual(autoLease.isClosed, true);
    assert.strictEqual(autoLease.primaryPage.isClosed(), true);

    // Operator lease and page must remain intact!
    assert.strictEqual(opLease.isClosed, false);
    assert.strictEqual(opPage.isClosed(), false);
    console.log('✓ TEST 8 Passed: Operator-owned browser remained untouched during automation cleanup.\n');

    // Clean up operator browser
    await opPage.close().catch(() => {});
    await opContext.close().catch(() => {});
    await opBrowser.close().catch(() => {});
    await opLease.close({ force: true }).catch(() => {});

    // -------------------------------------------------------------------------
    // TEST 9: Error classification GOOGLE_CHROME_GUEST_UNAVAILABLE
    // -------------------------------------------------------------------------
    console.log('[TEST 9] Testing GOOGLE_CHROME_GUEST_UNAVAILABLE classification on missing Chrome...');
    let threwGuestUnavailable = false;
    try {
      await ChromeGuestLauncher.launchGuestSession({
        forceExecutablePath: '/nonexistent/path/to/Google Chrome',
        forceChannel: 'nonexistent-chrome-channel-xyz',
        allowChromiumFallback: false,
      });
    } catch (err: any) {
      if (err.code === 'GOOGLE_CHROME_GUEST_UNAVAILABLE' || err.message.includes('GOOGLE_CHROME_GUEST_UNAVAILABLE')) {
        threwGuestUnavailable = true;
      }
    }

    assert.strictEqual(
      threwGuestUnavailable,
      true,
      'Must throw GOROME_CHROME_GUEST_UNAVAILABLE when Chrome is missing and fallback is false'
    );
    console.log('✓ TEST 9 Passed: GOOGLE_CHROME_GUEST_UNAVAILABLE raised cleanly without silent fallback.\n');

    // -------------------------------------------------------------------------
    // TEST 10: Allowed Chromium fallback when explicitly enabled
    // -------------------------------------------------------------------------
    console.log('[TEST 10] Testing permitted fallback to bundled Chromium when ALLOW_CHROMIUM_FALLBACK=true...');
    const fallbackSession = await ChromeGuestLauncher.launchGuestSession({
      forceExecutablePath: '/nonexistent/path/to/Google Chrome',
      forceChannel: 'nonexistent-chrome-channel-xyz',
      allowChromiumFallback: true,
      headless: true,
    });
    try {
      assert.ok(fallbackSession.browser, 'Must launch bundled Chromium when fallback is permitted');
      assert.strictEqual(fallbackSession.isFallback, true, 'isFallback flag must be true');
      console.log('✓ TEST 10 Passed: Bundled Chromium launched cleanly when permitted.\n');
    } finally {
      await fallbackSession.page.close().catch(() => {});
      await fallbackSession.context.close().catch(() => {});
      await fallbackSession.browser.close().catch(() => {});
    }

    console.log('================================================================');
    console.log('✓ ALL 10/10 GOOGLE CHROME GUEST MODE TESTS PASSED PERFECTLY');
    console.log('================================================================\n');
  } catch (fatal: any) {
    console.error('\n[FATAL TEST ERROR]', fatal);
    process.exit(1);
  }
}

runChromeGuestModeTests().catch((err) => {
  console.error('[UNHANDLED]', err);
  process.exit(1);
});
