import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as assert from 'assert';
import * as http from 'http';
import * as XLSX from 'xlsx';
import { startFixtureServer } from '../fixture/server.js';
import { UserManagementExecutor } from '../engine/user-management-executor.js';
import { BrowserProfileManager } from '../engine/profile-manager.js';
import { CreateClientUserDto, PERMISSIONS } from '@hmc/shared';

async function runClientUsersTests() {
  console.log('--- Starting Central Client User Management Test Suite ---');
  const PORT = 4099;
  const BASE_URL = `http://localhost:${PORT}`;
  let server: http.Server | null = null;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    server = await startFixtureServer(PORT);
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();

    // 1. Headless isolated sync context & real-time list sync
    console.log('[TEST 1] Testing Headless isolated sync & column mapping...');
    const syncResult = await UserManagementExecutor.syncUsersHeadless(page, {
      usersUrl: `${BASE_URL}/MasterV9.4/users`,
    });
    assert.strictEqual(syncResult.success, true, 'Headless sync should report success');
    assert.strictEqual(syncResult.liveStatus, 'LIVE');
    assert.strictEqual(syncResult.users.length >= 3, true, 'Should scrape at least 3 seeded users');

    // Verify screenshot column mapping:
    // Remote "User Name" -> Full Name (e.g. "Dr. Sarah Al-Mansoor")
    // Remote "Name" -> Username (e.g. "dr_sarah")
    // Remote "Mobile No" -> Mobile Number (e.g. "0501234567")
    const doc = syncResult.users.find((u) => u.username === 'dr_sarah');
    assert.ok(doc, 'Should find dr_sarah');
    assert.strictEqual(doc?.fullName, 'Sarah Al-Mansoor', 'Full name should map correctly');
    assert.strictEqual(doc?.username, 'dr_sarah', 'Username should map correctly');
    assert.strictEqual(doc?.mobileNumber, '0502223344', 'Mobile number should map correctly');
    assert.strictEqual(doc?.status, 'ACTIVE');
    assert.strictEqual((doc as any).password, undefined, 'Zero password exposure');
    console.log('✓ TEST 1 Passed');

    // 2. Headless background auto-login upon redirect
    console.log('\n[TEST 2] Testing Headless background auto-login on login redirect...');
    // Start from login page to verify auto-login when redirected
    await page.goto(`${BASE_URL}/login`);
    const loginSyncResult = await UserManagementExecutor.syncUsersHeadless(page, {
      usersUrl: `${BASE_URL}/MasterV9.4/users`,
      loginUrl: `${BASE_URL}/login`,
      credentials: { username: 'test_admin', password: 'ValidPassword123!' },
    });
    assert.strictEqual(loginSyncResult.success, true, 'Should auto-login in background and return users');
    assert.strictEqual(loginSyncResult.users.length >= 3, true);
    console.log('✓ TEST 2 Passed');

    // 3. Status parsing (ACTIVE / INACTIVE)
    console.log('\n[TEST 3] Testing Status parsing (ACTIVE / INACTIVE)...');
    for (const u of syncResult.users) {
      assert.ok(['ACTIVE', 'INACTIVE'].includes(u.status), `Status must be ACTIVE or INACTIVE, got ${u.status}`);
    }
    console.log('✓ TEST 3 Passed');

    // 4. Create user and verification on live list
    console.log('\n[TEST 4] Testing Create user & verification on live list...');
    const newUsername = `test_doc_${Date.now()}`;
    const createDto: CreateClientUserDto = {
      clientId: 'client-123',
      username: newUsername,
      firstName: 'Test',
      lastName: 'Physician',
      mobileNumber: '0509998877',
      nationality: 'Saudi Arabia',
      role: 'Physician',
      profileRole: 'Clinical Specialist',
      barcodeNumber: 'BC-9999',
      status: 'ACTIVE',
    };

    const createRes = await UserManagementExecutor.createUser(
      page,
      `${BASE_URL}/MasterV9.4/addUsers`,
      `${BASE_URL}/MasterV9.4/users`,
      createDto
    );
    assert.strictEqual(createRes.success, true, 'User creation should report success');
    assert.strictEqual(createRes.username, newUsername);

    const syncAfterCreate = await UserManagementExecutor.syncUsersHeadless(page, {
      usersUrl: `${BASE_URL}/MasterV9.4/users`,
    });
    const created = syncAfterCreate.users.find((u) => u.username === newUsername);
    assert.ok(created, 'Newly created user must appear in live synced list');
    console.log('✓ TEST 4 Passed');

    // 5. Username duplicate prevention
    console.log('\n[TEST 5] Testing Exact username duplicate prevention...');
    const duplicateDto: CreateClientUserDto = {
      clientId: 'client-123',
      username: 'hmc_admin', // Existing user
      firstName: 'Duplicate',
      lastName: 'Admin',
      mobileNumber: '0500000000',
      nationality: 'Saudi Arabia',
      role: 'Physician',
      status: 'ACTIVE',
    };

    const duplicateRes = await UserManagementExecutor.createUser(
      page,
      `${BASE_URL}/MasterV9.4/addUsers`,
      `${BASE_URL}/MasterV9.4/users`,
      duplicateDto
    );
    assert.strictEqual(duplicateRes.success, false, 'Duplicate creation must fail');
    assert.strictEqual(duplicateRes.errorCode, 'DUPLICATE_USERNAME');
    console.log('✓ TEST 5 Passed');

    // 6. Activate / Deactivate status toggle
    console.log('\n[TEST 6] Testing Activate / Deactivate status toggle...');
    const toggleUser = 'nurse_ali';
    const toggleRes1 = await UserManagementExecutor.setUserStatus(
      page,
      `${BASE_URL}/MasterV9.4/users`,
      toggleUser,
      'INACTIVE'
    );
    assert.strictEqual(toggleRes1.success, true);
    assert.strictEqual(toggleRes1.status, 'INACTIVE');

    const toggleRes2 = await UserManagementExecutor.setUserStatus(
      page,
      `${BASE_URL}/MasterV9.4/users`,
      toggleUser,
      'ACTIVE'
    );
    assert.strictEqual(toggleRes2.success, true);
    assert.strictEqual(toggleRes2.status, 'ACTIVE');
    console.log('✓ TEST 6 Passed');

    // 7. Password reset & temporary password capture
    console.log('\n[TEST 7] Testing Password reset workflow & temporary password capture...');
    const resetRes = await UserManagementExecutor.resetUserPassword(
      page,
      `${BASE_URL}/MasterV9.4/users`,
      'dr_sarah'
    );
    assert.strictEqual(resetRes.success, true);
    assert.ok(resetRes.temporaryPassword, 'Temporary password must be captured');
    assert.ok(resetRes.temporaryPassword?.startsWith('Tmp@'), 'Password prefix valid');
    console.log('✓ TEST 7 Passed');

    // 8. Distinct Profile Namespaces (Interactive vs Sync)
    console.log('\n[TEST 8] Testing Separate Profile Namespaces (Interactive vs Sync)...');
    const interactivePath = BrowserProfileManager.getProfilePath('CLIENT_TEST_1', 'USER_OP_1', 'interactive');
    const syncPath = BrowserProfileManager.getProfilePath('CLIENT_TEST_1', 'USER_OP_1', 'sync');
    assert.ok(interactivePath.endsWith('/interactive') || interactivePath.includes('interactive'), 'Interactive path valid');
    assert.ok(syncPath.endsWith('/sync') || syncPath.includes('sync'), 'Sync path valid');
    assert.notStrictEqual(interactivePath, syncPath, 'Interactive and sync profiles must be separate');
    console.log('✓ TEST 8 Passed');

    // 9. Error Classification & Access Denied Detection
    console.log('\n[TEST 9] Testing Error Classification & Table Not Found...');
    const missingTableResult = await UserManagementExecutor.syncUsersHeadless(page, {
      usersUrl: `${BASE_URL}/invalid-users-route-404`,
    });
    assert.strictEqual(missingTableResult.success, false);
    assert.strictEqual(missingTableResult.liveStatus, 'CACHED');
    assert.ok(
      ['CLIENT_USER_TABLE_NOT_FOUND', 'CLIENT_USER_SYNC_TIMEOUT', 'CLIENT_USER_ACCESS_DENIED'].includes(
        missingTableResult.errorCode || ''
      ),
      `Expected classified error code, got ${missingTableResult.errorCode}`
    );
    console.log('✓ TEST 9 Passed');

    // 10. Excel format validation & RBAC permissions
    console.log('\n[TEST 10] Testing Excel workbook validation & RBAC permissions...');
    const wb = XLSX.utils.book_new();
    const rows = [
      {
        Action: 'CREATE',
        'User Name': 'imported_user_1',
        'First Name': 'Imported',
        'Last Name': 'One',
        Email: 'imp1@example.com',
        'Mobile Number': '0501111111',
        Nationality: 'Saudi Arabia',
        Role: 'Physician',
        'Requested Status': 'ACTIVE',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    assert.ok(buffer.length > 0);
    const readWb = XLSX.read(buffer, { type: 'buffer' });
    assert.strictEqual(readWb.SheetNames[0], 'Users');

    const requiredPermissions = [
      'CLIENT_USERS_VIEW',
      'CLIENT_USERS_SYNC',
      'CLIENT_USERS_CREATE',
      'CLIENT_USERS_EDIT',
      'CLIENT_USERS_STATUS_CHANGE',
      'CLIENT_USER_PASSWORD_RESET',
      'CLIENT_USERS_IMPORT',
      'CLIENT_USERS_EXPORT',
      'CLIENT_USERS_VIEW_SIGNATURE',
      'CLIENT_USERS_VIEW_PROFILE',
    ];
    for (const p of requiredPermissions) {
      assert.ok((PERMISSIONS as any)[p], `Permission ${p} must exist in PERMISSIONS`);
    }
    console.log('✓ TEST 10 Passed');

    console.log('\n======================================================');
    console.log('✓ ALL CENTRAL CLIENT USER MANAGEMENT TESTS PASSED (10/10)');
    console.log('======================================================\n');
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
}

runClientUsersTests().catch((err) => {
  console.error('[TEST ERROR] Client user management test failed:', err);
  process.exit(1);
});
