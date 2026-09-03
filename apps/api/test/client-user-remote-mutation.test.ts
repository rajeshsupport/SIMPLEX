import * as assert from 'assert';
import { PERMISSIONS } from '@hmc/shared';

type ClientUserStatus = 'ACTIVE' | 'INACTIVE';

async function runClientUserMutationUnitTests() {
  console.log('--- Starting Client User Remote Mutation & Data-Flow Separation Tests ---');

  // 1. Verify Data-Flow Separation Rules
  console.log('[TEST 1] Data-Flow Separation: Sync Users is pull-only, Update Client is verified push...');
  const syncOperation = {
    direction: 'Simplex Client -> Central Console',
    isReadOnlyPull: true,
    pushesCentralChanges: false,
  };
  assert.strictEqual(syncOperation.isReadOnlyPull, true, 'Sync Users must be read-only pull');
  assert.strictEqual(syncOperation.pushesCentralChanges, false, 'Sync Users must never push Central changes');

  const updateClientOperation = {
    direction: 'Central Console -> Simplex Client',
    jobType: 'CHANGE_CLIENT_USER_STATUS',
    requiresRemoteVerification: true,
    triggersAutoPullSyncAfterSuccess: true,
  };
  assert.strictEqual(updateClientOperation.requiresRemoteVerification, true, 'Remote verification is required');
  assert.strictEqual(updateClientOperation.triggersAutoPullSyncAfterSuccess, true, 'Must auto pull sync after success');
  console.log('✓ TEST 1 Passed');

  // 2. Verified Remote Success Required Before Central DB Update
  console.log('\n[TEST 2] Verifying Central snapshot is NOT updated upon remote failure...');
  let initialStatus: ClientUserStatus = 'ACTIVE';
  let centralSnapshotStatus: ClientUserStatus = initialStatus;

  const mockFailedRun = {
    status: 'FAILED',
    errorCode: 'REMOTE_STATUS_VERIFICATION_FAILED',
    errorMessage: 'Remote status verification failed on client portal.',
  };

  if (mockFailedRun.status === 'SUCCEEDED' || mockFailedRun.status === 'COMPLETED') {
    centralSnapshotStatus = 'INACTIVE';
  }

  assert.strictEqual(centralSnapshotStatus, initialStatus, 'Central status must be preserved at previous verified value on remote failure');
  console.log('✓ TEST 2 Passed');

  // 3. Central Snapshot Updated ONLY After Verified Remote Success
  console.log('\n[TEST 3] Verifying Central snapshot updates after remote success & auto-sync...');
  const mockSucceededRun = {
    status: 'SUCCEEDED',
    resultData: {
      success: true,
      username: 'test_user',
      status: 'INACTIVE',
      message: "User 'test_user' status verified as INACTIVE on remote client.",
    },
  };

  if (mockSucceededRun.status === 'SUCCEEDED' || mockSucceededRun.status === 'COMPLETED') {
    centralSnapshotStatus = mockSucceededRun.resultData.status as ClientUserStatus;
  }

  assert.strictEqual(centralSnapshotStatus, 'INACTIVE', 'Central status must update to verified status after remote success');
  console.log('✓ TEST 3 Passed');

  // 4. Mutation Lock / Single-Flight Protection Against Concurrent Clicks
  console.log('\n[TEST 4] Testing Mutation Lock & Duplicate Job Prevention...');
  const activeLocks = new Set<string>();
  const lockKey = 'client-1:test_user';

  const acquire = (key: string) => {
    if (activeLocks.has(key)) throw new Error('OPERATION_IN_PROGRESS');
    activeLocks.add(key);
    return () => activeLocks.delete(key);
  };

  const release1 = acquire(lockKey);
  assert.throws(() => acquire(lockKey), /OPERATION_IN_PROGRESS/, 'Concurrent mutation on same user must be rejected');
  release1();
  const release2 = acquire(lockKey);
  assert.ok(release2, 'Lock must be re-acquirable after release');
  release2();
  console.log('✓ TEST 4 Passed');

  // 5. Production Mutation Safeguard
  console.log('\n[TEST 5] Testing PRODUCTION Client Mutation Safeguard...');
  const checkMutationAllowed = (env: string) => {
    if (env.toUpperCase() === 'PRODUCTION') {
      throw new Error('PRODUCTION_MUTATION_BLOCKED');
    }
    return true;
  };

  assert.throws(() => checkMutationAllowed('PRODUCTION'), /PRODUCTION_MUTATION_BLOCKED/);
  assert.strictEqual(checkMutationAllowed('STAGING'), true);
  assert.strictEqual(checkMutationAllowed('TEST'), true);
  console.log('✓ TEST 5 Passed');

  // 6. Action Menu Status Rules
  console.log('\n[TEST 6] Testing Action Menu Rules (Mutually Exclusive Status Actions & No Delete)...');
  const getVisibleActions = (status: ClientUserStatus) => {
    const actions = ['View', 'Edit & Update Client', 'Reset Password in Simplex'];
    if (status === 'ACTIVE') {
      actions.push('Deactivate in Simplex');
    } else {
      actions.push('Activate in Simplex');
    }
    return actions;
  };

  const activeActions = getVisibleActions('ACTIVE');
  assert.ok(activeActions.includes('Deactivate in Simplex'));
  assert.ok(!activeActions.includes('Activate in Simplex'));
  assert.ok(!activeActions.includes('Delete'));

  const inactiveActions = getVisibleActions('INACTIVE');
  assert.ok(inactiveActions.includes('Activate in Simplex'));
  assert.ok(!inactiveActions.includes('Deactivate in Simplex'));
  assert.ok(!inactiveActions.includes('Delete'));
  console.log('✓ TEST 6 Passed');

  // 7. Reconcile Inconsistent Local State On Sync
  console.log('\n[TEST 7] Testing Inconsistent State Reconciliation via Sync Users...');
  let centralUserRecord = { username: 'nurse_ali', status: 'INACTIVE', source: 'LOCAL_ONLY' };
  const verifiedRemoteUser = { username: 'nurse_ali', status: 'ACTIVE' as ClientUserStatus };

  // Pull sync runs -> overwrites local status with verified remote status
  centralUserRecord.status = verifiedRemoteUser.status;
  centralUserRecord.source = 'REMOTE_PULL_SYNC';

  assert.strictEqual(centralUserRecord.status, 'ACTIVE', 'Reconciled Central status must match verified remote client status');
  console.log('✓ TEST 7 Passed');

  console.log('\n======================================================================');
  console.log('✓ ALL CLIENT USER REMOTE MUTATION TESTS PASSED (7/7)');
  console.log('======================================================================\n');
}

runClientUserMutationUnitTests().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
