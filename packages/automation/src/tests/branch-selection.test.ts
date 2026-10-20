import * as http from 'http';
import * as assert from 'assert';
import { chromium } from 'playwright';
import { startFixtureServer, fixtureBranchState } from '../fixture/server.js';
import { ResourceManagementExecutor } from '../engine/resource-management-executor.js';

async function runBranchSelectionTests() {
  console.log('================================================================');
  console.log('   MASTER V9.4 MANDATORY /userBaseBranch TEST SUITE             ');
  console.log('================================================================\n');

  let server: http.Server | null = null;
  const fixturePort = 4055;
  const baseUrl = `http://127.0.0.1:${fixturePort}`;
  let browser: any = null;

  try {
    server = await startFixtureServer(fixturePort);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    // ------------------------------------------------------------------------
    // TEST 1: Detect /userBaseBranch, select exact targetBranch via normalized equality, verify active branch, and create resource
    // ------------------------------------------------------------------------
    console.log('[TEST 1] Testing normalized equality branch selection on /userBaseBranch and active context verification...');
    fixtureBranchState.reset();
    fixtureBranchState.enabled = true;
    fixtureBranchState.branches = [
      { id: 'GAG', name: '  GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC  ' },
      { id: 'BR-001', name: 'MAIN HOSPITAL CAMPUS' },
    ];

    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    let postCount1 = 0;
    page1.on('request', (req: any) => {
      if (req.method() === 'POST' && req.url().includes('/userBaseBranch')) {
        postCount1++;
      }
    });

    const res1 = await ResourceManagementExecutor.createResource(page1, {
      addResourceUrl: `${baseUrl}/MasterV9.4/addResourceParentDetails`,
      resource: {
        resourceName: `Dr. Branch Test 1`,
        isResourceHuman: true,
        resourceType: 'Consultant Physician',
        specialty: 'Cardiology',
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      targetBranch: 'gaelan medical care one day surgery hospital llc', // case-insensitive & trimmed
    });

    assert.strictEqual(res1.success, true, 'Resource creation must succeed after branch selection');
    assert.strictEqual(postCount1, 1, 'Branch confirmation action must be completed exactly once');
    assert.strictEqual(fixtureBranchState.activeBranch, 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC');
    console.log('✓ TEST 1 Passed: /userBaseBranch detected, normalized branch selected, confirmed exactly once, active context verified.');
    await context1.close();

    // ------------------------------------------------------------------------
    // TEST 2: When Central provides no branch and exactly one branch is available, auto-select verified default
    // ------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing auto-selection of verified single branch when Central provides no branch...');
    fixtureBranchState.reset();
    fixtureBranchState.enabled = true;
    fixtureBranchState.branches = [
      { id: 'GAG', name: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC' },
    ];

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    const res2 = await ResourceManagementExecutor.createResource(page2, {
      addResourceUrl: `${baseUrl}/MasterV9.4/addResourceParentDetails`,
      resource: {
        resourceName: `Dr. Single Branch 2`,
        isResourceHuman: true,
        resourceType: 'Consultant Physician',
        specialty: 'Neurology',
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      // targetBranch omitted
    });

    assert.strictEqual(res2.success, true, 'Must auto-select single available branch');
    assert.strictEqual(fixtureBranchState.activeBranch, 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC');
    console.log('✓ TEST 2 Passed: Single available branch auto-selected when Central omitted branch.');
    await context2.close();

    // ------------------------------------------------------------------------
    // TEST 3: Surface BRANCH_NOT_FOUND when target branch is missing from live list; halt before Submit with 0 clicks
    // ------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing BRANCH_NOT_FOUND error when target branch is missing...');
    fixtureBranchState.reset();
    fixtureBranchState.enabled = true;
    fixtureBranchState.branches = [
      { id: 'GAG', name: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC' },
      { id: 'BR-001', name: 'MAIN HOSPITAL CAMPUS' },
    ];

    const context3 = await browser.newContext();
    const page3 = await context3.newPage();

    let submitCount3 = 0;
    page3.on('request', (req: any) => {
      if (req.method() === 'POST' && (req.url().includes('/addResourceParentDetails') || req.url().includes('/userBaseBranch'))) {
        submitCount3++;
      }
    });

    const res3 = await ResourceManagementExecutor.createResource(page3, {
      addResourceUrl: `${baseUrl}/MasterV9.4/addResourceParentDetails`,
      resource: {
        resourceName: `Dr. Missing Branch 3`,
        isResourceHuman: true,
        resourceType: 'Consultant Physician',
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      targetBranch: 'Nonexistent Riyadh Clinic Branch',
    });

    assert.strictEqual(res3.success, false);
    assert.strictEqual(res3.errorCode, 'BRANCH_NOT_FOUND');
    assert.strictEqual(submitCount3, 0, 'Must halt before Submit with 0 submit clicks');
    console.log('✓ TEST 3 Passed: Surfaced BRANCH_NOT_FOUND with 0 submit clicks.');
    await context3.close();

    // ------------------------------------------------------------------------
    // TEST 4: Surface BRANCH_AMBIGUOUS when multiple branches exist and no target branch was specified
    // ------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing BRANCH_AMBIGUOUS when multiple branches exist without target...');
    fixtureBranchState.reset();
    fixtureBranchState.enabled = true;
    fixtureBranchState.branches = [
      { id: 'GAG', name: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC' },
      { id: 'BR-001', name: 'MAIN HOSPITAL CAMPUS' },
    ];

    const context4 = await browser.newContext();
    const page4 = await context4.newPage();

    const res4 = await ResourceManagementExecutor.createResource(page4, {
      addResourceUrl: `${baseUrl}/MasterV9.4/addResourceParentDetails`,
      resource: {
        resourceName: `Dr. Ambiguous Branch 4`,
        isResourceHuman: true,
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      // targetBranch omitted
    });

    assert.strictEqual(res4.success, false);
    assert.strictEqual(res4.errorCode, 'BRANCH_AMBIGUOUS');
    console.log('✓ TEST 4 Passed: Surfaced BRANCH_AMBIGUOUS when multiple branches exist without target.');
    await context4.close();

    // ------------------------------------------------------------------------
    // TEST 5: Surface BRANCH_CONFIRMATION_FAILED when confirmation action fails to establish active branch
    // ------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing BRANCH_CONFIRMATION_FAILED when confirmation fails to establish context...');
    fixtureBranchState.reset();
    fixtureBranchState.enabled = true;
    fixtureBranchState.confirmationFails = true;
    fixtureBranchState.branches = [
      { id: 'GAG', name: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC' },
    ];

    const context5 = await browser.newContext();
    const page5 = await context5.newPage();

    const res5 = await ResourceManagementExecutor.createResource(page5, {
      addResourceUrl: `${baseUrl}/MasterV9.4/addResourceParentDetails`,
      resource: {
        resourceName: `Dr. Confirm Fail 5`,
        isResourceHuman: true,
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      targetBranch: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC',
    });

    assert.strictEqual(res5.success, false);
    assert.strictEqual(res5.errorCode, 'BRANCH_CONFIRMATION_FAILED');
    console.log('✓ TEST 5 Passed: Surfaced BRANCH_CONFIRMATION_FAILED when confirmation action failed.');
    await context5.close();

    // ------------------------------------------------------------------------
    // TEST 6: Surface RESOURCE_FORM_NOT_FOUND ONLY when branch is verified but form is missing
    // ------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing RESOURCE_FORM_NOT_FOUND only when branch is verified but form is missing...');
    fixtureBranchState.reset();
    fixtureBranchState.enabled = true;
    fixtureBranchState.branches = [
      { id: 'GAG', name: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC' },
    ];

    const context6 = await browser.newContext();
    const page6 = await context6.newPage();

    const res6 = await ResourceManagementExecutor.createResource(page6, {
      addResourceUrl: `${baseUrl}/hmc/dashboard`, // page without #addResourceParent
      resource: {
        resourceName: `Dr. Missing Form 6`,
        isResourceHuman: true,
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      targetBranch: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC',
    });

    assert.strictEqual(res6.success, false);
    assert.strictEqual(res6.errorCode, 'RESOURCE_FORM_NOT_FOUND');
    console.log('✓ TEST 6 Passed: Surfaced RESOURCE_FORM_NOT_FOUND only after branch was verified.');
    await context6.close();

    // ------------------------------------------------------------------------
    // TEST 7: Regression test: Master V9.3 single-branch portal functions cleanly
    // ------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing Master V9.3 single-branch backwards compatibility...');
    fixtureBranchState.reset(); // disabled, standard single-branch mode

    const context7 = await browser.newContext();
    const page7 = await context7.newPage();

    const res7 = await ResourceManagementExecutor.createResource(page7, {
      addResourceUrl: `${baseUrl}/MasterV9.3/addResourceParentDetails`,
      resource: {
        resourceName: `Dr. V93 Regression 7`,
        isResourceHuman: true,
        resourceType: 'Consultant Physician',
        specialty: 'Cardiology',
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
    });

    console.log('res7 result:', res7);
    assert.strictEqual(res7.success, true, 'Single branch Master V9.3 creation must succeed');
    console.log('✓ TEST 7 Passed: Master V9.3 single-branch portal backwards compatibility preserved.');
    await context7.close();

    // ------------------------------------------------------------------------
    // TEST 8: Live Staging reproduction: /MasterV9.4/loginCheck org chart tree with underscore branch
    // ------------------------------------------------------------------------
    console.log('\n[TEST 8] Testing /MasterV9.4/loginCheck org chart tree branch selection with underscores...');
    fixtureBranchState.reset();
    fixtureBranchState.enabled = true;
    fixtureBranchState.useLoginCheck = true;
    fixtureBranchState.branches = [
      { id: 'ADMIN', name: 'ADMIN' },
      { id: 'GAG_OLD', name: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC' },
      { id: 'GAG_NEW', name: 'Testing_GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC New' },
    ];

    const context8 = await browser.newContext();
    const page8 = await context8.newPage();

    const res8 = await ResourceManagementExecutor.createResource(page8, {
      addResourceUrl: `${baseUrl}/MasterV9.4/addResourceParentDetails`,
      resource: {
        resourceName: `Dr. Live Staging Tree 8`,
        isResourceHuman: true,
        resourceType: 'Consultant Physician',
        specialty: 'Cardiology',
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      targetBranch: 'Testing_GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC New',
    });

    console.log('res8 result:', res8);
    assert.strictEqual(res8.success, true, 'Resource creation on /loginCheck must succeed');
    assert.strictEqual(
      fixtureBranchState.activeBranch,
      'Testing_GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC New',
      'Target branch with underscores must be selected in org chart tree'
    );
    console.log('✓ TEST 8 Passed: /MasterV9.4/loginCheck interactive org chart tree selected Testing_GAELAN successfully.');
    await context8.close();

    // ------------------------------------------------------------------------
    // TEST 9: Live Staging reproduction: /MasterV9.4/userBaseBranch org chart tree with navbar buttons
    // ------------------------------------------------------------------------
    console.log('\n[TEST 9] Testing /MasterV9.4/userBaseBranch org chart tree with navbar buttons...');
    fixtureBranchState.reset();
    fixtureBranchState.enabled = true;
    fixtureBranchState.useTreeOnUserBaseBranch = true;
    fixtureBranchState.branches = [
      { id: 'ADMIN', name: 'ADMIN' },
      { id: 'GAG_OLD', name: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC' },
      { id: 'GAG_NEW', name: 'Testing_GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC New' },
    ];

    const context9 = await browser.newContext();
    const page9 = await context9.newPage();

    const res9 = await ResourceManagementExecutor.createResource(page9, {
      addResourceUrl: `${baseUrl}/MasterV9.4/addResourceParentDetails`,
      resource: {
        resourceName: `Dr. Live Staging UserBaseBranch Tree 9`,
        isResourceHuman: true,
        resourceType: 'Consultant Physician',
        specialty: 'Cardiology',
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      targetBranch: 'Testing_GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC New',
    });

    console.log('res9 result:', res9);
    assert.strictEqual(res9.success, true, 'Resource creation on /userBaseBranch tree must succeed');
    assert.strictEqual(
      fixtureBranchState.activeBranch,
      'Testing_GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC New',
      'Target branch must be selected on /userBaseBranch tree'
    );
    console.log('✓ TEST 9 Passed: /MasterV9.4/userBaseBranch interactive org chart tree selected Testing_GAELAN without clicking navbar buttons.');
    await context9.close();

    console.log('\n================================================================');
    console.log('✓ ALL 9/9 BRANCH SELECTION AUTOMATION TESTS PASSED PERFECTLY');
    console.log('================================================================');
  } finally {
    if (browser) await browser.close();
    if (server) {
      await new Promise<void>((res) => server!.close(() => res()));
    }
  }
}

runBranchSelectionTests().catch((err) => {
  console.error('[FATAL TEST ERROR]', err);
  process.exit(1);
});
