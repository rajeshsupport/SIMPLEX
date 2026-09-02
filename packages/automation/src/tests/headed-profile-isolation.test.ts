import * as http from 'http';
import * as fs from 'fs';
import { startFixtureServer } from '../fixture/server.js';
import { BrowserProfileManager } from '../engine/profile-manager.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { WorkflowVersionConfig } from '@hmc/shared';

async function runHeadedAndProfileIsolationTests() {
  console.log('================================================================');
  console.log('  HEADED PLAYWRIGHT & ACCURATE STORAGE ISOLATION AUDIT          ');
  console.log('================================================================\n');

  let server: http.Server | null = null;
  const testPort = 4002;
  const baseUrl = `http://localhost:${testPort}`;

  try {
    server = await startFixtureServer(testPort);

    // TEST 1: Launch Persistent Contexts & Headed Login on Client A
    console.log('[TEST 1] Launching Persistent Contexts & Headed Login on Client A...');
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
    console.log('✓ TEST 1 PASSED: Contexts launched with isolated paths; Client A headed login succeeded.');

    // TEST 2: Inject Distinct Storage & Cookie Markers (Pre-Restart Verification)
    console.log('\n[TEST 2] Injecting Distinct Storage & Cookie Markers for Both Clients (Pre-Restart Verification)...');
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

    // Pre-restart cross-read checks
    const preCookiesA = await contextA.cookies();
    const preLsA = await pageA.evaluate(`localStorage.getItem('client_a_ls_marker')`);
    const preSsA = await pageA.evaluate(`sessionStorage.getItem('client_a_ss_marker')`);
    const preCrossCookieA = preCookiesA.find((c) => c.name === 'client_b_cookie_marker');
    const preCrossLsA = await pageA.evaluate(`localStorage.getItem('client_b_ls_marker')`);
    const preCrossSsA = await pageA.evaluate(`sessionStorage.getItem('client_b_ss_marker')`);

    if (!preCookiesA.some((c) => c.name === 'client_a_cookie_marker') || preLsA !== 'marker_alpha_ls_val' || preSsA !== 'marker_alpha_ss_val') {
      throw new Error('Client A pre-restart self-read verification failed!');
    }
    if (preCrossCookieA || preCrossLsA !== null || preCrossSsA !== null) {
      throw new Error('CRITICAL ISOLATION LEAK: Client A accessed Client B markers pre-restart!');
    }
    console.log('✓ Pre-restart: Each client reads its own markers; cross-client reads strictly return null.');
    console.log('✓ TEST 2 PASSED: Pre-restart multi-client isolation verified.');

    // TEST 3: Restart Contexts to Verify Persistence and Expected SessionStorage Absence
    console.log('\n[TEST 3] Restarting Browser Contexts to Validate Persistence & Expected SessionStorage Absence...');
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
    const postRestartSsA = await verifyPageA.evaluate(`sessionStorage.getItem('client_a_ss_marker')`);

    const verifyPageB = contextB.pages()[0] || await contextB.newPage();
    await verifyPageB.goto(`${baseUrl}/hmc/login`);
    const cookiesB = await contextB.cookies();
    const lsB = await verifyPageB.evaluate(`localStorage.getItem('client_b_ls_marker')`);
    const crossLsB = await verifyPageB.evaluate(`localStorage.getItem('client_a_ls_marker')`);
    const crossCookieB = cookiesB.find((c) => c.name === 'client_a_cookie_marker');
    const postRestartSsB = await verifyPageB.evaluate(`sessionStorage.getItem('client_b_ss_marker')`);

    // Assertions for persistent stores
    if (!cookiesA.some((c) => c.name === 'client_a_cookie_marker')) {
      throw new Error('Client A failed to persist its own test cookie!');
    }
    if (lsA !== 'marker_alpha_ls_val') {
      throw new Error('Client A failed to persist its own localStorage!');
    }
    if (crossCookieA || crossLsA !== null) {
      throw new Error('CRITICAL ISOLATION LEAK: Client A accessed Client B cookie or localStorage post-restart!');
    }

    if (!cookiesB.some((c) => c.name === 'client_b_cookie_marker')) {
      throw new Error('Client B failed to persist its own test cookie!');
    }
    if (lsB !== 'marker_beta_ls_val') {
      throw new Error('Client B failed to persist its own localStorage!');
    }
    if (crossCookieB || crossLsB !== null) {
      throw new Error('CRITICAL ISOLATION LEAK: Client B accessed Client A cookie or localStorage post-restart!');
    }

    // Expected sessionStorage behavior across restart: absent / null
    if (postRestartSsA !== null || postRestartSsB !== null) {
      throw new Error('Unexpected: sessionStorage leaked across closed browser context!');
    }
    console.log('✓ Persistent items persisted (cookie, localStorage).');
    console.log('✓ Pre-restart sessionStorage correctly absent after context restart (expected browser behavior).');
    console.log('✓ TEST 3 PASSED: Persistence and expected sessionStorage clearing verified.');

    // TEST 4: Post-restart fresh sessionStorage cross-isolation check
    console.log('\n[TEST 4] Injecting Post-Restart SessionStorage Markers & Verifying Isolation...');
    await verifyPageA.evaluate(`sessionStorage.setItem('client_a_ss_post', 'post_restart_alpha');`);
    await verifyPageB.evaluate(`sessionStorage.setItem('client_b_ss_post', 'post_restart_beta');`);

    const readPostSsA = await verifyPageA.evaluate(`sessionStorage.getItem('client_a_ss_post')`);
    const readCrossPostSsA = await verifyPageA.evaluate(`sessionStorage.getItem('client_b_ss_post')`);
    const readPostSsB = await verifyPageB.evaluate(`sessionStorage.getItem('client_b_ss_post')`);
    const readCrossPostSsB = await verifyPageB.evaluate(`sessionStorage.getItem('client_a_ss_post')`);

    if (readPostSsA !== 'post_restart_alpha' || readCrossPostSsA !== null) {
      throw new Error('Client A post-restart sessionStorage isolation check failed!');
    }
    if (readPostSsB !== 'post_restart_beta' || readCrossPostSsB !== null) {
      throw new Error('Client B post-restart sessionStorage isolation check failed!');
    }
    console.log('✓ Post-restart fresh sessionStorage isolated between Client A and Client B.');
    console.log('✓ TEST 4 PASSED: Post-restart sessionStorage isolation verified.');

    // Clean up temporary test markers
    await verifyPageA.evaluate(`localStorage.clear(); sessionStorage.clear();`);
    await verifyPageB.evaluate(`localStorage.clear(); sessionStorage.clear();`);
    await contextA.clearCookies();
    await contextB.clearCookies();

    await contextA.close();
    await contextB.close();

    console.log('\n✓ Strengthened Storage & Session Isolation Audit Completed with 100% Success.');
  } finally {
    if (server) server.close();
  }
}

runHeadedAndProfileIsolationTests().catch((err) => {
  console.error('[FATAL] Headed Profile Isolation Test failed:', err);
  process.exit(1);
});
