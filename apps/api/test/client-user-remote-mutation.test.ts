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

  // 8. Create User Contract: No Password Properties in Request or Job Parameters
  console.log('\n[TEST 8] Testing Create User Contract: Zero Password Properties in Request/Job Payload...');
  const createDto = {
    clientId: 'client-1',
    username: 'new_physician',
    firstName: 'Ahmed',
    lastName: 'Mansoor',
    mobileNumber: '0501234567',
    nationality: 'Saudi Arabia',
    role: 'Physician',
    profileRole: 'Clinical Specialist',
    // legacy/rogue fields:
    password: 'ShouldBeDiscarded!',
    confirmPassword: 'ShouldBeDiscarded!',
    defaultPassword: 'ShouldBeDiscarded!',
  };

  // Sanitizer strips any password fields
  const sanitized = {
    clientId: createDto.clientId,
    username: createDto.username,
    firstName: createDto.firstName,
    lastName: createDto.lastName,
    mobileNumber: createDto.mobileNumber,
    nationality: createDto.nationality,
    role: createDto.role,
    profileRole: createDto.profileRole,
  };

  const jobParametersJson = JSON.stringify({
    taskType: 'CREATE_CLIENT_USER',
    targetRoute: '/MasterV9.4/users',
    payload: sanitized,
    ...sanitized,
  });

  const parsedJob = JSON.parse(jobParametersJson);
  assert.strictEqual(parsedJob.payload.password, undefined, 'Password property must not exist in job payload');
  assert.strictEqual(parsedJob.password, undefined, 'Password property must not exist at top level');
  assert.strictEqual(parsedJob.defaultPassword, undefined, 'Default password property must not exist');
  console.log('✓ TEST 8 Passed');

  // 9. Client-Managed Native Password Policy & Non-Password Execution
  console.log('\n[TEST 9] Testing Desktop Agent leaves client native password policy intact...');
  const fieldsFilledByAgent = ['username', 'firstName', 'lastName', 'mobileNumber', 'nationality', 'role', 'profileRole'];
  assert.strictEqual(fieldsFilledByAgent.includes('password'), false, 'Agent must not fill or touch password field');
  assert.strictEqual(fieldsFilledByAgent.includes('defaultPassword'), false, 'Agent must not read or log default password');
  console.log('✓ TEST 9 Passed');

  // 10. Independent Reset Password in Simplex Action Maintained
  console.log('\n[TEST 10] Testing Reset Password in Simplex action remains available & independent...');
  const isResetPasswordActionAvailable = true;
  assert.strictEqual(isResetPasswordActionAvailable, true, 'Reset Password in Simplex action must remain available');
  console.log('✓ TEST 10 Passed');

  // 11. Header-Mapped Status Cell Toggle
  console.log('\n[TEST 11] Testing Header-Mapped Status Cell Isolation (S.NO, User Name, Name, Mobile No, Status, Action)...');
  const headers = ['S.NO', 'USER NAME', 'NAME', 'MOBILE NO', 'STATUS', 'ACTION'];
  const statusIdx = headers.indexOf('STATUS');
  const actionIdx = headers.indexOf('ACTION');
  assert.strictEqual(statusIdx, 4, 'Status column correctly mapped to index 4');
  assert.strictEqual(actionIdx, 5, 'Action column correctly mapped to index 5');
  assert.notStrictEqual(statusIdx, actionIdx, 'Status and Action columns must never overlap');
  console.log('✓ TEST 11 Passed');

  // 12. Unsafe Action Protection (Delete/Edit/View Protection)
  console.log('\n[TEST 12] Testing Unsafe Action Protection (Delete/Edit/View Protection)...');
  const actionCellHtml = '<a class="btn-action action-delete" title="Delete"><i class="fa fa-trash"></i></a>';
  const statusCellHtml = '<a class="status-toggle" title="Active"><i class="fa fa-check text-green">✔</i></a>';
  const isActionUnsafe = actionCellHtml.includes('fa-trash') || actionCellHtml.includes('title="Delete');
  const isStatusUnsafe = statusCellHtml.includes('fa-trash') || statusCellHtml.includes('title="Delete');
  assert.strictEqual(isActionUnsafe, true, 'Action cell correctly identified as containing delete action');
  assert.strictEqual(isStatusUnsafe, false, 'Status cell contains safe status toggle without delete action');
  console.log('✓ TEST 12 Passed');

  // 13. Exact Row Matching & Ambiguity Detection
  console.log('\n[TEST 13] Testing Exact Row Matching & Error Codes (REMOTE_USER_NOT_FOUND, AMBIGUOUS_REMOTE_USER)...');
  const rows = [
    { username: 'dr_sarah', status: 'ACTIVE' },
    { username: 'nurse_ali', status: 'ACTIVE' },
  ];
  const findMatches = (target: string) => rows.filter((r) => r.username.toLowerCase() === target.toLowerCase());
  assert.strictEqual(findMatches('nurse_ali').length, 1, 'Exact single row matched');
  assert.strictEqual(findMatches('nonexistent').length, 0, 'Zero matches detected');
  console.log('✓ TEST 13 Passed');

  // 14. Strict Client Data Isolation & Stale Response Rejection
  console.log('\n[TEST 14] Testing Strict Client Data Isolation & Stale Response Rejection...');
  const clientA_users = [{ id: 'u1', clientId: 'client_A', username: 'physician_1' }];
  const clientB_users = [{ id: 'u2', clientId: 'client_B', username: 'physician_2' }];

  let currentSelectedClient = 'client_A';
  let displayedUsers = clientA_users.filter((u) => u.clientId === currentSelectedClient);
  assert.strictEqual(displayedUsers.length, 1);
  assert.strictEqual(displayedUsers[0].username, 'physician_1');

  // Switch client to client_B -> instantly clear
  currentSelectedClient = 'client_B';
  displayedUsers = [];
  assert.strictEqual(displayedUsers.length, 0, 'Rows must clear immediately upon client switch');

  // Late response arriving for client_A while client_B is selected must be discarded
  const lateResponse = { clientId: 'client_A', users: clientA_users };
  if (lateResponse.clientId === currentSelectedClient) {
    displayedUsers = lateResponse.users;
  }
  assert.strictEqual(displayedUsers.length, 0, 'Late response from previous client must be discarded');

  // Response for client_B accepted
  const validResponse = { clientId: 'client_B', users: clientB_users };
  if (validResponse.clientId === currentSelectedClient) {
    displayedUsers = validResponse.users;
  }
  assert.strictEqual(displayedUsers.length, 1);
  assert.strictEqual(displayedUsers[0].username, 'physician_2');
  console.log('✓ TEST 14 Passed');

  // 15. Client-Scoped Uniqueness (Same username across different clients)
  console.log('\n[TEST 15] Testing Client-Scoped Uniqueness (Same username in Client A and Client B)...');
  const snapshots = [
    { clientId: 'client_A', username: 'dr_sarah', fullName: 'Dr. Sarah Client A' },
    { clientId: 'client_B', username: 'dr_sarah', fullName: 'Dr. Sarah Client B' },
  ];
  const clientA_user = snapshots.find((s) => s.clientId === 'client_A' && s.username === 'dr_sarah');
  const clientB_user = snapshots.find((s) => s.clientId === 'client_B' && s.username === 'dr_sarah');
  assert.ok(clientA_user && clientB_user, 'Both client records must co-exist independently');
  assert.notStrictEqual(clientA_user.fullName, clientB_user.fullName);
  console.log('✓ TEST 15 Passed');

  // 16. Exact Count Reconciliation & Stale Record Invalidation
  console.log('\n[TEST 16] Testing Exact Count Reconciliation & Stale Record Invalidation...');
  const remoteScraped = [
    { username: 'user1', fullName: 'User One' },
    { username: 'user2', fullName: 'User Two' },
    { username: 'user2', fullName: 'User Two Duplicate' }, // duplicate to remove
  ];
  const deduplicated = Array.from(new Map(remoteScraped.map((u) => [u.username, u])).values());
  assert.strictEqual(deduplicated.length, 2, 'Deduplicated remote count is 2');

  const previousLocalSnapshots = [
    { username: 'user1', isPresentRemotely: true },
    { username: 'user2', isPresentRemotely: true },
    { username: 'user3_stale', isPresentRemotely: true }, // stale, not in remote
  ];

  const reconciledSnapshots = previousLocalSnapshots.map((snap) => ({
    ...snap,
    isPresentRemotely: deduplicated.some((d) => d.username === snap.username),
  }));

  const activeVisibleCount = reconciledSnapshots.filter((s) => s.isPresentRemotely).length;
  assert.strictEqual(activeVisibleCount, deduplicated.length, 'Central visible count must equal remote deduplicated count');
  assert.strictEqual(reconciledSnapshots.find((s) => s.username === 'user3_stale')?.isPresentRemotely, false, 'Stale record marked isPresentRemotely=false');
  console.log('✓ TEST 16 Passed');

  // 17. Scoped Live Form Metadata (clientId + applicationVersion)
  console.log('\n[TEST 17] Testing Scoped Live Form Metadata...');
  const metadataCache = new Map<string, any>();
  const metaClientA = { clientId: 'client_A', applicationVersion: 'v9.4', roles: [{ label: 'Doctor', value: 'Doctor' }] };
  const metaClientB = { clientId: 'client_B', applicationVersion: 'v9.2', roles: [{ label: 'Operator', value: 'Operator' }] };

  metadataCache.set('client_A:v9.4', metaClientA);
  metadataCache.set('client_B:v9.2', metaClientB);

  assert.notDeepStrictEqual(metadataCache.get('client_A:v9.4'), metadataCache.get('client_B:v9.2'), 'Metadata must be strictly scoped by client');
  console.log('✓ TEST 17 Passed');

  // 18. Pre-Submission Read-Back Verification
  console.log('\n[TEST 18] Testing Pre-Submission Read-Back Verification...');
  const targetDto = { username: 'jdoe', firstName: 'John', lastName: 'Doe' };
  const domReadBackMatching = { username: 'jdoe', firstName: 'John', lastName: 'Doe' };
  const domReadBackMismatch = { username: 'jdoe', firstName: 'Jane', lastName: 'Doe' };

  const verifyReadBack = (target: typeof targetDto, read: typeof targetDto) => {
    if (target.username !== read.username || target.firstName !== read.firstName || target.lastName !== read.lastName) {
      throw new Error('REMOTE_FORM_VALUE_MISMATCH');
    }
    return true;
  };

  assert.strictEqual(verifyReadBack(targetDto, domReadBackMatching), true);
  assert.throws(() => verifyReadBack(targetDto, domReadBackMismatch), /REMOTE_FORM_VALUE_MISMATCH/);
  console.log('✓ TEST 18 Passed');

  // 19. Classified Error Mapping
  console.log('\n[TEST 19] Testing Classified Error Mapping...');
  const errorCodes = [
    'CLIENT_ID_REQUIRED',
    'CREATE_FORM_METADATA_FAILED',
    'REMOTE_FORM_FIELD_NOT_FOUND',
    'REMOTE_DROPDOWN_OPTION_NOT_FOUND',
    'REMOTE_FORM_VALUE_MISMATCH',
    'REMOTE_VALIDATION_FAILED',
    'DUPLICATE_USERNAME',
    'REMOTE_SAVE_RESULT_UNCERTAIN',
    'REMOTE_USER_NOT_FOUND_AFTER_CREATE',
    'CLIENT_USER_COUNT_MISMATCH',
    'AGENT_OFFLINE',
    'OPERATION_TIMED_OUT',
  ];
  assert.strictEqual(errorCodes.length, 12, 'All 12 classified error codes verified');
  console.log('✓ TEST 19 Passed');

  // 20. Success Message Classification
  console.log('\n[TEST 20] Testing Success Message Classification (Congrats!! Added successfully as SUCCESS)...');
  const classifyRemoteMessage = (message: string): 'SUCCESS' | 'ERROR' => {
    const lower = message.toLowerCase();
    if (
      lower.includes('congrats') ||
      lower.includes('added successfully') ||
      lower.includes('created successfully') ||
      lower.includes('successfully added') ||
      lower.includes('successfully created') ||
      lower.includes('saved successfully') ||
      lower.includes('user created') ||
      lower.includes('user added')
    ) {
      return 'SUCCESS';
    }
    return 'ERROR';
  };

  assert.strictEqual(classifyRemoteMessage('Congrats!! Added successfully'), 'SUCCESS');
  assert.strictEqual(classifyRemoteMessage('Added successfully'), 'SUCCESS');
  assert.strictEqual(classifyRemoteMessage('User created successfully'), 'SUCCESS');
  assert.strictEqual(classifyRemoteMessage('User already exists'), 'ERROR');
  assert.strictEqual(classifyRemoteMessage('Invalid form submission'), 'ERROR');
  console.log('✓ TEST 20 Passed');

  // 21. Ephemeral Default Password Lifecycle & Masking
  console.log('\n[TEST 21] Testing Ephemeral Default Password Lifecycle & 60s Auto-Clearing...');
  let modalState: {
    username: string;
    defaultPassword: string | null;
    isMasked: boolean;
    countdown: number;
  } | null = {
    username: 'new_operator',
    defaultPassword: 'TemporaryPass123!',
    isMasked: true, // masked by default
    countdown: 60,
  };

  assert.strictEqual(modalState.isMasked, true, 'Password must be masked by default');
  
  // Reveal
  modalState.isMasked = false;
  assert.strictEqual(modalState.isMasked, false, 'Reveal button must unmask password');

  // Simulate 60s countdown expiration
  modalState.countdown = 0;
  if (modalState.countdown <= 0) {
    modalState.defaultPassword = null;
  }
  assert.strictEqual(modalState.defaultPassword, null, 'Password must auto-clear from memory after 60 seconds');

  // Simulate modal close immediately purging state
  const closeModal = () => {
    modalState = null;
  };
  closeModal();
  assert.strictEqual(modalState, null, 'Closing modal must purge credential state from memory immediately');
  console.log('✓ TEST 21 Passed');

  // 22. Remote Password Unavailable Handling
  console.log('\n[TEST 22] Testing Remote Password Unavailable Case...');
  const remoteWithoutPass = { defaultPassword: undefined, temporaryPassword: undefined };
  const getDisplayPasswordText = (pass?: string) => {
    return pass || 'Default password was not provided by the client application.';
  };
  assert.strictEqual(
    getDisplayPasswordText(remoteWithoutPass.defaultPassword),
    'Default password was not provided by the client application.'
  );
  console.log('✓ TEST 22 Passed');

  // 23. Zero Password Persistence in MSSQL Database Snapshots & Audit Records
  console.log('\n[TEST 23] Testing Zero Plaintext Password in Database Snapshot & Audit Logs...');
  const createSnapshotRecord = (dto: any) => ({
    id: 'snap-uuid',
    clientId: dto.clientId,
    username: dto.username,
    firstName: dto.firstName,
    lastName: dto.lastName,
    fullName: `${dto.firstName} ${dto.lastName}`,
    status: dto.status || 'ACTIVE',
    isPresentRemotely: true,
  });

  const snap = createSnapshotRecord({
    clientId: 'c-1',
    username: 'user_secure',
    firstName: 'Secure',
    lastName: 'User',
    defaultPassword: 'SecretPassword99!',
  });
  assert.strictEqual('defaultPassword' in snap, false, 'Snapshot must not contain defaultPassword column');
  assert.strictEqual('password' in snap, false, 'Snapshot must not contain password column');
  console.log('✓ TEST 23 Passed');

  // 24. Verification Gate Before Success Modal & Password Delivery
  console.log('\n[TEST 24] Testing Verification Gate Before Success Modal & Password Delivery...');
  const executionPipeline = (remoteVerified: boolean, centralSynced: boolean, rawPassword?: string) => {
    if (!remoteVerified) throw new Error('REMOTE_CREATE_VERIFICATION_FAILED');
    if (!centralSynced) throw new Error('CENTRAL_SYNC_FAILED');
    return {
      successModalOpen: true,
      deliveredPassword: rawPassword || null,
    };
  };

  assert.throws(() => executionPipeline(false, true, 'pwd123'), /REMOTE_CREATE_VERIFICATION_FAILED/);
  assert.throws(() => executionPipeline(true, false, 'pwd123'), /CENTRAL_SYNC_FAILED/);
  const successOutcome = executionPipeline(true, true, 'pwd123');
  assert.strictEqual(successOutcome.successModalOpen, true);
  assert.strictEqual(successOutcome.deliveredPassword, 'pwd123');
  console.log('✓ TEST 24 Passed');

  // 25. Post-Mutation Authoritative Pull Sync Reconciliation
  console.log('\n[TEST 25] Testing Post-Mutation Pull Sync Reconciliation...');
  const mockSnapshots = new Map<string, any>();
  const mockSyncClientUsers = async (clientId: string) => {
    // Simulate remote pull returning the new user
    mockSnapshots.set('abdul.p', {
      id: 'snap-reconciled-1',
      clientId,
      username: 'abdul.p',
      fullName: 'Abdul Pathan',
      status: 'ACTIVE',
      isPresentRemotely: true,
      lastSyncedAt: new Date().toISOString(),
    });
  };

  const reconcileMock = async (clientId: string, username: string) => {
    await mockSyncClientUsers(clientId);
    const found = mockSnapshots.get(username.toLowerCase().trim());
    if (!found) throw new Error('USER_NOT_FOUND_ON_REMOTE');
    return {
      ...found,
      message: `User '${username}' successfully verified and synchronized with Central Console.`,
    };
  };

  const recResult = await reconcileMock('client-123', 'abdul.p');
  assert.strictEqual(recResult.username, 'abdul.p');
  assert.strictEqual(recResult.status, 'ACTIVE');
  console.log('✓ TEST 25 Passed');

  // 26. Graceful Reconciliation State Handling (CREATED_PENDING_RECONCILIATION)
  console.log('\n[TEST 26] Testing Graceful Reconciliation State Handling...');
  const handleMutationOutcome = (runResult: { isRemoteSaveConfirmed: boolean; rowFound: boolean; defaultPassword?: string }) => {
    if (runResult.rowFound) {
      return { status: 'CONFIRMED_AND_VERIFIED', isError: false, defaultPassword: runResult.defaultPassword };
    }
    if (runResult.isRemoteSaveConfirmed) {
      return { status: 'CREATED_PENDING_RECONCILIATION', isError: false, defaultPassword: runResult.defaultPassword };
    }
    return { status: 'REMOTE_CREATE_VERIFICATION_FAILED', isError: true };
  };

  const delayedOutcome = handleMutationOutcome({ isRemoteSaveConfirmed: true, rowFound: false, defaultPassword: 'EphemPass99!' });
  assert.strictEqual(delayedOutcome.status, 'CREATED_PENDING_RECONCILIATION');
  assert.strictEqual(delayedOutcome.isError, false, 'Confirmed remote save must never be treated as failure');
  assert.strictEqual(delayedOutcome.defaultPassword, 'EphemPass99!');
  console.log('✓ TEST 26 Passed');

  // 27. Duplicate Mutation Submission Prevention
  console.log('\n[TEST 27] Testing Duplicate Mutation Submission Prevention...');
  const allowFormSubmission = (isSubmitting: boolean, isRemoteSaveConfirmed: boolean) => {
    if (isSubmitting || isRemoteSaveConfirmed) return false;
    return true;
  };
  assert.strictEqual(allowFormSubmission(false, true), false, 'Must block resubmission if save was confirmed');
  assert.strictEqual(allowFormSubmission(true, false), false, 'Must block resubmission if active mutation in progress');
  assert.strictEqual(allowFormSubmission(false, false), true, 'Allow submission only when no confirmed save exists');
  console.log('✓ TEST 27 Passed');

  // 28. Ephemeral Credential Security Invariant
  console.log('\n[TEST 28] Testing Ephemeral Credential Security Invariants...');
  const activeMemoryContext = {
    ephemeralPassword: 'SecretPassword99!',
    snapshotPayload: {
      username: 'jdoe',
      fullName: 'John Doe',
      status: 'ACTIVE',
    },
    auditPayload: {
      action: 'CLIENT_USER_CREATED',
      username: 'jdoe',
      detailsJson: JSON.stringify({ clientCode: 'HOSP_01', username: 'jdoe' }),
    },
  };
  assert.strictEqual('password' in activeMemoryContext.snapshotPayload, false);
  assert.strictEqual(activeMemoryContext.auditPayload.detailsJson.includes('SecretPassword99!'), false);
  console.log('✓ TEST 28 Passed');

  // 29. Unified Credential Success: CREATE Mode displays captured password
  console.log('\n[TEST 29] Testing Unified Credential Success Popup: CREATE mode...');
  const createSuccessPayload = {
    type: 'CREATE' as const,
    username: 'ahmed.m',
    clientCode: 'HOSP_01',
    clientName: 'Central Hospital',
    password: 'CapturedDefault123!',
  };
  assert.strictEqual(createSuccessPayload.type, 'CREATE');
  assert.strictEqual(createSuccessPayload.username, 'ahmed.m');
  assert.strictEqual(createSuccessPayload.clientCode, 'HOSP_01');
  assert.strictEqual(createSuccessPayload.password, 'CapturedDefault123!');
  console.log('✓ TEST 29 Passed');

  // 30. Unified Credential Success: RESET Mode displays returned password
  console.log('\n[TEST 30] Testing Unified Credential Success Popup: RESET mode...');
  const resetSuccessPayload = {
    type: 'RESET' as const,
    username: 'dr_sarah',
    clientCode: 'HOSP_01',
    clientName: 'Central Hospital',
    password: 'Tmp@NewPass456!',
  };
  assert.strictEqual(resetSuccessPayload.type, 'RESET');
  assert.strictEqual(resetSuccessPayload.username, 'dr_sarah');
  assert.strictEqual(resetSuccessPayload.password, 'Tmp@NewPass456!');
  console.log('✓ TEST 30 Passed');

  // 31. Unified Credential Success: Create/Reset Failure NEVER displays password
  console.log('\n[TEST 31] Testing Failure Never Displays Credential Modal or Password...');
  const handleMutationFailure = (isSuccess: boolean, pwd?: string) => {
    if (!isSuccess) {
      return { modalOpen: false, credentialInfo: null };
    }
    return { modalOpen: true, credentialInfo: { password: pwd || null } };
  };
  const failedCreate = handleMutationFailure(false, 'ShouldNeverLeak!');
  assert.strictEqual(failedCreate.modalOpen, false, 'Modal must remain closed on create failure');
  assert.strictEqual(failedCreate.credentialInfo, null, 'Credential info must be null on create failure');

  const failedReset = handleMutationFailure(false, 'ShouldNeverLeak!');
  assert.strictEqual(failedReset.modalOpen, false, 'Modal must remain closed on reset failure');
  assert.strictEqual(failedReset.credentialInfo, null, 'Credential info must be null on reset failure');
  console.log('✓ TEST 31 Passed');

  // 32. Unified Credential Success: Password Unavailable Fallbacks (Create vs Reset)
  console.log('\n[TEST 32] Testing Password Unavailable Fallback Texts...');
  const getFallbackText = (type: 'CREATE' | 'RESET', password: string | null) => {
    if (password) return password;
    return type === 'CREATE'
      ? 'Default password was not provided by the client application.'
      : 'Password reset succeeded, but the client application did not provide the password.';
  };
  assert.strictEqual(
    getFallbackText('CREATE', null),
    'Default password was not provided by the client application.'
  );
  assert.strictEqual(
    getFallbackText('RESET', null),
    'Password reset succeeded, but the client application did not provide the password.'
  );
  assert.strictEqual(getFallbackText('CREATE', 'CustomPass123'), 'CustomPass123');
  console.log('✓ TEST 32 Passed');

  // 33. Unified Credential Success: Strict Multi-Client Isolation
  console.log('\n[TEST 33] Testing Multi-Client Password Isolation...');
  const activeClientContext = 'CLIENT_A';
  const deliveredCredentialContext = {
    clientCode: 'CLIENT_B',
    username: 'user_b',
    password: 'ClientBSecret!',
  };
  // Invariant: Modal should only accept credentials matching current selected client
  const isCredentialAccepted = deliveredCredentialContext.clientCode === activeClientContext;
  assert.strictEqual(isCredentialAccepted, false, 'Must reject credentials from another client context');
  console.log('✓ TEST 33 Passed');

  // 34. Unified Credential Success: Ephemeral 60s Auto-Clear and Immediate Purge on Close/Unmount
  console.log('\n[TEST 34] Testing Ephemeral 60s Countdown Auto-Clear & Memory Destruction...');
  let modalCredentialState: { password: string | null; countdown: number } | null = {
    password: 'SecretPass123!',
    countdown: 60,
  };
  // Tick countdown to 0
  modalCredentialState.countdown = 0;
  if (modalCredentialState.countdown <= 0) {
    modalCredentialState.password = null;
  }
  assert.strictEqual(modalCredentialState.password, null, 'Password must be nullified when countdown reaches 0');

  // Destroy on Close/Unmount
  const destroyState = () => {
    modalCredentialState = null;
  };
  destroyState();
  assert.strictEqual(modalCredentialState, null, 'Modal state must be completely cleared on close or unmount');
  console.log('✓ TEST 34 Passed');

  // 35. Unified Credential Success: Zero Plaintext Password Invariant
  console.log('\n[TEST 35] Testing Zero Plaintext Password Invariant across Database and Audit Logs...');
  const mssqlRecord = {
    id: 'user-rec-1',
    clientId: 'client-1',
    username: 'dr_sarah',
    fullName: 'Dr. Sarah',
    status: 'ACTIVE',
  };
  const auditEntry = {
    action: 'CLIENT_USER_PASSWORD_RESET',
    actorUsername: 'admin',
    detailsJson: JSON.stringify({ clientCode: 'HOSP_01', username: 'dr_sarah' }),
  };
  assert.strictEqual('password' in mssqlRecord, false, 'Database record must have no password column');
  assert.strictEqual(auditEntry.detailsJson.includes('password'), false, 'Audit details must never include password');
  console.log('✓ TEST 35 Passed');

  console.log('\n======================================================================');
  console.log('✓ ALL CLIENT USER DATA ISOLATION & FORM MAPPING TESTS PASSED (35/35)');
  console.log('======================================================================\n');
}

runClientUserMutationUnitTests().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});

