import * as http from 'http';
import * as fs from 'fs';
import { startFixtureServer } from '../fixture/server.js';
import { BrowserProfileManager } from '../engine/profile-manager.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { WorkflowVersionConfig } from '@hmc/shared';

async function runHeadedAndProfileIsolationTests() {
  console.log('================================================================');
  console.log('  HEADED PLAYWRIGHT & STRENGTHENED SESSION ISOLATION AUDIT      ');
  console.log('================================================================\n');

  let server: http.Server | null = null;
  const testPort = 4002;
  const baseUrl = `http://localhost:${testPort}`;

  try {
    server = await startFixtureServer(testPort);

    // 1. Launch Persistent Contexts for Client A and Client B
    console.log('[TEST 1] Launching Isolated Headed Persistent Contexts...');
    let contextA = await BrowserProfileManager.launchPersistentContext({
      clientId: 'HOSP_ALPHA',
      userId: 'OPERATOR_1',
      isHeaded: true,
      slowMo: 30,
    });

    let contextB = await BrowserProfileManager.launchPersistentContext({
      clientId: 'HOSP_BETA',
      userId: 'OPERATOR_1',
      isHeaded: true,
      slowMo: 30,
    });

    const pathA = BrowserProfileManager.getProfilePath('HOSP_ALPHA', 'OPERATOR_1');
    const pathB = BrowserProfileManager.getProfilePath('HOSP_BETA', 'OPERATOR_1');

    console.log(`✓ Client A profile path: ${pathA}`);
    console.log(`✓ Client B profile path: ${pathB}`);
    if (pathA === pathB) {
      throw new Error('Client A and Client B share the same profile path! Isolation failed.');
    }

    // 2. Perform Headed Login on Client A
    console.log('\n[TEST 2] Performing Headed Workflow Login on Client A...');
    const pageA = contextA.pages()[0] || await contextA.newPage();
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
      successConditions: [{ type: 'URL_CONTAINS', expectedValue: '/hmc/dashboard', isTerminalSuccess: true }],
      errorConditions: [],
      securityBlockConditions: [],
      defaultTimeoutMs: 10000,
      maxRetries: 1,
    };
    const loginRes = await WorkflowExecutor.executeWorkflow(pageA, loginWorkflow, {});
    if (!loginRes.success) throw new Error('Client A headed login failed');
    console.log('✓ TEST 2 PASSED: Client A logged in and navigated to dashboard in headed Chromium.');

    // 3. Insert Distinct Non-Secret Cookies, LocalStorage, and SessionStorage Markers
    console.log('\n[TEST 3] Injecting Distinct Storage & Cookie Markers for Both Clients...');
    // Add non-secret persistent test cookie to Client A
    const cookieExpiry = Math.floor(Date.now() / 1000) + 86400; // 24 hours
    await contextA.addCookies([
      { name: 'client_a_cookie_marker', value: 'marker_alpha_val', domain: 'localhost', path: '/', expires: cookieExpiry },
    ]);
    await pageA.evaluate(`
      localStorage.setItem('client_a_ls_marker', 'marker_alpha_ls_val');
      sessionStorage.setItem('client_a_ss_marker', 'marker_alpha_ss_val');
    `);

    const pageB = contextB.pages()[0] || await contextB.newPage();
    await pageB.goto(`${baseUrl}/hmc/login`);
    await contextB.addCookies([
      { name: 'client_b_cookie_marker', value: 'marker_beta_val', domain: 'localhost', path: '/', expires: cookieExpiry },
    ]);
    await pageB.evaluate(`
      localStorage.setItem('client_b_ls_marker', 'marker_beta_ls_val');
      sessionStorage.setItem('client_b_ss_marker', 'marker_beta_ss_val');
    `);
    console.log('✓ Inserted markers:');
    console.log('  - Client A: cookie "client_a_cookie_marker", localStorage "client_a_ls_marker", sessionStorage "client_a_ss_marker"');
    console.log('  - Client B: cookie "client_b_cookie_marker", localStorage "client_b_ls_marker", sessionStorage "client_b_ss_marker"');

    // 4. Restart Contexts to Verify Persistence and Cross-Profile Isolation
    console.log('\n[TEST 4] Restarting Browser Contexts to Validate Persistence & Cross-Profile Boundary...');
    await contextA.close();
    await contextB.close();

    contextA = await BrowserProfileManager.launchPersistentContext({
      clientId: 'HOSP_ALPHA',
      userId: 'OPERATOR_1',
      isHeaded: true,
      slowMo: 20,
    });
    contextB = await BrowserProfileManager.launchPersistentContext({
      clientId: 'HOSP_BETA',
      userId: 'OPERATOR_1',
      isHeaded: true,
      slowMo: 20,
    });

    const verifyPageA = contextA.pages()[0] || await contextA.newPage();
    await verifyPageA.goto(`${baseUrl}/hmc/login`);
    const cookiesA = await contextA.cookies();
    const lsA = await verifyPageA.evaluate(`localStorage.getItem('client_a_ls_marker')`);
    const crossLsA = await verifyPageA.evaluate(`localStorage.getItem('client_b_ls_marker')`);
    const crossCookieA = cookiesA.find((c) => c.name === 'client_b_cookie_marker');

    const verifyPageB = contextB.pages()[0] || await contextB.newPage();
    await verifyPageB.goto(`${baseUrl}/hmc/login`);
    const cookiesB = await contextB.cookies();
    const lsB = await verifyPageB.evaluate(`localStorage.getItem('client_b_ls_marker')`);
    const crossLsB = await verifyPageB.evaluate(`localStorage.getItem('client_a_ls_marker')`);
    const crossCookieB = cookiesB.find((c) => c.name === 'client_a_cookie_marker');

    // Assertions
    if (!cookiesA.some((c) => c.name === 'client_a_cookie_marker')) {
      throw new Error('Client A failed to persist its own test cookie!');
    }
    if (lsA !== 'marker_alpha_ls_val') {
      throw new Error('Client A failed to persist its own localStorage!');
    }
    if (crossCookieA || crossLsA !== null) {
      throw new Error('CRITICAL ISOLATION LEAK: Client A accessed Client B cookie or localStorage!');
    }

    if (!cookiesB.some((c) => c.name === 'client_b_cookie_marker')) {
      throw new Error('Client B failed to persist its own test cookie!');
    }
    if (lsB !== 'marker_beta_ls_val') {
      throw new Error('Client B failed to persist its own localStorage!');
    }
    if (crossCookieB || crossLsB !== null) {
      throw new Error('CRITICAL ISOLATION LEAK: Client B accessed Client A cookie or localStorage!');
    }

    console.log('✓ Verified: Client A holds only Client A markers (0 cross-reads)');
    console.log('✓ Verified: Client B holds only Client B markers (0 cross-reads)');
    console.log('✓ TEST 4 PASSED: 100% strict cookie and web-storage isolation confirmed between Client A and Client B.');

    // 5. Clean up temporary test markers
    await verifyPageA.evaluate(`localStorage.clear(); sessionStorage.clear();`);
    await verifyPageB.evaluate(`localStorage.clear(); sessionStorage.clear();`);
    await contextA.clearCookies();
    await contextB.clearCookies();

    await contextA.close();
    await contextB.close();

    console.log('\n✓ Strengthened Session Isolation Audit Completed with 100% Success.');
  } finally {
    if (server) server.close();
  }
}

runHeadedAndProfileIsolationTests().catch((err) => {
  console.error('[FATAL] Headed Profile Isolation Test failed:', err);
  process.exit(1);
});
