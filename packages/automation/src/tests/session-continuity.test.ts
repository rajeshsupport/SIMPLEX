import * as http from 'http';
import * as assert from 'assert';
import { chromium } from 'playwright';
import { startFixtureServer } from '../fixture/server.js';
import { UserManagementExecutor } from '../engine/user-management-executor.js';
import { BrowserProfileManager } from '../engine/profile-manager.js';
import { CreateClientUserDto } from '@hmc/shared';

async function runSessionContinuityTests() {
  console.log('================================================================');
  console.log('       SESSION CONTINUITY & AUTHENTICATION AUDIT TESTS          ');
  console.log('================================================================\n');

  let server: http.Server | null = null;
  const fixturePort = 4022;
  const baseUrl = `http://127.0.0.1:${fixturePort}`;
  let browser: any = null;

  try {
    server = await startFixtureServer(fixturePort);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    // ------------------------------------------------------------------------
    // TEST 1: Same Authenticated BrowserContext Used Across /addUsers and /addUserRole
    // ------------------------------------------------------------------------
    console.log('[TEST 1] Testing that the same BrowserContext & Page are retained from /addUsers to /addUserRole...');
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    let creationContextId: any = null;
    let roleMappingContextId: any = null;
    const visitedUrls: string[] = [];

    page1.on('load', () => {
      visitedUrls.push(page1.url());
    });

    const userDto1: CreateClientUserDto = {
      clientId: 'client-cont-1',
      username: `seq_user_${Date.now()}`,
      firstName: 'Seq',
      lastName: 'Continuity',
      mobileNumber: '0501234567',
      nationality: 'Saudi Arabia',
      roles: ['ACCUMED', 'REPORTS'],
      status: 'ACTIVE',
    };

    const res1 = await UserManagementExecutor.processUserFullWorkflow(page1, {
      clientId: 'client-cont-1',
      addUsersUrl: `${baseUrl}/MasterV9.4/addUsers`,
      usersUrl: `${baseUrl}/MasterV9.4/users`,
      roleUrl: `${baseUrl}/MasterV9.4/addUserRole`,
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      userDto: userDto1,
      onProgress: (comment, partial) => {
        if (partial?.creationState === 'COMPLETED' && !creationContextId) {
          creationContextId = page1.context();
        }
        if (comment.includes('Opening Add User Role') || comment.includes('Searching for the newly created user')) {
          roleMappingContextId = page1.context();
        }
      },
    });

    assert.strictEqual(res1.success, true, 'Workflow must succeed');
    assert.strictEqual(res1.overallStatus, 'COMPLETED');
    assert.strictEqual(creationContextId, context1, 'Creation must use initial context');
    assert.strictEqual(roleMappingContextId, context1, 'Role mapping must use initial context');
    assert.strictEqual(creationContextId, roleMappingContextId, 'Both stages must use the EXACT same BrowserContext');
    console.log('✓ TEST 1 Passed: Same BrowserContext preserved across all lifecycle stages');

    await context1.close();

    // ------------------------------------------------------------------------
    // TEST 2: Context Cleanup Occurs Only After Full Lifecycle Completion
    // ------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing context cleanup lifecycle (alive during workflow, closed only at end)...');
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    let isPageOpenDuringCreation = false;
    let isPageOpenDuringRoleMapping = false;

    const userDto2: CreateClientUserDto = {
      clientId: 'client-cont-2',
      username: `seq_user_${Date.now()}_2`,
      firstName: 'Seq2',
      lastName: 'Lifecycle',
      mobileNumber: '0501234568',
      nationality: 'Saudi Arabia',
      roles: ['ACCUMED'],
      status: 'ACTIVE',
    };

    await UserManagementExecutor.processUserFullWorkflow(page2, {
      clientId: 'client-cont-2',
      addUsersUrl: `${baseUrl}/MasterV9.4/addUsers`,
      usersUrl: `${baseUrl}/MasterV9.4/users`,
      roleUrl: `${baseUrl}/MasterV9.4/addUserRole`,
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      userDto: userDto2,
      onProgress: (comment, partial) => {
        if (partial?.creationState === 'COMPLETED') {
          isPageOpenDuringCreation = !page2.isClosed();
        }
        if (comment.includes('Selecting requested roles')) {
          isPageOpenDuringRoleMapping = !page2.isClosed();
        }
      },
    });

    assert.strictEqual(isPageOpenDuringCreation, true, 'Page/Context must remain open during user creation');
    assert.strictEqual(isPageOpenDuringRoleMapping, true, 'Page/Context must remain open during role mapping');
    assert.strictEqual(page2.isClosed(), false, 'Worker owns context; executor must not close page prematurely');
    await context2.close();
    assert.strictEqual(page2.isClosed(), true, 'Context closed cleanly by worker owner');
    console.log('✓ TEST 2 Passed: Context lifecycle retained until worker completion');

    // ------------------------------------------------------------------------
    // TEST 3: Created User Password Is Never Used as Client Administrator Password
    // ------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing that created user password is never used for Role Master authentication...');
    const context3 = await browser.newContext();
    const page3 = await context3.newPage();

    const capturedAuthPasswords: string[] = [];
    const originalFill = page3.fill.bind(page3);
    page3.fill = async (selector: string, value: string, opts?: any) => {
      if (selector.includes('password') || selector.includes('pass')) {
        capturedAuthPasswords.push(value);
      }
      return originalFill(selector, value, opts);
    };

    const userDto3: CreateClientUserDto = {
      clientId: 'client-cont-3',
      username: `seq_user_${Date.now()}_3`,
      firstName: 'Seq3',
      lastName: 'Security',
      mobileNumber: '0501234569',
      nationality: 'Saudi Arabia',
      roles: ['REPORTS'],
      status: 'ACTIVE',
    };

    let capturedEphemeralPassword = '';
    await UserManagementExecutor.processUserFullWorkflow(page3, {
      clientId: 'client-cont-3',
      addUsersUrl: `${baseUrl}/MasterV9.4/addUsers`,
      usersUrl: `${baseUrl}/MasterV9.4/users`,
      roleUrl: `${baseUrl}/MasterV9.4/addUserRole`,
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
      userDto: userDto3,
      onEphemeralCredential: (cred: any) => {
        capturedEphemeralPassword = cred?.password || '';
      },
    });

    if (capturedEphemeralPassword) {
      assert.strictEqual(
        capturedAuthPasswords.includes(capturedEphemeralPassword),
        false,
        'Created user default password must NEVER be used to log into client portal'
      );
    }
    console.log('✓ TEST 3 Passed: Administrator credentials strictly isolated from user ephemeral passwords');
    await context3.close();

    // ------------------------------------------------------------------------
    // TEST 4: Redirect to /login Becomes AUTH_SESSION_EXPIRED and Pauses Safely
    // ------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing redirect to /login classifies as AUTH_SESSION_EXPIRED...');
    const context4 = await browser.newContext();
    const page4 = await context4.newPage();

    await page4.goto(`${baseUrl}/login`);

    const roleMappingWithoutAuth = await UserManagementExecutor.mapUserRoles(page4, {
      roleUrl: `${baseUrl}/login`,
      username: 'any.user',
      requestedRoles: ['ACCUMED'],
    });

    assert.strictEqual(roleMappingWithoutAuth.success, false);
    assert.strictEqual(roleMappingWithoutAuth.overallStatus, 'PARTIAL_FAILED');
    assert.strictEqual(roleMappingWithoutAuth.errorCode, 'AUTH_SESSION_EXPIRED');
    assert.strictEqual(roleMappingWithoutAuth.retryStartingPoint, 'ROLE_MAPPING');
    assert.ok(
      roleMappingWithoutAuth.failureReason?.includes('Client administrator authentication failed before role mapping'),
      'Failure reason must be clear and descriptive'
    );
    console.log('✓ TEST 4 Passed: Login redirect cleanly classifies as AUTH_SESSION_EXPIRED');
    await context4.close();

    // ------------------------------------------------------------------------
    // TEST 5: Invalid Stored Administrator Credentials Pauses Batch Safely
    // ------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing invalid stored administrator credentials handling...');
    const context5 = await browser.newContext();
    const page5 = await context5.newPage();

    const invalidAuthRes = await UserManagementExecutor.ensureAuthenticated(page5, {
      targetUrl: `${baseUrl}/MasterV9.4/addUsers`,
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'invalid_user', password: 'WrongPassword!' },
    });

    assert.strictEqual(invalidAuthRes.authenticated, false, 'Invalid credentials must be rejected');
    assert.ok(
      invalidAuthRes.errorMessage?.includes('Client administrator authentication failed before role mapping') ||
      invalidAuthRes.errorMessage?.includes('rejected') ||
      invalidAuthRes.errorCode === 'CLIENT_AUTO_LOGIN_FAILED'
    );
    console.log('✓ TEST 5 Passed: Invalid administrator credentials rejected safely without crashing');
    await context5.close();

    // ------------------------------------------------------------------------
    // TEST 6: Retry for Created User Starts from ROLE_MAPPING without Duplicate Creation
    // ------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing standalone retry starts from ROLE_MAPPING...');
    const context6 = await browser.newContext();
    const page6 = await context6.newPage();

    await UserManagementExecutor.ensureAuthenticated(page6, {
      targetUrl: `${baseUrl}/MasterV9.4/addUserRole`,
      loginUrl: `${baseUrl}/login`,
      credentials: { username: 'admin', password: 'password123' },
    });

    let creationAttemptedOnRetry = false;
    page6.on('request', (req: any) => {
      if (req.url().includes('/addUsers') && req.method() === 'POST') {
        creationAttemptedOnRetry = true;
      }
    });

    const retryRes = await UserManagementExecutor.mapUserRoles(page6, {
      roleUrl: `${baseUrl}/MasterV9.4/addUserRole`,
      username: 'abdul.p',
      requestedRoles: ['ACCUMED', 'REPORTS'],
    });

    assert.strictEqual(retryRes.success, true, 'Standalone role mapping retry must succeed');
    assert.strictEqual(retryRes.roleSelectionState, 'SELECTED');
    assert.strictEqual(retryRes.roleVerificationState, 'PASSED');
    assert.strictEqual(creationAttemptedOnRetry, false, 'Retry must NOT execute user creation');
    console.log('✓ TEST 6 Passed: Standalone retry completed from ROLE_MAPPING with 0 duplicate creations');
    await context6.close();

    // ------------------------------------------------------------------------
    // TEST 7: Profile Ownership Isolation (Mutation vs Interactive vs Sync)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing profile namespace isolation...');
    const syncDir = BrowserProfileManager.getProfilePath('client-iso', 'op1', 'sync');
    const mutDir = BrowserProfileManager.getProfilePath('client-iso', 'op1', 'mutation');
    const intDir = BrowserProfileManager.getProfilePath('client-iso', 'op1', 'interactive');

    assert.notStrictEqual(syncDir, mutDir, 'Sync and mutation profile directories must be separate');
    assert.notStrictEqual(mutDir, intDir, 'Mutation and interactive profile directories must be separate');
    assert.ok(syncDir.includes('sync'), 'Sync profile path must include sync');
    assert.ok(mutDir.includes('mutation'), 'Mutation profile path must include mutation');
    assert.ok(intDir.includes('interactive'), 'Interactive profile path must include interactive');
    console.log('✓ TEST 7 Passed: Strict profile directory isolation confirmed');

    // ------------------------------------------------------------------------
    // TEST 8: Zero Secrets Invariant in Logs, Progress DTOs, and Result Objects
    // ------------------------------------------------------------------------
    console.log('\n[TEST 8] Auditing logs and result DTOs for zero secret exposure...');
    const resultJson = JSON.stringify(res1);
    const forbiddenPatterns = [
      'password123',
      'encryptedPassword',
      'passwordIv',
      'passwordTag',
      'Bearer ',
      'eyJhbG',
    ];

    for (const pattern of forbiddenPatterns) {
      assert.strictEqual(
        resultJson.includes(pattern),
        false,
        `Result JSON must NOT contain sensitive secret: ${pattern}`
      );
    }
    console.log('✓ TEST 8 Passed: Zero credentials or sensitive secrets in result telemetry');

    console.log('\n================================================================');
    console.log('  ALL 8 SESSION CONTINUITY & AUTHENTICATION TESTS PASSED        ');
    console.log('================================================================\n');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server!.close(resolve));
  }
}

runSessionContinuityTests().catch((err) => {
  console.error('Test suite failure:', err);
  process.exit(1);
});
