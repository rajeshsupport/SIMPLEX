import { chromium, BrowserContext, Page } from 'playwright';
import * as http from 'http';
import * as assert from 'assert';
import { startFixtureServer } from '../fixture/server.js';
import { BrowserProfileManager } from '../engine/profile-manager.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { WorkflowVersionConfig, AutomationRunStepTelemetry } from '@hmc/shared';

async function runAutoLoginTests() {
  console.log('================================================================');
  console.log('          OPEN & AUTO-LOGIN AUTOMATED VERIFICATION SUITE         ');
  console.log('================================================================\n');

  let server: http.Server | null = null;
  const fixturePort = 4005;
  const baseUrl = `http://127.0.0.1:${fixturePort}`;

  const defaultLoginWorkflow: WorkflowVersionConfig = {
    versionNumber: 1,
    applicableAppVersion: 'v1.0',
    pageRoute: '/hmc/login',
    defaultTimeoutMs: 5000,
    maxRetries: 1,
    steps: [
      {
        stepIndex: 1,
        stepName: 'Opening client URL…',
        action: 'NAVIGATE',
        valueTemplate: '{{loginUrl}}',
        timeoutMs: 5000,
      },
      {
        stepIndex: 2,
        stepName: 'Enter Username',
        action: 'FILL',
        targetSelector: {
          strategy: 'TEST_ID',
          value: 'input-username',
          fallbackSelectors: [{ strategy: 'ID', value: 'username' }],
        },
        valueTemplate: '{{username}}',
        timeoutMs: 5000,
      },
      {
        stepIndex: 3,
        stepName: 'Entering credentials securely…',
        action: 'FILL',
        targetSelector: {
          strategy: 'TEST_ID',
          value: 'input-password',
          fallbackSelectors: [{ strategy: 'ID', value: 'password' }],
        },
        valueTemplate: '{{password}}',
        timeoutMs: 5000,
      },
      {
        stepIndex: 4,
        stepName: 'Click Sign In Button',
        action: 'CLICK',
        targetSelector: {
          strategy: 'TEST_ID',
          value: 'btn-login',
          fallbackSelectors: [{ strategy: 'ID', value: 'btnLogin' }],
        },
        timeoutMs: 5000,
      },
      {
        stepIndex: 5,
        stepName: 'Verifying login…',
        action: 'WAIT_FOR_ELEMENT',
        targetSelector: {
          strategy: 'TEST_ID',
          value: 'hmc-dashboard',
          fallbackSelectors: [{ strategy: 'ID', value: 'hmc-dashboard' }],
        },
        timeoutMs: 8000,
      },
    ],
    successConditions: [
      { type: 'URL_CONTAINS', expectedValue: '/hmc/dashboard', isTerminalSuccess: true },
      { type: 'ELEMENT_VISIBLE', selector: { strategy: 'TEST_ID', value: 'hmc-dashboard' }, isTerminalSuccess: true },
    ],
    errorConditions: [
      { type: 'TEXT_PRESENT', expectedValue: 'Invalid credentials', isTerminalError: true, errorMessage: 'Client login was unsuccessful. Verify the stored credentials.' },
    ],
    securityBlockConditions: [
      { type: 'ELEMENT_VISIBLE', selector: { strategy: 'TEST_ID', value: 'mfa-challenge' }, isSecurityControlBlock: true, errorMessage: 'Manual security verification is required in the opened browser window.' },
    ],
  };

  try {
    server = await startFixtureServer(fixturePort);

    // TEST 1: First-Time Headed Auto-Login Execution
    console.log('[TEST 1] Testing First-Time Headed Auto-Login Execution...');
    const clientId1 = 'TEST_CLI_AUTO_01';
    const userId1 = 'operator_1';

    const context1 = await BrowserProfileManager.launchPersistentContext({
      clientId: clientId1,
      userId: userId1,
      isHeaded: false,
    });

    const page1 = context1.pages()[0] || (await context1.newPage());
    const stepsTelemetry1: AutomationRunStepTelemetry[] = [];

    const result1 = await WorkflowExecutor.executeWorkflow(
      page1,
      defaultLoginWorkflow,
      {
        loginUrl: `${baseUrl}/hmc/login`,
        username: 'test_operator',
        password: 'SecureOperatorPassword2026!',
      },
      (step) => stepsTelemetry1.push(step)
    );

    assert.strictEqual(result1.success, true, 'Result should be successful');
    assert.strictEqual(result1.status, 'COMPLETED', 'Status should be COMPLETED');
    assert.ok(page1.url().includes('/hmc/dashboard'), 'Should navigate to dashboard');
    console.log('✓ TEST 1 PASSED: Successfully navigated, filled credentials, and verified dashboard.');
    await context1.close();

    // TEST 2: Existing Authenticated Session Reuse
    console.log('\n[TEST 2] Testing Session Reuse without Re-login...');
    const clientId2 = 'TEST_CLI_REUSE_02';
    const userId2 = 'operator_2';

    // Establish session
    const ctxA = await BrowserProfileManager.launchPersistentContext({ clientId: clientId2, userId: userId2, isHeaded: false });
    const pageA = ctxA.pages()[0] || (await ctxA.newPage());
    await pageA.goto(`${baseUrl}/hmc/login`);
    await pageA.fill('[data-testid="input-username"]', 'test_user');
    await pageA.fill('[data-testid="input-password"]', 'test_pass');
    await pageA.click('[data-testid="btn-login"]');
    await pageA.waitForURL('**/hmc/dashboard');
    await ctxA.close();

    // Re-launch in same persistent context
    const ctxB = await BrowserProfileManager.launchPersistentContext({ clientId: clientId2, userId: userId2, isHeaded: false });
    const pageB = ctxB.pages()[0] || (await ctxB.newPage());
    const stepsTelemetry2: AutomationRunStepTelemetry[] = [];

    const result2 = await WorkflowExecutor.executeWorkflow(
      pageB,
      defaultLoginWorkflow,
      {
        loginUrl: `${baseUrl}/hmc/dashboard`,
        username: 'test_user',
        password: 'test_pass',
      },
      (step) => stepsTelemetry2.push(step)
    );

    assert.strictEqual(result2.success, true);
    assert.strictEqual(result2.status, 'COMPLETED');
    assert.ok(pageB.url().includes('/hmc/dashboard'));
    console.log('✓ TEST 2 PASSED: Existing active session recognized and reused immediately.');
    await ctxB.close();

    // TEST 3: Bad Credentials Rejection
    console.log('\n[TEST 3] Testing Bad Credentials Error Mapping...');
    const clientId3 = 'TEST_CLI_BAD_CREDS_03';
    const userId3 = 'operator_3';

    const context3 = await BrowserProfileManager.launchPersistentContext({ clientId: clientId3, userId: userId3, isHeaded: false });
    const page3 = context3.pages()[0] || (await context3.newPage());

    const result3 = await WorkflowExecutor.executeWorkflow(
      page3,
      defaultLoginWorkflow,
      {
        loginUrl: `${baseUrl}/hmc/login`,
        username: 'invalid_user',
        password: 'WrongPassword123!',
      }
    );

    assert.strictEqual(result3.success, false);
    assert.strictEqual(result3.status, 'FAILED');
    assert.strictEqual(result3.errorMessage, 'Client login was unsuccessful. Verify the stored credentials.');
    console.log('✓ TEST 3 PASSED: Credential rejection mapped to friendly error.');
    await context3.close();

    // TEST 4: Missing Selectors Error Mapping
    console.log('\n[TEST 4] Testing Selector Mismatch Error Mapping...');
    const clientId4 = 'TEST_CLI_BAD_SEL_04';
    const userId4 = 'operator_4';

    const brokenWorkflow: WorkflowVersionConfig = {
      ...defaultLoginWorkflow,
      steps: [
        {
          stepIndex: 1,
          stepName: 'Opening client URL…',
          action: 'NAVIGATE',
          valueTemplate: '{{loginUrl}}',
          timeoutMs: 3000,
        },
        {
          stepIndex: 2,
          stepName: 'Enter Username',
          action: 'FILL',
          targetSelector: {
            strategy: 'ID',
            value: 'non_existent_username_field_999',
          },
          valueTemplate: '{{username}}',
          timeoutMs: 1500,
        },
      ],
    };

    const context4 = await BrowserProfileManager.launchPersistentContext({ clientId: clientId4, userId: userId4, isHeaded: false });
    const page4 = context4.pages()[0] || (await context4.newPage());

    const result4 = await WorkflowExecutor.executeWorkflow(
      page4,
      brokenWorkflow,
      {
        loginUrl: `${baseUrl}/hmc/login`,
        username: 'test_user',
        password: 'test_password',
      }
    );

    assert.strictEqual(result4.success, false);
    assert.strictEqual(result4.status, 'FAILED');
    assert.strictEqual(result4.errorMessage, 'Automatic login fields could not be identified. Update the client selector configuration.');
    console.log('✓ TEST 4 PASSED: Missing selectors mapped to friendly configuration error.');
    await context4.close();

    // TEST 5: MFA/CAPTCHA Security Control Safe Intervention State
    console.log('\n[TEST 5] Testing MFA/CAPTCHA Detection and Manual Intervention State...');
    const clientId5 = 'TEST_CLI_MFA_05';
    const userId5 = 'operator_5';

    const context5 = await BrowserProfileManager.launchPersistentContext({ clientId: clientId5, userId: userId5, isHeaded: false });
    const page5 = context5.pages()[0] || (await context5.newPage());

    const result5 = await WorkflowExecutor.executeWorkflow(
      page5,
      defaultLoginWorkflow,
      {
        loginUrl: `${baseUrl}/hmc/login?mfa=true`,
        username: 'test_user',
        password: 'test_password',
      }
    );

    assert.strictEqual(result5.success, false);
    assert.strictEqual(result5.status, 'REQUIRES_MANUAL_INTERVENTION');
    assert.strictEqual(result5.errorMessage, 'Manual security verification is required in the opened browser window.');
    console.log('✓ TEST 5 PASSED: MFA challenge detected, safe manual-intervention state triggered.');
    await context5.close();

    // TEST 6: Multi-Client Profile Isolation
    console.log('\n[TEST 6] Testing Multi-Client Profile Path Isolation...');
    const profileA = BrowserProfileManager.getProfilePath('CLIENT_ALPHA', 'USER_1');
    const profileB = BrowserProfileManager.getProfilePath('CLIENT_BETA', 'USER_1');

    assert.notStrictEqual(profileA, profileB);
    assert.ok(profileA.includes('client_CLIENT_ALPHA'));
    assert.ok(profileB.includes('client_CLIENT_BETA'));
    console.log('✓ TEST 6 PASSED: Strict profile directory isolation verified.');

    console.log('\n✓ ALL 6 OPEN & AUTO-LOGIN AUTOMATION TESTS COMPLETED SUCCESSFULLY.');
  } finally {
    if (server) {
      await new Promise<void>((resolve) => (server as http.Server).close(() => resolve()));
    }
  }
}

runAutoLoginTests().catch((err) => {
  console.error('[FATAL] Auto-login test failed:', err);
  process.exit(1);
});
