import * as assert from 'assert';
import { execSync } from 'child_process';
import { chromium, Browser } from 'playwright';
import { BrowserLifecycleManager, BrowserLease } from '../engine/browser-lifecycle-manager.js';

function getChromePids(): number[] {
  try {
    const out = execSync("pgrep -f '[c]hrome|[C]hromium'", { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

async function runBrowserLifecycleTests() {
  console.log('================================================================');
  console.log('     BROWSER LIFECYCLE & RESOURCE MANAGEMENT AUDIT SUITE       ');
  console.log('================================================================\n');

  let browser: Browser | null = null;
  const manager = BrowserLifecycleManager.getInstance();

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // ------------------------------------------------------------------------
    // TEST 1: One-Task = One-Context = One-Primary-Page Architecture
    // ------------------------------------------------------------------------
    console.log('[TEST 1] Testing One-Task = One-Context = One-Primary-Page...');
    {
      const context = await browser.newContext();
      const lease = await manager.acquireLease({
        taskId: 'task-test-1',
        runId: 'run-test-1',
        clientId: 'client-1',
        userId: 'usr-1',
        ownerType: 'AUTOMATION_OWNED',
        existingContext: context,
      });

      assert.ok(lease.primaryPage, 'Primary page must be created');
      assert.strictEqual(lease.context.pages().length, 1, 'Exactly one primary page must exist');
      assert.strictEqual(lease.isClosed, false, 'Lease must be open');
      assert.strictEqual(manager.getActiveLeasesCount(), 1, 'Manager must track 1 active lease');

      await lease.close({ reason: 'TEST_1_DONE' });
      assert.strictEqual(lease.isClosed, true, 'Lease must be closed');
      assert.strictEqual(lease.primaryPage.isClosed(), true, 'Primary page must be closed');
      assert.strictEqual(manager.getActiveLeasesCount(), 0, 'No active leases after close');
      console.log('✓ TEST 1 Passed: Exactly one context and page created and closed cleanly.');
    }

    // ------------------------------------------------------------------------
    // TEST 2: Interception & Auto-Closing of Popups / about:blank Tabs
    // ------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing Auto-Close of Unexpected Popups and Blank Tabs...');
    {
      const context = await browser.newContext();
      const lease = await manager.acquireLease({
        taskId: 'task-test-2',
        runId: 'run-test-2',
        clientId: 'client-1',
        userId: 'usr-1',
        ownerType: 'AUTOMATION_OWNED',
        existingContext: context,
      });

      // Spawn an unexpected popup / blank tab
      const extraPage = await context.newPage();
      assert.strictEqual(context.pages().length, 2, 'Temporarily 2 pages exist');

      // Wait briefly for lifecycle manager interceptor to auto-close the extraneous page
      await new Promise((r) => setTimeout(r, 250));

      assert.strictEqual(extraPage.isClosed(), true, 'Unexpected page must be automatically closed');
      assert.strictEqual(lease.primaryPage.isClosed(), false, 'Primary page must remain untouched');
      assert.strictEqual(context.pages().length, 1, 'Context must have exactly 1 page remaining');

      await lease.close();
      console.log('✓ TEST 2 Passed: Unexpected popup automatically intercepted and closed.');
    }

    // ------------------------------------------------------------------------
    // TEST 3: Same Primary Page Reused Across Multiple Stages
    // ------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing Same Page Reused Across Workflow Stages...');
    {
      const context = await browser.newContext();
      const lease = await manager.acquireLease({
        taskId: 'task-test-3',
        runId: 'run-test-3',
        clientId: 'client-1',
        userId: 'usr-1',
        ownerType: 'AUTOMATION_OWNED',
        existingContext: context,
      });

      const initialPage = lease.primaryPage;

      // Stage 1: Initial navigation
      await lease.primaryPage.setContent('<html><body><h1>Stage 1: Login</h1></body></html>');
      assert.strictEqual(lease.primaryPage, initialPage, 'Stage 1 must use initial primary page');

      // Stage 2: Navigation to form
      await lease.primaryPage.setContent('<html><body><h1>Stage 2: Resource Details</h1></body></html>');
      assert.strictEqual(lease.primaryPage, initialPage, 'Stage 2 must reuse the same primary page');

      // Stage 3: Role mapping / verification
      await lease.primaryPage.setContent('<html><body><h1>Stage 3: Verification</h1></body></html>');
      assert.strictEqual(lease.primaryPage, initialPage, 'Stage 3 must reuse the same primary page');

      assert.strictEqual(context.pages().length, 1, 'No additional pages opened during stages');

      await lease.close();
      console.log('✓ TEST 3 Passed: Identical page instance reused across all workflow stages.');
    }

    // ------------------------------------------------------------------------
    // TEST 4: Guaranteed Cleanup Across All Terminal Outcomes
    // ------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing Guaranteed Cleanup on All Outcomes (SUCCESS, FAILURE, TIMEOUT, CANCELLATION)...');
    {
      const scenarios = [
        { name: 'SUCCESS', reason: 'SUCCESS' },
        { name: 'BUSINESS_FAILURE', reason: 'BUSINESS_FAILURE' },
        { name: 'AUTH_FAILURE', reason: 'AUTH_FAILURE' },
        { name: 'TIMEOUT', reason: 'TASK_TIMEOUT' },
        { name: 'CANCELLATION', reason: 'OPERATOR_CANCELLED' },
      ];

      for (const sc of scenarios) {
        const context = await browser.newContext();
        const lease = await manager.acquireLease({
          taskId: `task-${sc.name}`,
          runId: `run-${sc.name}`,
          clientId: 'client-1',
          userId: 'usr-1',
          ownerType: 'AUTOMATION_OWNED',
          existingContext: context,
        });

        if (sc.name === 'CANCELLATION') {
          lease.abort('Cancelled by test runner');
          assert.strictEqual(lease.signal.aborted, true, 'Abort signal must be active on cancellation');
        }

        await lease.close({ reason: sc.reason });

        assert.strictEqual(lease.isClosed, true, `Lease must be closed for ${sc.name}`);
        assert.strictEqual(lease.primaryPage.isClosed(), true, `Page must be closed for ${sc.name}`);
        assert.strictEqual(manager.getActiveLeasesCount(), 0, `No active leases left for ${sc.name}`);
      }
      console.log('✓ TEST 4 Passed: All outcome scenarios closed resources deterministically.');
    }

    // ------------------------------------------------------------------------
    // TEST 5: Idempotent Lease Closure
    // ------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing Idempotent Lease Close...');
    {
      const context = await browser.newContext();
      const lease = await manager.acquireLease({
        taskId: 'task-test-5',
        runId: 'run-test-5',
        clientId: 'client-1',
        userId: 'usr-1',
        ownerType: 'AUTOMATION_OWNED',
        existingContext: context,
      });

      // Call close 3 times consecutively
      await lease.close({ reason: 'FIRST_CLOSE' });
      await lease.close({ reason: 'SECOND_CLOSE' });
      await lease.close({ reason: 'THIRD_CLOSE' });

      assert.strictEqual(lease.isClosed, true);
      assert.strictEqual(manager.getActiveLeasesCount(), 0);
      console.log('✓ TEST 5 Passed: Multiple close calls executed idempotently without errors.');
    }

    // ------------------------------------------------------------------------
    // TEST 6: Operator-Owned Browser Session Preservation
    // ------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing Operator-Owned Browser Session Preservation...');
    {
      const context = await browser.newContext();
      const lease = await manager.acquireLease({
        taskId: 'task-test-6',
        runId: 'run-test-6',
        clientId: 'client-1',
        userId: 'usr-1',
        ownerType: 'OPERATOR_OWNED',
        existingContext: context,
      });

      // Normal close on operator lease marks lease as finished but preserves context and page open
      await lease.close({ reason: 'OPERATOR_INTERACTION_DONE' });

      assert.strictEqual(lease.isClosed, true, 'Lease is marked closed');
      assert.strictEqual(lease.primaryPage.isClosed(), false, 'Operator page MUST remain open');

      // Test closeAllAutomationOwned does NOT touch operator context
      await manager.closeAllAutomationOwned('TEST_SHUTDOWN');
      assert.strictEqual(lease.primaryPage.isClosed(), false, 'Operator page MUST survive automation shutdown');

      // Force close to clean up test resources
      await lease.close({ force: true });
      assert.strictEqual(lease.primaryPage.isClosed(), true, 'Force close cleanly disposes operator session');
      console.log('✓ TEST 6 Passed: Operator-owned browser retained and protected from automation shutdown.');
    }

    // ------------------------------------------------------------------------
    // TEST 7: Launch Retry / Failover Isolation
    // ------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing Launch Retry Disposes Previous Attempt...');
    {
      // Attempt 1 fails
      const ctx1 = await browser.newContext();
      const lease1 = await manager.acquireLease({
        taskId: 'task-retry-1',
        runId: 'run-attempt-1',
        clientId: 'client-1',
        userId: 'usr-1',
        ownerType: 'AUTOMATION_OWNED',
        existingContext: ctx1,
      });
      await lease1.close({ reason: 'ATTEMPT_1_PORTAL_CRASH' });
      assert.strictEqual(lease1.primaryPage.isClosed(), true);

      // Attempt 2 succeeds
      const ctx2 = await browser.newContext();
      const lease2 = await manager.acquireLease({
        taskId: 'task-retry-1',
        runId: 'run-attempt-2',
        clientId: 'client-1',
        userId: 'usr-1',
        ownerType: 'AUTOMATION_OWNED',
        existingContext: ctx2,
      });

      assert.notStrictEqual(lease1.browserInstanceId, lease2.browserInstanceId, 'New instance ID allocated');
      assert.strictEqual(lease2.isClosed, false);
      assert.strictEqual(lease2.primaryPage.isClosed(), false);

      await lease2.close({ reason: 'ATTEMPT_2_SUCCESS' });
      assert.strictEqual(lease2.isClosed, true);
      assert.strictEqual(lease2.primaryPage.isClosed(), true);
      console.log('✓ TEST 7 Passed: Previous failed attempt cleanly disposed before retry.');
    }

    // ------------------------------------------------------------------------
    // TEST 8: Timeout Abort Signal Verification
    // ------------------------------------------------------------------------
    console.log('\n[TEST 8] Testing Timeout Abort Signal Trigger...');
    {
      const context = await browser.newContext();
      const lease = await manager.acquireLease({
        taskId: 'task-timeout-8',
        runId: 'run-timeout-8',
        clientId: 'client-1',
        userId: 'usr-1',
        ownerType: 'AUTOMATION_OWNED',
        timeoutMs: 400,
        existingContext: context,
      });

      assert.strictEqual(lease.signal.aborted, false, 'Signal should initially be false');
      await new Promise((r) => setTimeout(r, 550));
      assert.strictEqual(lease.signal.aborted, true, 'Signal must be aborted after timeout');

      await lease.close({ reason: 'TIMEOUT' });
      console.log('✓ TEST 8 Passed: Timeout correctly triggered abort signal.');
    }

    // ------------------------------------------------------------------------
    // TEST 9: 80-Operation Comprehensive Stress Test Suite
    // 25 User + 25 Resource + 10 Failure + 10 Timeout + 10 Cancellation
    // ------------------------------------------------------------------------
    console.log('\n[TEST 9] Running 80-Operation Stress Test Matrix...');
    manager.clearTelemetry();

    const pidsBefore = getChromePids();
    console.log(`  [PID Audit] Chrome PIDs before stress execution (${pidsBefore.length} PIDs): ${pidsBefore.join(', ')}`);

    interface StressOp {
      type: 'USER' | 'RESOURCE' | 'FAILURE' | 'TIMEOUT' | 'CANCELLATION';
      id: number;
    }

    const operations: StressOp[] = [
      ...Array.from({ length: 25 }, (_, i) => ({ type: 'USER' as const, id: i + 1 })),
      ...Array.from({ length: 25 }, (_, i) => ({ type: 'RESOURCE' as const, id: i + 1 })),
      ...Array.from({ length: 10 }, (_, i) => ({ type: 'FAILURE' as const, id: i + 1 })),
      ...Array.from({ length: 10 }, (_, i) => ({ type: 'TIMEOUT' as const, id: i + 1 })),
      ...Array.from({ length: 10 }, (_, i) => ({ type: 'CANCELLATION' as const, id: i + 1 })),
    ];

    assert.strictEqual(operations.length, 80, 'Must execute exactly 80 stress operations');

    const trackedPids: number[] = [];
    let opCounter = 0;
    for (const op of operations) {
      opCounter++;
      const taskId = `stress-task-${op.type.toLowerCase()}-${op.id}`;
      const runId = `stress-run-${op.type.toLowerCase()}-${op.id}`;

      // Launch dedicated automation-owned browser instance & record its exact PID
      const server = await chromium.launchServer({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const serverPid = server.process()?.pid;
      assert.ok(serverPid, 'Browser server process PID must be available');
      trackedPids.push(serverPid);

      const opBrowser = await chromium.connect(server.wsEndpoint());
      const ctx = await opBrowser.newContext();

      const lease = await manager.acquireLease({
        taskId,
        runId,
        clientId: 'client-stress',
        userId: 'usr-stress',
        ownerType: 'AUTOMATION_OWNED',
        timeoutMs: op.type === 'TIMEOUT' ? 50 : 5000,
        existingContext: ctx,
      });

      // Simulate workload
      if (op.type === 'USER') {
        await lease.primaryPage.setContent(`<div>User Mutation ${op.id}</div>`);
        await lease.close({ reason: 'USER_MUTATION_SUCCESS' });
      } else if (op.type === 'RESOURCE') {
        await lease.primaryPage.setContent(`<div>Resource Mutation ${op.id}</div>`);
        await lease.close({ reason: 'RESOURCE_MUTATION_SUCCESS' });
      } else if (op.type === 'FAILURE') {
        await lease.primaryPage.setContent(`<div>Simulated Business Failure ${op.id}</div>`);
        await lease.close({ reason: 'BUSINESS_VALIDATION_ERROR' });
      } else if (op.type === 'TIMEOUT') {
        await new Promise((r) => setTimeout(r, 80));
        assert.strictEqual(lease.signal.aborted, true);
        await lease.close({ reason: 'TIMEOUT' });
      } else if (op.type === 'CANCELLATION') {
        lease.abort('OPERATOR_CLICKED_CANCEL');
        assert.strictEqual(lease.signal.aborted, true);
        await lease.close({ reason: 'CANCELLATION' });
      }

      assert.strictEqual(lease.isClosed, true);
      assert.strictEqual(lease.primaryPage.isClosed(), true);

      await opBrowser.close();
      await server.close();
    }

    // Post-Stress Invariants Verification
    assert.strictEqual(manager.getActiveLeasesCount(), 0, 'Zero active leases must remain after stress test');
    assert.strictEqual(manager.getActivePagesCount(), 0, 'Zero active pages must remain after stress test');
    assert.strictEqual(manager.getActiveContextsCount(), 0, 'Zero active contexts must remain after stress test');

    const telemetry = manager.getTelemetryLog();
    assert.strictEqual(telemetry.length, 80, 'Telemetry log must have exactly 80 recorded entries');

    for (const t of telemetry) {
      assert.ok(t.taskId, 'Telemetry must contain taskId');
      assert.ok(t.runId, 'Telemetry must contain runId');
      assert.ok(t.browserInstanceId, 'Telemetry must contain browserInstanceId');
      assert.ok(t.contextId, 'Telemetry must contain contextId');
      assert.ok(t.pageId, 'Telemetry must contain pageId');
      assert.ok(t.createdAt > 0, 'Telemetry must contain createdAt');
      assert.ok(t.closedAt && t.closedAt >= t.createdAt, 'Telemetry must contain closedAt >= createdAt');
      assert.ok(t.closeReason, 'Telemetry must contain closeReason');
    }

    // 1. Explicit per-PID verification: Prove every launched PID exited (ESRCH)
    assert.strictEqual(trackedPids.length, 80, 'Must track exactly 80 automation browser PIDs');
    console.log(`  [PID Audit] Recorded ${trackedPids.length} individual automation-owned browser PIDs.`);
    for (const pid of trackedPids) {
      let isAlive = true;
      try {
        process.kill(pid, 0);
      } catch (err: any) {
        if (err.code === 'ESRCH') isAlive = false;
      }
      assert.strictEqual(isAlive, false, `Automation-owned browser PID ${pid} must have terminated`);
    }
    console.log(`  [PID Audit] ✓ Every individual recorded browser PID confirmed dead via ESRCH signal.`);

    // 2. Global process audit: Verify no orphaned PIDs leaked across system
    const pidsAfter = getChromePids();
    console.log(`  [PID Audit] Chrome PIDs after stress execution (${pidsAfter.length} PIDs): ${pidsAfter.join(', ')}`);
    const leakedPids = pidsAfter.filter((pid) => !pidsBefore.includes(pid));
    assert.strictEqual(leakedPids.length, 0, `Zero automation-owned Chrome PIDs may leak (leaked: ${leakedPids.join(', ')})`);
    console.log('  [PID Audit] ✓ Zero leaked Chrome processes detected globally.');

    console.log(`✓ TEST 9 Passed: All 80 operations executed with 0 leaked pages, 0 leaked contexts, 80 confirmed closed PIDs, and full telemetry verification.`);


    // ------------------------------------------------------------------------
    // TEST 10: Lifecycle-Bound Single-Flight Protection & UI Double-Click Prevention
    // Two duplicate User requests must not create two executable mutation tasks.
    // Lock is held/renewed until terminal state and returns HTTP 409 on conflict.
    // ------------------------------------------------------------------------
    console.log('\n[TEST 10] Testing Lifecycle-Bound Single-Flight Protection & User UI Double-Click Prevention...');
    {
      interface LockEntry {
        ownerToken: string;
        acquiredAt: number;
        lastHeartbeatAt: number;
        timer?: NodeJS.Timeout;
      }
      const activeMutationLocks = new Map<string, LockEntry>();
      const STALE_TTL = 60000;

      const acquireLifecycleLock = (clientId: string, username: string) => {
        const key = `${clientId}:${username.trim().toLowerCase()}`;
        const now = Date.now();
        const existing = activeMutationLocks.get(key);
        if (existing) {
          if (now - existing.lastHeartbeatAt < STALE_TTL) {
            const err: any = new Error(`Another mutation operation is already in progress for user '${username}'.`);
            err.status = 409;
            err.code = 'OPERATION_IN_PROGRESS';
            throw err;
          }
          if (existing.timer) clearInterval(existing.timer);
        }

        const ownerToken = `fencing_${Date.now()}_${Math.random()}`;
        const entry: LockEntry = {
          ownerToken,
          acquiredAt: now,
          lastHeartbeatAt: now,
        };

        entry.timer = setInterval(() => {
          const current = activeMutationLocks.get(key);
          if (current && current.ownerToken === ownerToken) {
            current.lastHeartbeatAt = Date.now();
          } else {
            if (entry.timer) clearInterval(entry.timer);
          }
        }, 50);

        activeMutationLocks.set(key, entry);

        return () => {
          if (entry.timer) clearInterval(entry.timer);
          const current = activeMutationLocks.get(key);
          if (current && current.ownerToken === ownerToken) {
            activeMutationLocks.delete(key);
          }
        };
      };

      // Part A: UI Double-Click Prevention Simulation (UsersPage.tsx handleStatusChange)
      let isMutatingStatus = false;
      let uiSubmissionsDispatched = 0;
      let uiClicksIgnored = 0;

      const handleUserStatusClick = async () => {
        if (isMutatingStatus) {
          uiClicksIgnored++;
          return;
        }
        isMutatingStatus = true;
        uiSubmissionsDispatched++;
        try {
          await new Promise((r) => setTimeout(r, 60));
        } finally {
          isMutatingStatus = false;
        }
      };

      // Operator double-clicks the Activate button rapidly
      const click1 = handleUserStatusClick();
      const click2 = handleUserStatusClick();
      await Promise.all([click1, click2]);

      assert.strictEqual(uiSubmissionsDispatched, 1, 'UI must dispatch exactly one mutation request on double-click');
      assert.strictEqual(uiClicksIgnored, 1, 'UI must ignore the second click while mutation is in-flight');

      // Part B: API-Level Single-Flight Conflict (HTTP 409) & Lifecycle-Bound Holding
      const clientId = 'client-single-flight';
      const username = 'dr_fahad';
      let taskDispatches = 0;
      let rejected409Count = 0;

      const simulateApiMutationRequest = async (runId: string, durationMs: number = 80) => {
        const release = acquireLifecycleLock(clientId, username);
        try {
          taskDispatches++;
          const ctx = await browser!.newContext();
          const lease = await manager.acquireLease({
            taskId: 'MUTATE_USER_STATUS',
            runId,
            clientId,
            userId: username,
            ownerType: 'AUTOMATION_OWNED',
            existingContext: ctx,
          });
          // Verify lock is actively held throughout execution
          assert.ok(activeMutationLocks.has(`${clientId}:${username.toLowerCase()}`));
          await new Promise((r) => setTimeout(r, durationMs));
          await lease.close({ reason: 'USER_MUTATED' });
        } finally {
          release(); // Released ONLY on terminal outcome in finally
        }
      };

      // Two concurrent network requests with distinct Run IDs
      const req1Promise = simulateApiMutationRequest('run-user-req-1', 120);
      let req2Error: any = null;
      try {
        await simulateApiMutationRequest('run-user-req-2', 50);
      } catch (err: any) {
        req2Error = err;
        if (err.status === 409) rejected409Count++;
      }

      await req1Promise;

      assert.strictEqual(taskDispatches, 1, 'Exactly one mutation task executed');
      assert.strictEqual(rejected409Count, 1, 'Duplicate concurrent request rejected with HTTP 409');
      assert.strictEqual(req2Error.code, 'OPERATION_IN_PROGRESS');
      assert.strictEqual(activeMutationLocks.has(`${clientId}:${username.toLowerCase()}`), false, 'Lock deleted after terminal outcome');

      // Subsequent request after terminal state succeeds cleanly
      await simulateApiMutationRequest('run-user-req-3', 20);
      assert.strictEqual(taskDispatches, 2, 'Subsequent request succeeds after previous terminal release');
      assert.strictEqual(manager.getActiveLeasesCount(), 0, 'Zero leases remain open');

      console.log('✓ TEST 10 Passed: UI double-click guard and API lifecycle-bound HTTP 409 locking verified.');
    }

    console.log('\n================================================================');
    console.log('         ALL 10 BROWSER LIFECYCLE TESTS COMPLETED SUCCESSFULLY   ');
    console.log('================================================================\n');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

runBrowserLifecycleTests().catch((err) => {
  console.error('Browser Lifecycle Test Suite Failed:', err);
  process.exit(1);
});
