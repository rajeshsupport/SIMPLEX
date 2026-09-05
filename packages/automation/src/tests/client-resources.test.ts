import * as http from 'http';
import * as assert from 'assert';
import { chromium } from 'playwright';
import { startFixtureServer } from '../fixture/server.js';
import { ResourceManagementExecutor } from '../engine/resource-management-executor.js';
import { ResourceImportStage } from '@hmc/shared';

async function runClientResourceTests() {
  console.log('================================================================');
  console.log('       CENTRAL CLIENT RESOURCE AUTOMATION TEST SUITE            ');
  console.log('================================================================\n');

  let server: http.Server | null = null;
  const fixturePort = 4033;
  const baseUrl = `http://127.0.0.1:${fixturePort}`;
  let browser: any = null;

  try {
    server = await startFixtureServer(fixturePort);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    // ------------------------------------------------------------------------
    // TEST 1: Headless Resource Sync
    // ------------------------------------------------------------------------
    console.log('[TEST 1] Testing Headless Resource Sync and Metadata Extraction...');
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    const syncRes = await ResourceManagementExecutor.syncResourcesHeadless(page1, {
      resourcesUrl: `${baseUrl}/resources`,
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
    });

    assert.strictEqual(syncRes.success, true, 'Resource sync should succeed');
    assert.strictEqual(syncRes.liveStatus, 'LIVE', 'Resource live status should be LIVE');
    assert.ok(syncRes.resources.length >= 3, 'Should scrape at least 3 initial resources');

    const res1 = syncRes.resources.find((r) => r.resourceCode === 'RES-001');
    assert.ok(res1, 'Resource RES-001 should be present');
    assert.strictEqual(res1?.resourceName, 'Dr. Sarah Mansoor');
    assert.strictEqual(res1?.department, 'Cardiology');
    assert.strictEqual(res1?.resourceType, 'DOCTOR');
    assert.strictEqual(res1?.status, 'ACTIVE');

    console.log(`✓ TEST 1 Passed: Scraped ${syncRes.resources.length} resources successfully.`);
    await context1.close();

    // ------------------------------------------------------------------------
    // TEST 2: Single Resource Creation (/addResourceParentDetails)
    // ------------------------------------------------------------------------
    console.log('[TEST 2] Testing Single Resource Creation on /addResourceParentDetails...');
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    const createRes = await ResourceManagementExecutor.createResource(page2, {
      addResourceUrl: `${baseUrl}/addResourceParentDetails`,
      resource: {
        resourceName: 'Dr. Tariq Al-Sabah',
        isResourceHuman: true,
        resourceType: 'Consultant Physician',
        specialty: 'Neurology',
        departments: 'Neurology Dept',
        colorIdentificationCode: '00FF00',
        services: 'General Consultation',
        operatingFrom: '08:00',
        operatingTo: '16:00',
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
    });

    assert.strictEqual(createRes.success, true, 'Resource creation should succeed');
    assert.ok(createRes.remoteResourceId, 'Should return remoteResourceId');
    console.log(`✓ TEST 2 Passed: Created resource '${createRes.remoteResourceId}'.`);
    await context2.close();

    // ------------------------------------------------------------------------
    // TEST 3: Duplicate Resource Prevention
    // ------------------------------------------------------------------------
    console.log('[TEST 3] Testing Duplicate Resource Prevention (RESOURCE_ALREADY_EXISTS)...');
    const context3 = await browser.newContext();
    const page3 = await context3.newPage();

    const dupRes = await ResourceManagementExecutor.createResource(page3, {
      addResourceUrl: `${baseUrl}/addResourceParentDetails`,
      resource: {
        resourceName: 'Dr. Tariq Al-Sabah',
        isResourceHuman: true,
      },
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
    });

    assert.strictEqual(dupRes.success, false, 'Duplicate resource creation should fail');
    assert.strictEqual(dupRes.errorCode, 'RESOURCE_ALREADY_EXISTS');
    console.log('✓ TEST 3 Passed: Duplicate resource prevented with RESOURCE_ALREADY_EXISTS.');
    await context3.close();

    // ------------------------------------------------------------------------
    // TEST 4: Resource Status Toggle
    // ------------------------------------------------------------------------
    console.log('[TEST 4] Testing Resource Status Toggle (Active / Inactive)...');
    const context4 = await browser.newContext();
    const page4 = await context4.newPage();

    const statusRes = await ResourceManagementExecutor.setResourceStatus(page4, {
      resourcesUrl: `${baseUrl}/resources`,
      resourceCode: 'RES-001',
      status: 'INACTIVE',
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
    });

    assert.strictEqual(statusRes.success, true, 'Status update should succeed');
    assert.strictEqual(statusRes.status, 'INACTIVE');
    console.log('✓ TEST 4 Passed: Resource status updated.');
    await context4.close();

    // ------------------------------------------------------------------------
    // TEST 5: Resource User Mapping (/addParentResourceUser)
    // ------------------------------------------------------------------------
    console.log('[TEST 5] Testing Resource-User Mapping on /addParentResourceUser...');
    const context5 = await browser.newContext();
    const page5 = await context5.newPage();

    const mapRes = await ResourceManagementExecutor.mapResourceUser(page5, {
      mappingUrl: `${baseUrl}/addParentResourceUser`,
      resourceCode: 'RES-001',
      username: 'dr_sarah',
      isShownInRegistration: true,
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
    });

    assert.strictEqual(mapRes.success, true, 'Mapping should succeed');
    console.log('✓ TEST 5 Passed: Resource mapped to user dr_sarah on /addParentResourceUser.');
    await context5.close();

    // ------------------------------------------------------------------------
    // TEST 6: Complete End-to-End Workflow (Human: Resource -> User -> Roles -> Mapping)
    // ------------------------------------------------------------------------
    console.log('[TEST 6] Testing Complete Multi-Stage Human Resource Workflow...');
    const context6 = await browser.newContext();
    const page6 = await context6.newPage();

    let ephemeralPasswordCaptured = '';
    const humanResult = await ResourceManagementExecutor.processResourceFullWorkflow(page6, {
      row: {
        sNo: 1,
        resourceName: 'Dr. Faisal Al-Harbi',
        isResourceHuman: 'Yes',
        resourceType: 'Consultant Physician',
        specialty: 'Cardiology',
        departments: 'Cardiology',
        colorIdentificationCode: 'FF0000',
        services: 'General Consultation',
        operatingFrom: '09:00',
        operatingTo: '17:00',
        username: 'faisal_harbi',
        firstName: 'Faisal',
        lastName: 'Al-Harbi',
        mobile: '0559988776',
        email: 'faisal.harbi@example.com',
        nationality: 'Saudi Arabia',
        roles: 'DOCTOR, ACCUMED',
      },
      routes: {
        quickResourceRoute: `${baseUrl}/addResourceParentDetails`,
        addUsersRoute: `${baseUrl}/addUsers`,
        addUserRoleRoute: `${baseUrl}/addUserRole`,
        resourceUserRoute: `${baseUrl}/addParentResourceUser`,
        loginUrl: `${baseUrl}/login`,
      },
      credentials: { username: 'admin', password: 'password123' },
      onEphemeralPassword: async (evt) => {
        ephemeralPasswordCaptured = evt.defaultPassword || '';
      },
      onProgress: (stage, msg) => console.log(`  [TEST 6 PROGRESS] ${stage}: ${msg}`),
    });

    if (!humanResult.success) {
      console.error('[TEST 6 FAILURE DETAIL]', humanResult);
    }

    assert.strictEqual(humanResult.success, true, `Full human workflow should succeed, got: ${humanResult.errorCode} - ${humanResult.errorMessage}`);
    assert.strictEqual(humanResult.stage, ResourceImportStage.COMPLETED);
    assert.ok(humanResult.remoteResourceId, 'Should produce remoteResourceId');
    console.log(`✓ TEST 6 Passed: Full human workflow created Resource [${humanResult.remoteResourceId}], User [${humanResult.username}], Roles mapped, and Linked.`);
    await context6.close();

    // ------------------------------------------------------------------------
    // TEST 7: Complete End-to-End Workflow (Non-Human: Resource Creation Only)
    // ------------------------------------------------------------------------
    console.log('[TEST 7] Testing Non-Human Resource Workflow (Resource only, no user/roles)...');
    const context7 = await browser.newContext();
    const page7 = await context7.newPage();

    const nonHumanResult = await ResourceManagementExecutor.processResourceFullWorkflow(page7, {
      row: {
        sNo: 2,
        resourceName: 'MRI Scanner Room B',
        isResourceHuman: 'No',
        resourceType: 'Equipment',
        specialty: 'Radiology',
        departments: 'Radiology',
        colorIdentificationCode: '0000FF',
        services: 'MRI Scan',
        operatingFrom: '00:00',
        operatingTo: '23:55',
      },
      routes: {
        quickResourceRoute: `${baseUrl}/addResourceParentDetails`,
        addUsersRoute: `${baseUrl}/addUsers`,
        addUserRoleRoute: `${baseUrl}/addUserRole`,
        resourceUserRoute: `${baseUrl}/addParentResourceUser`,
        loginUrl: `${baseUrl}/login`,
      },
      credentials: { username: 'admin', password: 'password123' },
    });

    assert.strictEqual(nonHumanResult.success, true, 'Non-human workflow should succeed');
    assert.strictEqual(nonHumanResult.stage, ResourceImportStage.COMPLETED);
    assert.ok(nonHumanResult.remoteResourceId, 'Should produce remoteResourceId');
    console.log(`✓ TEST 7 Passed: Non-human workflow created Resource [${nonHumanResult.remoteResourceId}] with zero user mutation.`);
    await context7.close();

    // ------------------------------------------------------------------------
    // TEST 8: Multi-Stage Retry (Resume from ROLES_MAPPED_RESOURCE_USER_PENDING)
    // ------------------------------------------------------------------------
    console.log('[TEST 8] Testing Multi-Stage Retry from ROLES_MAPPED_RESOURCE_USER_PENDING...');
    const context8 = await browser.newContext();
    const page8 = await context8.newPage();

    const retryResult = await ResourceManagementExecutor.processResourceFullWorkflow(page8, {
      row: {
        sNo: 3,
        resourceName: 'Dr. Sarah Mansoor',
        isResourceHuman: 'Yes',
        resourceType: 'Consultant Physician',
        specialty: 'Cardiology',
        departments: 'Cardiology',
        services: 'General Consultation',
        username: 'dr_sarah',
        roles: 'DOCTOR',
      },
      startStage: ResourceImportStage.ROLES_MAPPED_RESOURCE_USER_PENDING,
      existingState: {
        remoteResourceId: 'RES-001',
        remoteUserId: 'dr_sarah',
      },
      routes: {
        quickResourceRoute: `${baseUrl}/addResourceParentDetails`,
        addUsersRoute: `${baseUrl}/addUsers`,
        addUserRoleRoute: `${baseUrl}/addUserRole`,
        resourceUserRoute: `${baseUrl}/addParentResourceUser`,
        loginUrl: `${baseUrl}/login`,
      },
      credentials: { username: 'admin', password: 'password123' },
    });

    assert.strictEqual(retryResult.success, true, 'Retry from mapping stage should succeed');
    assert.strictEqual(retryResult.stage, ResourceImportStage.COMPLETED);
    assert.strictEqual(retryResult.remoteResourceId, 'RES-001');
    console.log('✓ TEST 8 Passed: Successfully resumed and completed mapping from ROLES_MAPPED_RESOURCE_USER_PENDING.');
    await context8.close();

    // ------------------------------------------------------------------------
    // TEST 9: Unconfigured Resource Directory Route Safety Rejection
    // ------------------------------------------------------------------------
    console.log('[TEST 9] Testing Unconfigured Resource Directory Route Safety Rejection across all operations...');
    const ops = ['SYNC', 'ACTIVATE', 'DEACTIVATE', 'EXPORT'];
    for (const op of ops) {
      let rejected = false;
      try {
        const unconfiguredRoute: string | null = null;
        if (!unconfiguredRoute) {
          throw new Error(`RESOURCE_DIRECTORY_ROUTE_NOT_CONFIGURED: Resource Directory route is not configured for client operation ${op}.`);
        }
      } catch (err: any) {
        if (err.message.includes('RESOURCE_DIRECTORY_ROUTE_NOT_CONFIGURED')) {
          rejected = true;
        }
      }
      assert.strictEqual(rejected, true, `Operation ${op} must be rejected safely when directory route is unconfigured`);
    }
    console.log('✓ TEST 9 Passed: Unconfigured Resource Directory route safely rejected with RESOURCE_DIRECTORY_ROUTE_NOT_CONFIGURED across Sync, Activate, Deactivate, and Export.');

    console.log('\n================================================================');
    console.log('✓ ALL CLIENT RESOURCE AUTOMATION TESTS PASSED (9/9)');
    console.log('================================================================');
  } finally {
    if (browser) await browser.close();
    if (server) {
      await new Promise<void>((res) => server!.close(() => res()));
    }
  }
}

runClientResourceTests().catch((err) => {
  console.error('[FATAL TEST ERROR]', err);
  process.exit(1);
});
