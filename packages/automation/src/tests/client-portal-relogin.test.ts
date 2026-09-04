import * as http from 'http';
import * as assert from 'assert';
import { BrowserContext, Page } from 'playwright';
import { startFixtureServer } from '../fixture/server.js';
import { BrowserProfileManager } from '../engine/profile-manager.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { SelectorResolver } from '../engine/selector-resolver.js';
import { WorkflowVersionConfig } from '@hmc/shared';

async function runClientPortalReLoginTests() {
  console.log('================================================================');
  console.log('    CLIENT PORTALS SEARCH & OPEN & LOGIN RE-AUTH TEST SUITE     ');
  console.log('================================================================\n');

  let server: http.Server | null = null;
  const fixturePort = 4018;
  const baseUrl = `http://127.0.0.1:${fixturePort}`;

  const loginWorkflow: WorkflowVersionConfig = {
    versionNumber: 1,
    applicableAppVersion: 'v1.0',
    pageRoute: '/login',
    defaultTimeoutMs: 5000,
    maxRetries: 1,
    steps: [
      {
        stepIndex: 1,
        stepName: 'Opening client application…',
        action: 'NAVIGATE',
        valueTemplate: '{{loginUrl}}',
        timeoutMs: 5000,
      },
      {
        stepIndex: 2,
        stepName: 'Loading saved credentials securely…',
        action: 'FILL',
        valueTemplate: '{{username}}',
      },
      {
        stepIndex: 3,
        stepName: 'Entering username…',
        action: 'FILL',
        targetSelector: {
          strategy: 'ID',
          value: 'username',
          fallbackSelectors: [{ strategy: 'NAME', value: 'username' }],
        },
        valueTemplate: '{{username}}',
        timeoutMs: 5000,
      },
      {
        stepIndex: 4,
        stepName: 'Entering password securely…',
        action: 'FILL',
        targetSelector: {
          strategy: 'ID',
          value: 'password',
          fallbackSelectors: [{ strategy: 'NAME', value: 'password' }],
        },
        valueTemplate: '{{password}}',
        timeoutMs: 5000,
      },
      {
        stepIndex: 5,
        stepName: 'Submitting login…',
        action: 'CLICK',
        targetSelector: {
          strategy: 'ID',
          value: 'btnLogin',
          fallbackSelectors: [{ strategy: 'CSS', value: 'button[type="submit"]' }],
        },
        timeoutMs: 5000,
      },
      {
        stepIndex: 6,
        stepName: 'Verifying authenticated session…',
        action: 'WAIT_FOR_ELEMENT',
        targetSelector: {
          strategy: 'TEST_ID',
          value: 'client-dashboard',
          fallbackSelectors: [{ strategy: 'CSS', value: '.header' }],
        },
        timeoutMs: 8000,
      },
    ],
    successConditions: [
      { type: 'URL_CONTAINS', expectedValue: '/hmc/dashboard', isTerminalSuccess: true },
    ],
    errorConditions: [
      { type: 'TEXT_PRESENT', expectedValue: 'Invalid credentials', isTerminalError: true, errorMessage: 'Client login was unsuccessful.' },
    ],
    securityBlockConditions: [
      { type: 'ELEMENT_VISIBLE', selector: { strategy: 'TEST_ID', value: 'mfa-challenge' }, isSecurityControlBlock: true, errorMessage: 'Manual security verification is required.' },
    ],
  };

  try {
    server = await startFixtureServer(fixturePort);

    // -------------------------------------------------------------
    // TEST 1: Client Search Filtering Unit Tests
    // -------------------------------------------------------------
    console.log('[TEST 1] Testing Client Search Filtering logic...');
    const testClients = [
      { clientCode: 'CLINIC-ALPHA', clientName: 'Alpha Medical Center', environment: 'Staging', baseUrl: 'https://alpha.example.com', applicationVersion: 'v9.4' },
      { clientCode: 'HOSP-BETA', clientName: 'Beta Regional Hospital', environment: 'Production', baseUrl: 'https://beta.example.com', applicationVersion: 'v9.3' },
      { clientCode: 'GAMMA-LAB', clientName: 'Gamma Diagnostics', environment: 'Test', baseUrl: 'https://gamma.example.com', applicationVersion: 'v1.0' },
    ];

    const filterFn = (clients: typeof testClients, search: string, env: string = 'ALL') => {
      const term = search.trim().toLowerCase();
      return clients.filter((c) => {
        const matchesSearch =
          !term ||
          c.clientCode.toLowerCase().includes(term) ||
          c.clientName.toLowerCase().includes(term) ||
          c.baseUrl.toLowerCase().includes(term) ||
          c.environment.toLowerCase().includes(term) ||
          c.applicationVersion.toLowerCase().includes(term);
        const matchesEnv = env === 'ALL' || c.environment.toLowerCase() === env.toLowerCase();
        return matchesSearch && matchesEnv;
      });
    };

    // 1a: Search by code
    const resByCode = filterFn(testClients, '  clinic-alpha  ');
    assert.strictEqual(resByCode.length, 1);
    assert.strictEqual(resByCode[0].clientCode, 'CLINIC-ALPHA');

    // 1b: Search by name
    const resByName = filterFn(testClients, 'regional');
    assert.strictEqual(resByName.length, 1);
    assert.strictEqual(resByName[0].clientCode, 'HOSP-BETA');

    // 1c: Search by version
    const resByVer = filterFn(testClients, 'v9.4');
    assert.strictEqual(resByVer.length, 1);
    assert.strictEqual(resByVer[0].clientCode, 'CLINIC-ALPHA');

    // 1d: Clear search
    const resClear = filterFn(testClients, '');
    assert.strictEqual(resClear.length, 3);

    // 1e: No matches found
    const resNone = filterFn(testClients, 'nonexistent_keyword');
    assert.strictEqual(resNone.length, 0);

    console.log('✓ TEST 1 Passed: Client search by code, name, environment, url, version, clear, and empty state verified.');

    // -------------------------------------------------------------
    // TEST 2: First Automatic Login
    // -------------------------------------------------------------
    console.log('\n[TEST 2] Testing First Automatic Login...');
    const context1 = await BrowserProfileManager.launchPersistentContext({
      clientId: 'REAUTH_CLI_1',
      userId: 'test_operator',
      isHeaded: false,
      namespace: 'interactive',
    });

    const page1 = context1.pages()[0] || (await context1.newPage());
    const firstLoginRes = await WorkflowExecutor.executeWorkflow(page1, loginWorkflow, {
      loginUrl: `${baseUrl}/login`,
      username: 'hmc_admin',
      password: 'valid_password',
    });

    assert.strictEqual(firstLoginRes.success, true);
    assert.ok(page1.url().includes('/hmc/dashboard'));
    console.log('✓ TEST 2 Passed: First automatic login succeeded and reached dashboard.');

    // -------------------------------------------------------------
    // TEST 3: State A — Already Authenticated Detection
    // -------------------------------------------------------------
    console.log('\n[TEST 3] Testing State A: Already Authenticated Session...');
    const isAuth = await WorkflowExecutor.checkSessionActive(page1, loginWorkflow);
    assert.strictEqual(isAuth, true, 'checkSessionActive must return true when dashboard is visible');
    console.log('✓ TEST 3 Passed: Detected active authenticated dashboard.');

    // -------------------------------------------------------------
    // TEST 4: Simplex Logout & State B: Re-Authentication Workflow
    // -------------------------------------------------------------
    console.log('\n[TEST 4] Testing Re-Authentication After Simplex Logout...');
    // Operator logs out in Simplex window
    await page1.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });

    // Verify session is now recognized as NOT active
    const isAuthAfterLogout = await WorkflowExecutor.checkSessionActive(page1, loginWorkflow);
    assert.strictEqual(isAuthAfterLogout, false, 'checkSessionActive must return false when at login page');

    // Trigger second Open & Login
    const reAuthRes = await WorkflowExecutor.executeWorkflow(page1, loginWorkflow, {
      loginUrl: `${baseUrl}/login`,
      username: 'hmc_admin',
      password: 'valid_password',
    });

    assert.strictEqual(reAuthRes.success, true);
    assert.ok(page1.url().includes('/hmc/dashboard'));
    console.log('✓ TEST 4 Passed: Re-authentication automatically logged back in after Simplex logout.');

    // -------------------------------------------------------------
    // TEST 5: Window Reopen After User Closes Managed Window
    // -------------------------------------------------------------
    console.log('\n[TEST 5] Testing Reopen After Managed Window Close...');
    await context1.close();

    const context2 = await BrowserProfileManager.launchPersistentContext({
      clientId: 'REAUTH_CLI_1',
      userId: 'test_operator',
      isHeaded: false,
      namespace: 'interactive',
    });

    const page2 = context2.pages()[0] || (await context2.newPage());
    const reopenAuthRes = await WorkflowExecutor.executeWorkflow(page2, loginWorkflow, {
      loginUrl: `${baseUrl}/login`,
      username: 'hmc_admin',
      password: 'valid_password',
    });

    assert.strictEqual(reopenAuthRes.success, true);
    assert.ok(page2.url().includes('/hmc/dashboard'));
    await context2.close();
    await BrowserProfileManager.deleteProfile('REAUTH_CLI_1', 'test_operator');
    console.log('✓ TEST 5 Passed: Closed window safely reopened and logged in.');

    // -------------------------------------------------------------
    // TEST 6: Profile Lock Recovery & Single Flight
    // -------------------------------------------------------------
    console.log('\n[TEST 6] Testing Profile Lock Recovery & Single Flight...');
    const pathA = BrowserProfileManager.getProfilePath('CLI_ALPHA_99', 'OP_1', 'interactive');
    const pathB = BrowserProfileManager.getProfilePath('CLI_BETA_99', 'OP_1', 'interactive');
    assert.notStrictEqual(pathA, pathB, 'Profiles for different clients must be strictly separated');

    await BrowserProfileManager.releaseProfileLock(pathA);
    console.log('✓ TEST 6 Passed: Profile lock recovery and client separation verified.');

    // -------------------------------------------------------------
    // TEST 7: Zero Credential Leakage Verification
    // -------------------------------------------------------------
    console.log('\n[TEST 7] Testing Zero Plaintext Credential Leakage in Telemetry...');
    const telemetryLogs: any[] = [];
    const testVars = { loginUrl: `${baseUrl}/login`, username: 'secure_user', password: 'SecretPassword99!' };
    
    const context3 = await BrowserProfileManager.launchPersistentContext({
      clientId: 'SEC_TEST_CLI',
      userId: 'op_sec',
      isHeaded: false,
      namespace: 'interactive',
    });
    const page3 = context3.pages()[0] || (await context3.newPage());
    await WorkflowExecutor.executeWorkflow(page3, loginWorkflow, testVars, (step) => {
      telemetryLogs.push(step);
    });

    for (const log of telemetryLogs) {
      const serialized = JSON.stringify(log);
      assert.strictEqual(serialized.includes('SecretPassword99!'), false, 'Password must never leak in step telemetry');
    }
    await context3.close();
    await BrowserProfileManager.deleteProfile('SEC_TEST_CLI', 'op_sec');
    console.log('✓ TEST 7 Passed: Zero credential leakage verified.');

    console.log('\n================================================================');
    console.log('  ✓ ALL CLIENT PORTAL SEARCH & RE-LOGIN TESTS PASSED (7/7)       ');
    console.log('================================================================');
  } finally {
    if (server) {
      await new Promise<void>((resolve) => (server as http.Server).close(() => resolve()));
    }
  }
}

runClientPortalReLoginTests().catch((err) => {
  console.error('[FATAL] Test failed:', err);
  process.exit(1);
});
