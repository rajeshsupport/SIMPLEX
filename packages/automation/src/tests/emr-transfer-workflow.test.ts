import * as http from 'http';
import * as assert from 'assert';
import { chromium } from 'playwright';
import { startFixtureServer } from '../fixture/server.js';
import { ResourceManagementExecutor } from '../engine/resource-management-executor.js';

async function runEmrTransferTests() {
  console.log('================================================================');
  console.log('       EMR FORM TRANSFER AUTOMATED WORKFLOW TEST SUITE          ');
  console.log('================================================================\n');

  let server: http.Server | null = null;
  const fixturePort = 4055;
  const baseUrl = `http://127.0.0.1:${fixturePort}`;
  let browser: any = null;

  try {
    server = await startFixtureServer(fixturePort);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    // ------------------------------------------------------------------------
    // TEST 1: Exact Form-Name Equality Rejection of Substring / Partial Names
    // ------------------------------------------------------------------------
    console.log('[TEST 1] Testing exact form-name equality (rejecting substring / partial match)...');
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    const partialRes = await ResourceManagementExecutor.transferGroupForms(page1, {
      emrPanelUrl: `${baseUrl}/emrPanelSelection`,
      username: 'dr_sarah',
      formIds: ['CLINICIANS'], // Partial/substring of 'OP - CLINICIANS'
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
    });

    assert.strictEqual(partialRes.success, false, 'Partial/substring form name should be rejected');
    assert.strictEqual(partialRes.errorCode, 'EMR_FORM_NOT_FOUND', 'Should return EMR_FORM_NOT_FOUND for partial name');
    console.log('✓ TEST 1 Passed: Exact form-name equality enforced, partial match rejected.');
    await context1.close();

    // ------------------------------------------------------------------------
    // TEST 2: Successful Form Selection, Branch Autocomplete, User Match, and ADD
    // ------------------------------------------------------------------------
    console.log('[TEST 2] Testing successful EMR form transfer with exact form name, branch, user, and DOM read-back...');
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    const transferRes = await ResourceManagementExecutor.transferGroupForms(page2, {
      emrPanelUrl: `${baseUrl}/emrPanelSelection`,
      targetBranchName: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC',
      username: 'dr_sarah',
      formIds: ['OP - CLINICIANS'],
      defaultFormIndicator: 'Yes',
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      onProgress: (m) => console.log(`  [Progress] ${m}`),
    });

    assert.strictEqual(transferRes.success, true, 'Transfer should succeed with exact parameters');
    assert.strictEqual(transferRes.transferredCount, 1, 'Should transfer 1 form');
    console.log('✓ TEST 2 Passed: Transfer completed and verified through remote DOM.');
    await context2.close();

    // ------------------------------------------------------------------------
    // TEST 3: User Not Found in Branch Rejection
    // ------------------------------------------------------------------------
    console.log('[TEST 3] Testing rejection when user is not found in selected branch...');
    const context3 = await browser.newContext();
    const page3 = await context3.newPage();

    const missingUserRes = await ResourceManagementExecutor.transferGroupForms(page3, {
      emrPanelUrl: `${baseUrl}/emrPanelSelection`,
      targetBranchId: 'GAG',
      username: 'non_existent_physician_9999',
      formIds: ['OP - CLINICIANS'],
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
    });

    assert.strictEqual(missingUserRes.success, false, 'Should fail when user does not exist in branch');
    assert.strictEqual(missingUserRes.errorCode, 'USER_NOT_FOUND_IN_BRANCH', 'Should return USER_NOT_FOUND_IN_BRANCH');
    console.log('✓ TEST 3 Passed: Missing branch user rejected with clear error code.');
    await context3.close();

    console.log('\n================================================================');
    console.log('       ALL EMR TRANSFER WORKFLOW AUTOMATED TESTS PASSED!        ');
    console.log('================================================================');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve())).catch(() => {});
  }
}

runEmrTransferTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
