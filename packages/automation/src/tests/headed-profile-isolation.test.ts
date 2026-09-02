import * as http from 'http';
import * as fs from 'fs';
import { startFixtureServer } from '../fixture/server.js';
import { BrowserProfileManager } from '../engine/profile-manager.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { WorkflowVersionConfig } from '@hmc/shared';

async function runHeadedAndProfileIsolationTests() {
  console.log('================================================================');
  console.log('     HEADED PLAYWRIGHT & CLIENT SESSION ISOLATION AUDIT         ');
  console.log('================================================================\n');

  let server: http.Server | null = null;
  const testPort = 4002;
  const baseUrl = `http://localhost:${testPort}`;

  try {
    server = await startFixtureServer(testPort);

    // 1. Test Path Traversal Defense & Sanitization
    console.log('[TEST 1] Testing Path Traversal Defense & Profile Sanitization...');
    const maliciousPath = BrowserProfileManager.getProfilePath('../../etc/passwd', '../root');
    if (!maliciousPath.includes('.hmc-console/profiles')) {
      throw new Error('Path traversal sanitization failed! Path escaped profile directory.');
    }
    console.log(`✓ Path traversal attempted inputs safely sanitized to: ${maliciousPath}`);
    console.log('✓ TEST 1 PASSED: Path traversal injection prevented.');

    // 2. Test Headed Chromium Launch for Client A
    console.log('\n[TEST 2] Launching Headed Chromium for Client A (Hospital Alpha)...');
    const contextA = await BrowserProfileManager.launchPersistentContext({
      clientId: 'HOSP_ALPHA',
      userId: 'OPERATOR_1',
      isHeaded: true, // Visible browser mode
      slowMo: 50,
    });

    const pathA = BrowserProfileManager.getProfilePath('HOSP_ALPHA', 'OPERATOR_1');
    console.log(`✓ Client A profile path: ${pathA}`);

    // Verify 0700 directory permissions on POSIX
    if (process.platform !== 'win32') {
      const stats = fs.statSync(pathA);
      const modeOctal = (stats.mode & 0o777).toString(8);
      console.log(`✓ Directory permissions verified: 0${modeOctal} (Owner read/write/execute only)`);
      if (modeOctal !== '700') {
        throw new Error(`Profile directory has insecure permissions: 0${modeOctal}`);
      }
    }

    const pageA = contextA.pages()[0] || await contextA.newPage();

    // Execute Login on Client A
    const loginWorkflow: WorkflowVersionConfig = {
      versionNumber: 1,
      applicableAppVersion: 'v1.0',
      pageRoute: '/hmc/login',
      steps: [
        { stepIndex: 1, stepName: 'Navigate Login', action: 'NAVIGATE', valueTemplate: `${baseUrl}/hmc/login` },
        { stepIndex: 2, stepName: 'Enter User', action: 'FILL', targetSelector: { strategy: 'TEST_ID', value: 'input-username' }, valueTemplate: 'alpha_op' },
        { stepIndex: 3, stepName: 'Enter Pass', action: 'FILL', targetSelector: { strategy: 'TEST_ID', value: 'input-password' }, valueTemplate: 'Pass123!' },
        { stepIndex: 4, stepName: 'Click Login', action: 'CLICK', targetSelector: { strategy: 'TEST_ID', value: 'btn-login' } },
        { stepIndex: 5, stepName: 'Wait Dashboard', action: 'WAIT_FOR_ELEMENT', targetSelector: { strategy: 'TEST_ID', value: 'hmc-dashboard' } },
      ],
      successConditions: [
        { type: 'URL_CONTAINS', expectedValue: '/hmc/dashboard', isTerminalSuccess: true },
      ],
      errorConditions: [],
      securityBlockConditions: [],
      defaultTimeoutMs: 10000,
      maxRetries: 1,
    };

    const loginRes = await WorkflowExecutor.executeWorkflow(pageA, loginWorkflow, {});
    if (!loginRes.success) throw new Error('Client A headed login failed');
    console.log('✓ TEST 2 PASSED: Headed Chromium logged in successfully and arrived on dashboard.');

    // 3. Test Client B Isolation (Hospital Beta)
    console.log('\n[TEST 3] Testing Client B Session Isolation (Hospital Beta)...');
    const contextB = await BrowserProfileManager.launchPersistentContext({
      clientId: 'HOSP_BETA',
      userId: 'OPERATOR_1',
      isHeaded: true,
      slowMo: 50,
    });

    const pathB = BrowserProfileManager.getProfilePath('HOSP_BETA', 'OPERATOR_1');
    console.log(`✓ Client B profile path: ${pathB}`);
    if (pathA === pathB) {
      throw new Error('Client A and Client B share the same profile path! Isolation failed.');
    }

    const pageB = contextB.pages()[0] || await contextB.newPage();
    // Try to access /hmc/dashboard directly on Client B without logging in
    await pageB.goto(`${baseUrl}/hmc/dashboard`);
    await pageB.waitForTimeout(1000);

    // Verify Client B does NOT have Client A's session cookies
    const cookiesA = await contextA.cookies();
    const cookiesB = await contextB.cookies();
    console.log(`- Client A cookies count: ${cookiesA.length}`);
    console.log(`- Client B cookies count: ${cookiesB.length}`);

    // Verify Client A cookies were not leaked to Client B
    const leakedCookies = cookiesB.filter((b) => cookiesA.some((a) => a.name === b.name && a.value === b.value && a.name.includes('session')));
    if (leakedCookies.length > 0) {
      throw new Error('Client A session cookies leaked to Client B!');
    }
    console.log('✓ TEST 3 PASSED: Strict session and cookie isolation verified between Client A and Client B.');

    await contextA.close();
    await contextB.close();
    console.log('\n✓ Headed and Profile Isolation Audit Passed Successfully.');
  } finally {
    if (server) server.close();
  }
}

runHeadedAndProfileIsolationTests().catch((err) => {
  console.error('[FATAL] Headed Profile Isolation Test failed:', err);
  process.exit(1);
});
