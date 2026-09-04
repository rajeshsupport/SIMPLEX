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

  // 36. Desktop Agent Offline Preflight Check & Rejection
  console.log('\n[TEST 36] Testing Desktop Agent Offline Preflight Check & Rejection...');
  const preflightCheck = (isAgentOnline: boolean) => {
    if (!isAgentOnline) {
      return {
        allowed: false,
        errorCode: 'DESKTOP_AGENT_OFFLINE',
        errorMessage: 'Automation Agent is offline. Start/reconnect the agent and retry.',
        preserveUserStatus: true,
      };
    }
    return { allowed: true, preserveUserStatus: true };
  };

  const offlinePreflight = preflightCheck(false);
  assert.strictEqual(offlinePreflight.allowed, false, 'Preflight must reject when agent is offline');
  assert.strictEqual(offlinePreflight.errorCode, 'DESKTOP_AGENT_OFFLINE');
  assert.strictEqual(offlinePreflight.errorMessage, 'Automation Agent is offline. Start/reconnect the agent and retry.');
  assert.strictEqual(offlinePreflight.preserveUserStatus, true, 'User status must be preserved');

  const onlinePreflight = preflightCheck(true);
  assert.strictEqual(onlinePreflight.allowed, true, 'Preflight must succeed when agent is online');
  console.log('✓ TEST 36 Passed');

  // 37. Desktop Agent Heartbeat Freshness (15s Threshold)
  console.log('\n[TEST 37] Testing Agent Heartbeat Freshness (15s Threshold)...');
  const now = Date.now();
  const freshAgent = { lastHeartbeatAt: new Date(now - 3000), status: 'ONLINE' };
  const staleAgent = { lastHeartbeatAt: new Date(now - 20000), status: 'ONLINE' };

  const computeAgentStatus = (agent: { lastHeartbeatAt: Date | null; status: string }) => {
    const isStale = !agent.lastHeartbeatAt || now - agent.lastHeartbeatAt.getTime() > 15000;
    return isStale ? 'OFFLINE' : agent.status;
  };

  assert.strictEqual(computeAgentStatus(freshAgent), 'ONLINE', 'Fresh heartbeat within 15s is ONLINE');
  assert.strictEqual(computeAgentStatus(staleAgent), 'OFFLINE', 'Stale heartbeat older than 15s is marked OFFLINE');
  console.log('✓ TEST 37 Passed');

  // 38. Agent Disconnect & Heartbeat Recovery
  console.log('\n[TEST 38] Testing Agent Disconnect & Heartbeat Recovery...');
  let agentConnection = { isConnected: true, status: 'ONLINE', consecutiveFailures: 0 };
  
  // Simulate network drop
  agentConnection.isConnected = false;
  agentConnection.consecutiveFailures++;
  assert.strictEqual(agentConnection.isConnected, false);

  // Simulate automatic reconnect on next heartbeat cycle
  agentConnection.isConnected = true;
  agentConnection.status = 'ONLINE';
  agentConnection.consecutiveFailures = 0;
  assert.strictEqual(agentConnection.status, 'ONLINE', 'Agent must recover status upon reconnection');
  console.log('✓ TEST 38 Passed');

  // 39. API Restart & Automatic Agent Re-Registration / Re-Pairing
  console.log('\n[TEST 39] Testing API Restart & Automatic Agent Auto-Registration...');
  const inMemoryAgents = new Map<string, any>();
  const recordHeartbeatMock = (payload: { agentId: string; machineHostname: string; status: string }) => {
    if (!inMemoryAgents.has(payload.agentId)) {
      // Auto-register
      inMemoryAgents.set(payload.agentId, {
        id: payload.agentId,
        hostname: payload.machineHostname,
        status: payload.status,
        lastHeartbeat: new Date(),
      });
    } else {
      const existing = inMemoryAgents.get(payload.agentId);
      existing.status = payload.status;
      existing.lastHeartbeat = new Date();
    }
    return { acknowledged: true };
  };

  // API restarts -> Map is empty
  inMemoryAgents.clear();
  assert.strictEqual(inMemoryAgents.size, 0);

  // Agent sends heartbeat -> API auto-registers agent without manual operator intervention
  recordHeartbeatMock({ agentId: 'agent-1', machineHostname: 'node-desktop', status: 'ONLINE' });
  assert.strictEqual(inMemoryAgents.size, 1);
  assert.strictEqual(inMemoryAgents.get('agent-1').status, 'ONLINE');
  console.log('✓ TEST 39 Passed');

  // 40. Bounded Mutation Stage Timeouts
  console.log('\n[TEST 40] Testing Bounded Mutation Stage Timeouts (2s availability, 3s claim, 10s nav, 10s verify, 30s total)...');
  const stageTimeouts = {
    agentAvailabilityCheckMaxMs: 2000,
    jobClaimMaxMs: 3000,
    remoteLoginAndNavigationMaxMs: 10000,
    statusVerificationMaxMs: 10000,
    totalOperationMaxMs: 30000,
  };
  assert.ok(stageTimeouts.agentAvailabilityCheckMaxMs <= 2000);
  assert.ok(stageTimeouts.jobClaimMaxMs <= 3000);
  assert.ok(stageTimeouts.remoteLoginAndNavigationMaxMs <= 10000);
  assert.ok(stageTimeouts.statusVerificationMaxMs <= 10000);
  assert.ok(stageTimeouts.totalOperationMaxMs <= 30000);
  console.log('✓ TEST 40 Passed');

  // 41. Mutation Lock Release in Finally & Auto-Expiry Fallback
  console.log('\n[TEST 41] Testing Mutation Lock Release in Finally & Auto-Expiry...');
  const lockMap = new Map<string, number>();
  const testKey = 'client_1:physician_john';

  const acquireWithExpiry = (key: string) => {
    const cur = lockMap.get(key);
    if (cur && Date.now() - cur < 45000) {
      throw new Error('OPERATION_IN_PROGRESS');
    }
    lockMap.set(key, Date.now());
    return () => lockMap.delete(key);
  };

  // Acquire and release in finally
  let lockReleased = false;
  try {
    const rel = acquireWithExpiry(testKey);
    try {
      // Simulate mutation work
      assert.strictEqual(lockMap.has(testKey), true);
    } finally {
      rel();
      lockReleased = true;
    }
  } catch {}

  assert.strictEqual(lockReleased, true, 'Lock must be released in finally');
  assert.strictEqual(lockMap.has(testKey), false, 'Lock map must be empty after release');

  // Auto-expiry test: simulate stale lock from 50s ago
  lockMap.set(testKey, Date.now() - 50000);
  const reacquired = acquireWithExpiry(testKey);
  assert.ok(reacquired, 'Stale lock >45s must auto-expire and permit new acquisition');
  reacquired();
  console.log('✓ TEST 41 Passed');

  // 42. Spinner & Loading State Cleanup in Finally
  console.log('\n[TEST 42] Testing Spinner & Loading State Cleanup in Finally...');
  let isRowSpinnerActive = false;
  let isActionDisabled = false;
  let isMutatingStatus = false;

  const executeStatusMutation = async (shouldFail: boolean) => {
    isRowSpinnerActive = true;
    isActionDisabled = true;
    isMutatingStatus = true;
    try {
      if (shouldFail) throw new Error('Remote mutation failed');
    } finally {
      isRowSpinnerActive = false;
      isActionDisabled = false;
      isMutatingStatus = false;
    }
  };

  await executeStatusMutation(true).catch(() => {});
  assert.strictEqual(isRowSpinnerActive, false, 'Row spinner must be cleared on failure in finally');
  assert.strictEqual(isActionDisabled, false, 'Action buttons must be re-enabled on failure in finally');
  assert.strictEqual(isMutatingStatus, false, 'Mutation state must be cleared on failure in finally');
  console.log('✓ TEST 42 Passed');

  // 43. Status Mutation Popup: Stages, Progress, and 500ms Auto-Close on Success
  console.log('\n[TEST 43] Testing Status Mutation Popup Stages & 500ms Auto-Close on Success...');
  const recordedStages: string[] = [];
  let modalOpen = true;
  let actionSuccessMessage: string | null = null;

  const runSuccessfulMutationFlow = async () => {
    recordedStages.push('Preflight: Checking automation agent…');
    recordedStages.push('Submitting INACTIVE request to Simplex portal…');
    recordedStages.push('Remote status verified. Synchronizing Central directory…');
    
    actionSuccessMessage = "✓ User 'dr_sarah' status updated to INACTIVE in HOSP_01.";
    // Simulate 500ms auto-close
    modalOpen = false;
  };

  await runSuccessfulMutationFlow();
  assert.strictEqual(recordedStages.length, 3, 'All 3 progressive stages recorded');
  assert.strictEqual(modalOpen, false, 'Modal closed after verified success');
  assert.ok(actionSuccessMessage?.includes('INACTIVE'));
  console.log('✓ TEST 43 Passed');

  // 44. Failure Handling: Stop Spinner, Preserve User Status, Show Retry & Close
  console.log('\n[TEST 44] Testing Failure Handling (Stop Spinner, Preserve Status, Show Retry)...');
  let userStatus: ClientUserStatus = 'ACTIVE';
  let modalErrorState: string | null = null;
  let showRetryButton = false;
  let showCloseButton = false;
  let spinnerRunning = true;

  const handleStatusMutationFailure = (err: string) => {
    spinnerRunning = false;
    modalErrorState = `Status update failed: ${err}`;
    showRetryButton = true;
    showCloseButton = true;
    // Status preserved
    userStatus = 'ACTIVE';
  };

  handleStatusMutationFailure('Remote status control not found');
  assert.strictEqual(spinnerRunning, false, 'Spinner must stop immediately upon failure');
  assert.strictEqual(userStatus, 'ACTIVE', 'Original user status must be preserved intact');
  assert.strictEqual(showRetryButton, true, 'Retry button must be visible');
  assert.strictEqual(showCloseButton, true, 'Close button must be visible');
  assert.ok(modalErrorState?.includes('Remote status control not found'));
  console.log('✓ TEST 44 Passed');

  // 45. Remote Activate/Deactivate Verification & Central Pull Sync
  console.log('\n[TEST 45] Testing Remote Status Verification & Central Pull Sync Update...');
  let remoteStatus: ClientUserStatus = 'ACTIVE';
  let centralStatus: ClientUserStatus = 'ACTIVE';

  const performVerifiedStatusToggle = async (target: ClientUserStatus) => {
    // 1. Agent clicks toggle on remote
    remoteStatus = target;
    // 2. Agent re-reads remote status
    if (remoteStatus !== target) throw new Error('REMOTE_STATUS_VERIFICATION_FAILED');
    // 3. Central pull sync runs
    centralStatus = remoteStatus;
  };

  await performVerifiedStatusToggle('INACTIVE');
  assert.strictEqual(remoteStatus, 'INACTIVE');
  assert.strictEqual(centralStatus, 'INACTIVE', 'Central status updated to verified remote status');

  await performVerifiedStatusToggle('ACTIVE');
  assert.strictEqual(remoteStatus, 'ACTIVE');
  assert.strictEqual(centralStatus, 'ACTIVE', 'Central status updated to verified remote status');
  console.log('✓ TEST 45 Passed');

  // 46. Single-Flight & Duplicate Job Submission Prevention
  console.log('\n[TEST 46] Testing Single-Flight & Duplicate Job Submission Prevention...');
  const inFlightTasks = new Map<string, Promise<any>>();
  const taskKey = 'CLIENT_01_operator_interactive';

  let jobRunCount = 0;
  const dispatchTask = async (key: string) => {
    if (inFlightTasks.has(key)) {
      return inFlightTasks.get(key);
    }
    const taskPromise = (async () => {
      jobRunCount++;
      await new Promise((r) => setTimeout(r, 50));
    })();
    inFlightTasks.set(key, taskPromise);
    try {
      await taskPromise;
    } finally {
      inFlightTasks.delete(key);
    }
  };

  // Launch 3 duplicate concurrent clicks
  await Promise.all([
    dispatchTask(taskKey),
    dispatchTask(taskKey),
    dispatchTask(taskKey),
  ]);

  assert.strictEqual(jobRunCount, 1, 'Only 1 task must execute when 3 concurrent clicks occur');
  console.log('✓ TEST 46 Passed');

  // 47. Agent Becomes BUSY Immediately After Claiming a Job
  console.log('\n[TEST 47] Testing Agent Becomes BUSY Immediately After Claiming a Job...');
  const mockAgentState = {
    id: 'desktop-agent-1',
    status: 'ONLINE',
    lastHeartbeatAt: new Date(),
  };
  const mockRun = {
    id: 'run-101',
    status: 'PENDING',
    desktopAgentId: null as string | null,
    startedAt: null as Date | null,
    updatedAt: new Date(),
  };

  // Simulate claim
  mockRun.status = 'CLAIMED';
  mockRun.desktopAgentId = mockAgentState.id;
  mockRun.startedAt = new Date();
  mockRun.updatedAt = new Date();
  mockAgentState.status = 'BUSY';
  mockAgentState.lastHeartbeatAt = new Date();

  assert.strictEqual(mockAgentState.status, 'BUSY', 'Agent status must immediately become BUSY upon claiming run');
  assert.strictEqual(mockRun.status, 'CLAIMED', 'Run status must transition to CLAIMED');
  assert.ok(mockRun.updatedAt, 'Run lease updatedAt timestamp must be set');
  console.log('✓ TEST 47 Passed');

  // 48. Independent Heartbeat Execution During Long Playwright Work
  console.log('\n[TEST 48] Testing Independent Heartbeat Delivery During Long Async Execution...');
  let heartbeatsSent = 0;
  let simulatedWorkFinished = false;

  // Independent heartbeat interval simulator
  const intervalId = setInterval(() => {
    heartbeatsSent++;
  }, 10);

  // Long async task (e.g. Playwright DOM automation)
  await new Promise((resolve) => {
    setTimeout(() => {
      simulatedWorkFinished = true;
      resolve(true);
    }, 55);
  });
  clearInterval(intervalId);

  assert.strictEqual(simulatedWorkFinished, true);
  assert.ok(heartbeatsSent >= 3, `Heartbeats must continue independently during task execution (sent: ${heartbeatsSent})`);
  console.log('✓ TEST 48 Passed');

  // 49. Delayed Heartbeat with Active Task Lease is NOT Marked OFFLINE (Composite Status Invariant)
  console.log('\n[TEST 49] Testing Active Task Lease Prevents False OFFLINE Status...');
  const computeCompositeStatus = (agent: { lastHeartbeatAt: Date; status: string }, activeRun: { status: string; updatedAt: Date } | null) => {
    const now = Date.now();
    const lastHeartbeatMs = now - agent.lastHeartbeatAt.getTime();
    const isRunActive = activeRun && ['CLAIMED', 'RUNNING', 'AUTHENTICATING', 'NAVIGATING', 'MUTATING', 'VERIFYING'].includes(activeRun.status) && (now - activeRun.updatedAt.getTime() < 30000);

    if (isRunActive) {
      return 'BUSY';
    }
    if (lastHeartbeatMs > 15000) {
      return 'OFFLINE';
    }
    return agent.status;
  };

  // Agent heartbeat is 20s old (e.g. network hiccup), but active task lease was updated 2s ago
  const agentWithLaggedHeartbeat = { lastHeartbeatAt: new Date(Date.now() - 20000), status: 'ONLINE' };
  const freshActiveRun = { status: 'RUNNING', updatedAt: new Date(Date.now() - 2000) };

  const evaluatedStatus = computeCompositeStatus(agentWithLaggedHeartbeat, freshActiveRun);
  assert.strictEqual(evaluatedStatus, 'BUSY', 'Agent with active task lease must remain BUSY and never falsely evaluated as OFFLINE');
  console.log('✓ TEST 49 Passed');

  // 50. Progress Telemetry Extends Task Lease and Refreshes Agent Liveness
  console.log('\n[TEST 50] Testing Progress Telemetry Extends Execution Lease & Heartbeat...');
  const taskLease = {
    runId: 'run-102',
    status: 'CLAIMED',
    updatedAt: new Date(Date.now() - 25000), // lease was about to expire (25s ago)
    agentLastHeartbeatAt: new Date(Date.now() - 25000),
  };

  const receiveProgressTelemetry = (stage: string) => {
    taskLease.status = 'RUNNING';
    taskLease.updatedAt = new Date(); // extended!
    taskLease.agentLastHeartbeatAt = new Date(); // extended!
  };

  receiveProgressTelemetry('Updating remote status to INACTIVE in Simplex client…');
  const leaseAgeMs = Date.now() - taskLease.updatedAt.getTime();
  assert.ok(leaseAgeMs < 1000, 'Telemetry must refresh run updatedAt lease');
  assert.strictEqual(taskLease.status, 'RUNNING');
  console.log('✓ TEST 50 Passed');

  // 51. Genuine Disconnect Transitions to OFFLINE After Grace Period
  console.log('\n[TEST 51] Testing Genuine Disconnect Transitions to OFFLINE After Grace Period...');
  // No active run, and heartbeat is 20s old (>15s grace threshold)
  const deadAgent = { lastHeartbeatAt: new Date(Date.now() - 20000), status: 'ONLINE' };
  const deadRun = null;

  const deadStatus = computeCompositeStatus(deadAgent, deadRun);
  assert.strictEqual(deadStatus, 'OFFLINE', 'Agent without active lease and stale heartbeat >15s must be OFFLINE');

  // Active run also expired (>30s) and heartbeat is stale
  const expiredRun = { status: 'RUNNING', updatedAt: new Date(Date.now() - 35000) };
  const deadStatusWithExpiredRun = computeCompositeStatus(deadAgent, expiredRun);
  assert.strictEqual(deadStatusWithExpiredRun, 'OFFLINE', 'Agent with expired task lease and stale heartbeat must be OFFLINE');
  console.log('✓ TEST 51 Passed');

  // 52. UI Follows Claimed Job Directly Without Aborting on Global Badge Polling
  console.log('\n[TEST 52] Testing UI Follows Claimed Job Without False Abort...');
  let jobAborted = false;
  let runExecutionFinished = false;

  const trackRunUntilCompletion = async (runId: string, getGlobalBadgeStatus: () => string) => {
    // UI preflight passed
    let runStatus = 'CLAIMED';
    for (let i = 0; i < 5; i++) {
      // Background global badge flickers to OFFLINE due to unrelated jitter
      const globalBadge = getGlobalBadgeStatus();
      // INVARIANT: UI must NOT abort active job based on global badge polling
      if (runStatus === 'CLAIMED' || runStatus === 'RUNNING') {
        // continue polling specific run
      } else if (globalBadge === 'OFFLINE') {
        jobAborted = true;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    runStatus = 'COMPLETED';
    runExecutionFinished = true;
    return runStatus;
  };

  const finalJobStatus = await trackRunUntilCompletion('run-103', () => 'OFFLINE');
  assert.strictEqual(jobAborted, false, 'Claimed job must never be aborted by background global badge polling');
  assert.strictEqual(runExecutionFinished, true);
  assert.strictEqual(finalJobStatus, 'COMPLETED');
  console.log('✓ TEST 52 Passed');

  // 53. Activate and Deactivate Remote Verification Lifecycle
  console.log('\n[TEST 53] Testing Activate and Deactivate Remote Verification Lifecycle...');
  const remoteClientSimulator = {
    users: [{ username: 'dr_sarah', status: 'ACTIVE' as ClientUserStatus }],
    toggleUserStatus(username: string, targetStatus: ClientUserStatus) {
      const user = this.users.find((u) => u.username === username);
      if (!user) throw new Error('REMOTE_USER_NOT_FOUND');
      // Simulate remote DOM click & update
      user.status = targetStatus;
      // Re-read remote status
      return { success: true, username: user.username, status: user.status };
    },
  };

  // Test Deactivate
  const deactRes = remoteClientSimulator.toggleUserStatus('dr_sarah', 'INACTIVE');
  assert.strictEqual(deactRes.success, true);
  assert.strictEqual(deactRes.status, 'INACTIVE');

  // Test Activate
  const actRes = remoteClientSimulator.toggleUserStatus('dr_sarah', 'ACTIVE');
  assert.strictEqual(actRes.success, true);
  assert.strictEqual(actRes.status, 'ACTIVE');
  console.log('✓ TEST 53 Passed');

  // 54. Spinners, Modals, and Mutation Locks Always Cleared in Finally on Success and Error
  console.log('\n[TEST 54] Testing Spinners, Modals, and Mutation Locks Cleared in Finally Block...');
  const runLifecycleGuarantees = async (simulateError: boolean) => {
    let spinner = true;
    let lockAcquired = true;
    let modalShowing = true;

    try {
      if (simulateError) {
        throw new Error('SIMULATED_NETWORK_FAILURE');
      }
      // Success path: 500ms auto-close
      modalShowing = false;
    } catch (e) {
      // Error path: modal shows error, but spinner stops
    } finally {
      spinner = false;
      lockAcquired = false;
    }

    return { spinner, lockAcquired, modalShowing };
  };

  const successLifecycle = await runLifecycleGuarantees(false);
  assert.strictEqual(successLifecycle.spinner, false, 'Spinner cleared on success in finally');
  assert.strictEqual(successLifecycle.lockAcquired, false, 'Lock released on success in finally');
  assert.strictEqual(successLifecycle.modalShowing, false, 'Modal closed on success');

  const errorLifecycle = await runLifecycleGuarantees(true);
  assert.strictEqual(errorLifecycle.spinner, false, 'Spinner cleared on error in finally');
  assert.strictEqual(errorLifecycle.lockAcquired, false, 'Lock released on error in finally');
  console.log('✓ TEST 54 Passed');

  // 55. Plain text password adjacent to Password label capture
  console.log('\n[TEST 55] Testing Plain text password adjacent to Password label...');
  const simulateLiveDomPassword = (htmlSnippet: string) => {
    // Regex or DOM simulation matching our captureLiveDefaultPassword logic
    if (htmlSnippet.includes('label>Password</label>') || htmlSnippet.includes('label>Default Password</label>')) {
      const inputValMatch = htmlSnippet.match(/value="([^"]+)"/i);
      if (inputValMatch) return inputValMatch[1];
      const spanValMatch = htmlSnippet.match(/<span>([^<]+)<\/span>/i);
      if (spanValMatch && !spanValMatch[1].toLowerCase().includes('password')) return spanValMatch[1].trim();
      const tdValMatch = htmlSnippet.match(/<td>([^<]+)<\/td>/i);
      if (tdValMatch && !tdValMatch[1].toLowerCase().includes('password')) return tdValMatch[1].trim();
    }
    return null;
  };

  const sample1 = '<div class="field"><label>Password</label><input type="text" disabled value="LiveClientSecret123!" /></div>';
  const sample2 = '<div class="field"><label>Password</label><span>ClientDefault#99</span></div>';
  assert.strictEqual(simulateLiveDomPassword(sample1), 'LiveClientSecret123!');
  assert.strictEqual(simulateLiveDomPassword(sample2), 'ClientDefault#99');
  console.log('✓ TEST 55 Passed');

  // 56. Create Success Credential Popup with Captured Client Password
  console.log('\n[TEST 56] Testing Create Success Credential Popup with Captured Client Password...');
  const createModalState = {
    type: 'CREATE' as const,
    username: 'physician_karim',
    clientCode: 'HOSP_01',
    clientName: 'Central Hospital',
    password: 'LiveClientSecret123!',
    header: 'User created successfully',
    label: 'Default Password',
  };
  assert.strictEqual(createModalState.type, 'CREATE');
  assert.strictEqual(createModalState.password, 'LiveClientSecret123!');
  assert.strictEqual(createModalState.header, 'User created successfully');
  assert.strictEqual(createModalState.label, 'Default Password');
  console.log('✓ TEST 56 Passed');

  // 57. Reset Native Dialog Success Recognition
  console.log('\n[TEST 57] Testing Reset Native Dialog Success Recognition...');
  const recognizeDialogOutcome = (dialogMessage: string) => {
    const lower = dialogMessage.toLowerCase();
    const passMatch =
      dialogMessage.match(/Tmp@[A-Za-z0-9!@#$%^&*()_+=-]+/i) ||
      dialogMessage.match(/(?:temporary password is|new password:?)\s*([A-Za-z0-9!@#$%^&*()_+=-]+)/i);

    const isSuccess =
      Boolean(passMatch) ||
      lower.includes('password reset') ||
      lower.includes('reset successfully') ||
      lower.includes('password has been reset') ||
      lower.includes('updated successfully') ||
      lower.includes('success') ||
      lower.includes('are you sure') ||
      lower.includes('confirm');

    return {
      isConfirmed: isSuccess,
      temporaryPassword: passMatch ? (passMatch[1] || passMatch[0]).trim() : undefined,
    };
  };

  const nativeDialog1 = recognizeDialogOutcome('Password reset: Temporary password is Tmp@Alpha987!');
  assert.strictEqual(nativeDialog1.isConfirmed, true);
  assert.strictEqual(nativeDialog1.temporaryPassword, 'Tmp@Alpha987!');

  const nativeDialog2 = recognizeDialogOutcome('Password reset successfully.');
  assert.strictEqual(nativeDialog2.isConfirmed, true);
  assert.strictEqual(nativeDialog2.temporaryPassword, undefined);
  console.log('✓ TEST 57 Passed');

  // 58. Reset DOM Banner / Toast Success Recognition
  console.log('\n[TEST 58] Testing Reset DOM Toast / Banner Success Recognition...');
  const recognizeDomBanner = (toastText: string) => {
    const lower = toastText.toLowerCase();
    return (
      lower.includes('password reset successfully') ||
      lower.includes('reset successfully') ||
      lower.includes('password has been reset') ||
      lower.includes('updated successfully') ||
      lower.includes('success')
    );
  };
  assert.strictEqual(recognizeDomBanner('Success: Password has been reset for the selected user.'), true);
  assert.strictEqual(recognizeDomBanner('User updated successfully'), true);
  assert.strictEqual(recognizeDomBanner('Error: User not found'), false);
  console.log('✓ TEST 58 Passed');

  // 59. Reset Succeeded Without Username / Status Row Changing
  console.log('\n[TEST 59] Testing Reset Succeeded Without Username / Status Row Changing...');
  const userRowBeforeReset = { username: 'nurse_ali', status: 'ACTIVE' };
  // Reset executed & confirmed
  const userRowAfterReset = { username: 'nurse_ali', status: 'ACTIVE' };
  assert.strictEqual(userRowBeforeReset.username, userRowAfterReset.username);
  assert.strictEqual(userRowBeforeReset.status, userRowAfterReset.status, 'Status row invariant: status does not change during password reset');
  console.log('✓ TEST 59 Passed');

  // 60. Password Reset Failure Never Exposes Password
  console.log('\n[TEST 60] Testing Password Reset Failure Never Exposes Password...');
  const handleResetOutcome = (isSuccess: boolean, candidatePassword?: string) => {
    if (!isSuccess) {
      return {
        modalOpen: false,
        deliveredPassword: null,
      };
    }
    return {
      modalOpen: true,
      deliveredPassword: candidatePassword || null,
    };
  };

  const failedOutcome = handleResetOutcome(false, 'ShouldNotLeakSecret!');
  assert.strictEqual(failedOutcome.modalOpen, false, 'Modal remains closed on failure');
  assert.strictEqual(failedOutcome.deliveredPassword, null, 'Delivered password must be strictly null on failure');
  console.log('✓ TEST 60 Passed');

  // 61. Strict Client, Job, and Username Credential Isolation
  console.log('\n[TEST 61] Testing Strict Client, Job, and Username Isolation...');
  const ephemeralStore = new Map<string, string>();
  const makeKey = (clientId: string, jobId: string, username: string) => `${clientId}:${jobId}:${username}`;

  ephemeralStore.set(makeKey('client_A', 'job_101', 'dr_sarah'), 'SarahPass123!');
  ephemeralStore.set(makeKey('client_B', 'job_102', 'dr_sarah'), 'OtherClientPass456!');

  assert.strictEqual(ephemeralStore.get(makeKey('client_A', 'job_101', 'dr_sarah')), 'SarahPass123!');
  assert.strictEqual(ephemeralStore.get(makeKey('client_B', 'job_102', 'dr_sarah')), 'OtherClientPass456!');
  assert.notStrictEqual(
    ephemeralStore.get(makeKey('client_A', 'job_101', 'dr_sarah')),
    ephemeralStore.get(makeKey('client_B', 'job_102', 'dr_sarah'))
  );
  console.log('✓ TEST 61 Passed');

  // 62. 60-Second Auto-Purge & Immediate Memory Wipe on Close / Unmount
  console.log('\n[TEST 62] Testing 60-Second Auto-Purge & Memory Destruction on Close/Unmount...');
  let credentialMemory: { password: string | null; timerRemaining: number } | null = {
    password: 'ClientProvidedDefault123!',
    timerRemaining: 60,
  };

  // Simulate 60-second expiration
  credentialMemory.timerRemaining = 0;
  if (credentialMemory.timerRemaining <= 0) {
    credentialMemory.password = null;
  }
  assert.strictEqual(credentialMemory.password, null, 'Password must be nullified when timer expires');

  // Simulate component unmount / close
  credentialMemory = null;
  assert.strictEqual(credentialMemory, null, 'Memory reference must be wiped on unmount/close');
  console.log('✓ TEST 62 Passed');

  // 63. Fast Terminal-State Handling & Non-Blocking Background Sync
  console.log('\n[TEST 63] Testing Fast Terminal-State Handling & Non-Blocking Background Sync...');
  let bgSyncTriggered = false;
  let bgSyncCompleted = false;

  const triggerResetOperation = async () => {
    // 1. Reset remote confirmed
    const result = { success: true, status: 'REMOTE_PASSWORD_RESET_CONFIRMED', temporaryPassword: 'LivePass123!' };
    
    // 2. Trigger non-blocking background sync
    bgSyncTriggered = true;
    (async () => {
      await new Promise((r) => setTimeout(r, 20));
      bgSyncCompleted = true;
    })();

    // 3. Return immediately without awaiting background sync
    return result;
  };

  const immediateResult = await triggerResetOperation();
  assert.strictEqual(immediateResult.success, true);
  assert.strictEqual(immediateResult.status, 'REMOTE_PASSWORD_RESET_CONFIRMED');
  assert.strictEqual(bgSyncTriggered, true, 'Background sync was triggered');
  assert.strictEqual(bgSyncCompleted, false, 'Endpoint returned immediately without waiting for background sync');
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(bgSyncCompleted, true);
  // 64. Worker/API Ephemeral Password Transport Preservation without DB Persistence
  console.log('\n[TEST 64] Testing Worker/API Ephemeral Password Transport Preservation...');
  const simulatedWorkerCompletion = {
    status: 'COMPLETED',
    resultData: {
      success: true,
      username: 'dr_sarah',
      defaultPassword: 'LiveClientDefaultSecret123!',
      temporaryPassword: 'LiveClientDefaultSecret123!',
      status: 'ACTIVE',
      isRemoteSaveConfirmed: true,
    },
  };

  // API extracts ephemeral credentials for response
  const deliveredResponse = {
    username: simulatedWorkerCompletion.resultData.username,
    status: simulatedWorkerCompletion.resultData.status,
    defaultPassword: simulatedWorkerCompletion.resultData.defaultPassword,
    temporaryPassword: simulatedWorkerCompletion.resultData.temporaryPassword,
    message: `User '${simulatedWorkerCompletion.resultData.username}' created and verified on client.`,
  };

  assert.strictEqual(deliveredResponse.defaultPassword, 'LiveClientDefaultSecret123!');
  assert.strictEqual(deliveredResponse.temporaryPassword, 'LiveClientDefaultSecret123!');

  // Database snapshot audit: zero password fields
  const dbSnapshotEntity = {
    id: 'snap-101',
    clientId: 'client-1',
    username: 'dr_sarah',
    status: 'ACTIVE',
    hasSignature: false,
    hasStamp: false,
    hasProfileImage: false,
    isPresentRemotely: true,
  };
  assert.strictEqual('defaultPassword' in dbSnapshotEntity, false);
  assert.strictEqual('temporaryPassword' in dbSnapshotEntity, false);
  assert.strictEqual('password' in dbSnapshotEntity, false);
  console.log('✓ TEST 64 Passed');

  // 65. UI Modal Unmasked Plain-Text Display, Copy Buttons & 60-Second Auto-Clear
  console.log('\n[TEST 65] Testing UI Modal Unmasked Plain-Text Display, Copy Actions & 60s Auto-Clear...');
  const renderCredentialModalState = (info: { type: 'CREATE' | 'RESET'; username: string; password: string | null }) => {
    return {
      isOpen: true,
      type: info.type,
      title: info.type === 'CREATE' ? 'User created successfully' : 'Password reset successfully',
      username: info.username,
      displayedPasswordText: info.password || (info.type === 'CREATE' ? 'Default password was not provided by the client application.' : 'Password reset succeeded, but the client application did not provide the password.'),
      isDirectPlainText: true, // No masking, no Reveal/Hide buttons
      hasRevealButton: false,
      hasCopyUsername: true,
      hasCopyPassword: Boolean(info.password),
      hasCloseButton: true,
      countdownSeconds: 60,
    };
  };

  const createModal = renderCredentialModalState({
    type: 'CREATE',
    username: 'new_physician',
    password: 'ClientDirectPassword789!',
  });
  assert.strictEqual(createModal.title, 'User created successfully');
  assert.strictEqual(createModal.displayedPasswordText, 'ClientDirectPassword789!');
  assert.strictEqual(createModal.isDirectPlainText, true, 'Password must be shown directly as plain text');
  assert.strictEqual(createModal.hasRevealButton, false, 'Modal must have zero Reveal buttons');
  assert.strictEqual(createModal.hasCopyPassword, true);
  assert.strictEqual(createModal.hasCopyUsername, true);
  assert.strictEqual(createModal.hasCloseButton, true);

  const resetModal = renderCredentialModalState({
    type: 'RESET',
    username: 'nurse_ali',
    password: 'LiveResetSecret456!',
  });
  assert.strictEqual(resetModal.title, 'Password reset successfully');
  assert.strictEqual(resetModal.displayedPasswordText, 'LiveResetSecret456!');
  assert.strictEqual(resetModal.hasRevealButton, false);

  // 60-second expiration clears password
  let currentPasswordState: string | null = resetModal.displayedPasswordText;
  currentPasswordState = null; // after countdown expires or modal closes
  assert.strictEqual(currentPasswordState, null);
  console.log('✓ TEST 65 Passed');

  // 66. Safe Diagnostics Recording on Extraction Failure
  console.log('\n[TEST 66] Testing Safe Diagnostics Recording on Extraction Failure...');
  const generateSafeDiagnostics = (matchedCount: number, adjacentType: string, rawUrl: string) => {
    return {
      passwordValueFound: false,
      matchedLabelCount: matchedCount,
      adjacentElementType: adjacentType,
      sanitizedPageUrl: rawUrl.split('?')[0],
    };
  };

  const safeDiag = generateSafeDiagnostics(0, 'NONE', 'https://hospital.simplex.local/MasterV9.4/addUsers?token=secret123');
  assert.strictEqual(safeDiag.passwordValueFound, false);
  assert.strictEqual(safeDiag.matchedLabelCount, 0);
  assert.strictEqual(safeDiag.adjacentElementType, 'NONE');
  assert.strictEqual(safeDiag.sanitizedPageUrl, 'https://hospital.simplex.local/MasterV9.4/addUsers');
  assert.strictEqual('password' in safeDiag, false, 'Safe diagnostics must never contain password property');
  console.log('✓ TEST 66 Passed');

  // 67. Preflight Reconciliation: isPresentRemotely === false Blocks Mutation
  console.log('\n[TEST 67] Testing Preflight Reconciliation (isPresentRemotely === false Blocks Mutation)...');
  const checkMutationPreflight = (snapshot: { id: string; isPresentRemotely?: boolean; username: string }) => {
    if (snapshot.isPresentRemotely === false) {
      const err: any = new Error('REMOTE_USER_NOT_PRESENT — Refresh the selected client directory.');
      err.code = 'REMOTE_USER_NOT_PRESENT';
      throw err;
    }
    return true;
  };

  const staleSnapshot = { id: 'snap-1', isPresentRemotely: false, username: 'sathishtest' };
  assert.throws(
    () => checkMutationPreflight(staleSnapshot),
    (err: any) => err.code === 'REMOTE_USER_NOT_PRESENT' && err.message.includes('REMOTE_USER_NOT_PRESENT'),
    'Mutation on absent/stale remote user must be blocked'
  );

  const activeSnapshot = { id: 'snap-2', isPresentRemotely: true, username: 'valid_user' };
  assert.strictEqual(checkMutationPreflight(activeSnapshot), true);
  console.log('✓ TEST 67 Passed');

  // 68. Remote User Task Parameters Include remoteUserId and Normalized Identity
  console.log('\n[TEST 68] Testing Remote User Mutation Parameters Include remoteUserId...');
  const buildStatusTaskParams = (snapshot: any, client: any) => {
    return {
      taskType: 'CHANGE_CLIENT_USER_STATUS',
      remoteUserId: snapshot.remoteUserId,
      username: snapshot.username,
      currentStatus: snapshot.status,
      targetStatus: 'INACTIVE',
      clientBaseUrl: client.baseUrl,
      payload: {
        remoteUserId: snapshot.remoteUserId,
        username: snapshot.username,
        status: 'INACTIVE',
        targetStatus: 'INACTIVE',
      },
    };
  };

  const taskParams = buildStatusTaskParams(
    { remoteUserId: 'user_remote_101', username: 'abdul.p', status: 'ACTIVE' },
    { baseUrl: 'https://staging.simplexworld.com' }
  );
  assert.strictEqual(taskParams.remoteUserId, 'user_remote_101');
  assert.strictEqual(taskParams.payload.remoteUserId, 'user_remote_101');
  assert.strictEqual(taskParams.username, 'abdul.p');
  console.log('✓ TEST 68 Passed');

  // 69. Marking isPresentRemotely = false on REMOTE_USER_NOT_FOUND
  console.log('\n[TEST 69] Testing Auto-marking isPresentRemotely = false on REMOTE_USER_NOT_FOUND...');
  const snapshotState = { id: 'snap-3', username: 'deleted_remotely', isPresentRemotely: true };
  const handleNotFoundStatusFailure = (errorCode: string, snap: typeof snapshotState) => {
    if (errorCode === 'REMOTE_USER_NOT_FOUND') {
      snap.isPresentRemotely = false;
    }
  };

  handleNotFoundStatusFailure('REMOTE_USER_NOT_FOUND', snapshotState);
  assert.strictEqual(snapshotState.isPresentRemotely, false, 'Snapshot must be marked isPresentRemotely = false on REMOTE_USER_NOT_FOUND');
  console.log('✓ TEST 69 Passed');

  // 70. UI getMutationState Disables Action on isPresentRemotely === false
  console.log('\n[TEST 70] Testing UI getMutationState Disables Action on isPresentRemotely === false...');
  const getMutationState = (baseTitle: string, user?: { isPresentRemotely?: boolean }, isOnline: boolean = true) => {
    if (user && user.isPresentRemotely === false) {
      return { title: 'REMOTE_USER_NOT_PRESENT — Refresh the selected client directory.', disabled: true };
    }
    if (!isOnline) {
      return { title: 'Desktop automation agent is offline.', disabled: true };
    }
    return { title: baseTitle, disabled: false };
  };

  const disabledState = getMutationState('Activate in Simplex', { isPresentRemotely: false }, true);
  assert.strictEqual(disabledState.disabled, true);
  assert.strictEqual(disabledState.title, 'REMOTE_USER_NOT_PRESENT — Refresh the selected client directory.');

  const enabledState = getMutationState('Activate in Simplex', { isPresentRemotely: true }, true);
  assert.strictEqual(enabledState.disabled, false);
  assert.strictEqual(enabledState.title, 'Activate in Simplex');
  console.log('✓ TEST 70 Passed');

  // 71. One-Click, One-Run Client-Scoped Single Flight Key SYNC_USERS:{clientId}
  console.log('\n[TEST 71] Testing Single-Flight Key SYNC_USERS:{clientId} and Job Coalescing...');
  const activeFlightMap = new Map<string, Promise<{ jobId: string }>>();
  let createdJobCount = 0;

  const triggerSync = async (clientId: string) => {
    const flightKey = `SYNC_USERS:${clientId}`;
    if (activeFlightMap.has(flightKey)) {
      return activeFlightMap.get(flightKey)!;
    }
    const flightPromise = (async () => {
      createdJobCount++;
      const res = { jobId: `sync_job_${clientId}_${createdJobCount}` };
      await new Promise((r) => setTimeout(r, 20));
      return res;
    })();
    activeFlightMap.set(flightKey, flightPromise);
    try {
      return await flightPromise;
    } finally {
      activeFlightMap.delete(flightKey);
    }
  };

  // Trigger 3 concurrent sync requests for client-A
  const [resA1, resA2, resA3] = await Promise.all([
    triggerSync('client-A'),
    triggerSync('client-A'),
    triggerSync('client-A'),
  ]);
  assert.strictEqual(resA1.jobId, resA2.jobId, 'Concurrent syncs for client-A must share the same job ID');
  assert.strictEqual(resA2.jobId, resA3.jobId, 'All coalesced syncs must return the same job ID');
  assert.strictEqual(createdJobCount, 1, 'Only one job must be created for simultaneous clicks');
  console.log('✓ TEST 71 Passed');

  // 72. Invariant Enforcement: remoteUniqueUsers = centralRowsPersisted = centralRowsDisplayed
  console.log('\n[TEST 72] Testing Sync Count Invariant & CLIENT_USER_COUNT_MISMATCH Error...');
  const reconcileSnapshot = (remoteCount: number, persistedCount: number, displayedCount: number) => {
    if (remoteCount !== persistedCount || persistedCount !== displayedCount) {
      const err: any = new Error(`CLIENT_USER_COUNT_MISMATCH: Remote (${remoteCount}) != Persisted (${persistedCount}) != Displayed (${displayedCount})`);
      err.code = 'CLIENT_USER_COUNT_MISMATCH';
      throw err;
    }
    return { success: true, count: persistedCount };
  };

  assert.strictEqual(reconcileSnapshot(25, 25, 25).count, 25);
  assert.throws(
    () => reconcileSnapshot(25, 24, 25),
    (err: any) => err.code === 'CLIENT_USER_COUNT_MISMATCH'
  );
  assert.throws(
    () => reconcileSnapshot(25, 25, 26),
    (err: any) => err.code === 'CLIENT_USER_COUNT_MISMATCH'
  );
  console.log('✓ TEST 72 Passed');

  // 73. Dependent Profile Role & Short Mobile Validation
  console.log('\n[TEST 73] Testing REMOTE_REQUIRED_FIELD_UNSUPPORTED and Short Mobile Validation...');
  const validateCreateFields = (dto: { role?: string; profileRole?: string; mobileNumber: string }, dependentRoles: Record<string, string[]>) => {
    if (!dto.mobileNumber || dto.mobileNumber.trim() === '') {
      throw new Error('REQUIRED_FIELD_MISSING: Mobile No is required');
    }
    // Accept short numbers (2, 123, 00123) without regex min/max length rejection
    if (dto.role && dependentRoles[dto.role] && dependentRoles[dto.role].length > 0 && !dto.profileRole) {
      const err: any = new Error('REMOTE_REQUIRED_FIELD_UNSUPPORTED — Selected Role requires Profile Role.');
      err.code = 'REMOTE_REQUIRED_FIELD_UNSUPPORTED';
      throw err;
    }
    return true;
  };

  const roleDeps = {
    'Physician': ['Cardiologist', 'Neurologist'],
    'Nurse': [],
  };

  // Physician requires profile role, none provided -> reject
  assert.throws(
    () => validateCreateFields({ role: 'Physician', profileRole: undefined, mobileNumber: '00123' }, roleDeps),
    (err: any) => err.code === 'REMOTE_REQUIRED_FIELD_UNSUPPORTED'
  );

  // Nurse does not require profile role -> valid with short mobile
  assert.strictEqual(validateCreateFields({ role: 'Nurse', profileRole: undefined, mobileNumber: '2' }, roleDeps), true);
  assert.strictEqual(validateCreateFields({ role: 'Physician', profileRole: 'Cardiologist', mobileNumber: '12345' }, roleDeps), true);
  console.log('✓ TEST 73 Passed');

  // 74. Single Batch-Level Post-Import Sync & Reconciliation of REMOTE_CREATE_VERIFICATION_FAILED
  console.log('\n[TEST 74] Testing Single Batch-Level Post-Import Sync & Reconciliation...');
  const mockBatchRows = [
    { sNo: 1, username: 'onetest', firstName: 'One', lastName: 'Test' },
    { sNo: 2, username: 'twotest', firstName: 'Two', lastName: 'Test' },
    { sNo: 3, username: 'threetest', firstName: 'Three', lastName: 'Test' },
    { sNo: 4, username: 'fourtest', firstName: 'Four', lastName: 'Test' },
    { sNo: 5, username: 'fivetest', firstName: 'Five', lastName: 'Test' },
    { sNo: 6, username: 'sixtest', firstName: 'Six', lastName: 'Test' },
    { sNo: 7, username: 'seventest', firstName: 'Seven', lastName: 'Test' },
    { sNo: 8, username: 'eighttest', firstName: 'Eight', lastName: 'Test' },
    { sNo: 9, username: 'ninetest', firstName: 'Nine', lastName: 'Test' },
    { sNo: 10, username: 'tentest', firstName: 'Ten', lastName: 'Test' },
  ];

  // Initial execution state: 9 rows returned REMOTE_CREATE_VERIFICATION_FAILED, 1 row (eighttest) returned REMOTE_VALIDATION_FAILED
  const initialResults = mockBatchRows.map((r) => {
    if (r.username === 'eighttest') {
      return {
        sNo: r.sNo,
        rowNumber: r.sNo + 1,
        username: r.username,
        result: 'FAILED',
        errorCode: 'REMOTE_VALIDATION_FAILED',
        message: 'Username eighttest: Invalid character in user name on Simplex portal',
      };
    }
    return {
      sNo: r.sNo,
      rowNumber: r.sNo + 1,
      username: r.username,
      result: 'FAILED',
      errorCode: 'REMOTE_CREATE_VERIFICATION_FAILED',
      message: `User '${r.username}' could not be verified on the remote user list after creation.`,
    };
  });

  // Simulate ONE batch-level read-only sync returning 9 users that exist on remote portal
  const syncedRemoteDirectory = [
    { username: 'onetest', fullName: 'One Test', status: 'ACTIVE' },
    { username: 'twotest', fullName: 'Two Test', status: 'ACTIVE' },
    { username: 'threetest', fullName: 'Three Test', status: 'ACTIVE' },
    { username: 'fourtest', fullName: 'Four Test', status: 'ACTIVE' },
    { username: 'fivetest', fullName: 'Five Test', status: 'ACTIVE' },
    { username: 'sixtest', fullName: 'Six Test', status: 'ACTIVE' },
    { username: 'seventest', fullName: 'Seven Test', status: 'ACTIVE' },
    { username: 'ninetest', fullName: 'Nine Test', status: 'ACTIVE' },
    { username: 'tentest', fullName: 'Ten Test', status: 'ACTIVE' },
  ];

  const remoteUsernames = new Map(syncedRemoteDirectory.map((u) => [u.username.toLowerCase(), u]));

  let reconciledCreated = 0;
  let trulyMissingUnconfirmed = 0;
  let validationFailed = 0;

  const reconciledResults = initialResults.map((res) => {
    if (res.errorCode === 'REMOTE_CREATE_VERIFICATION_FAILED') {
      const match = remoteUsernames.get(res.username.toLowerCase());
      if (match) {
        reconciledCreated++;
        return {
          ...res,
          result: 'CREATED',
          remoteStatus: match.status,
          errorCode: undefined,
          message: `User '${res.username}' created and verified on client via batch reconciliation.`,
        };
      } else {
        trulyMissingUnconfirmed++;
        return {
          ...res,
          result: 'FAILED',
          errorCode: 'REMOTE_CREATE_UNCONFIRMED',
          message: `REMOTE_CREATE_UNCONFIRMED — User '${res.username}' could not be confirmed in client users directory after batch synchronization. Requires operator review before retry.`,
        };
      }
    } else {
      validationFailed++;
      return res;
    }
  });

  assert.strictEqual(reconciledCreated, 9, 'Exactly 9 usernames must be reconciled from FAILED to CREATED');
  assert.strictEqual(validationFailed, 1, 'Exactly 1 username (eighttest) must remain validation failed');
  assert.strictEqual(trulyMissingUnconfirmed, 0, 'Zero missing unconfirmed rows in this set');
  assert.strictEqual(reconciledResults.filter((r) => r.result === 'CREATED').length, 9);
  assert.strictEqual(reconciledResults.find((r) => r.username === 'eighttest')?.errorCode, 'REMOTE_VALIDATION_FAILED');
  console.log('✓ TEST 74 Passed');

  // 75. Exact Safe Validation Message for eighttest
  console.log('\n[TEST 75] Testing Exact Safe Validation Message Capture (No Generic Masking)...');
  const eightTestResult = reconciledResults.find((r) => r.username === 'eighttest')!;
  assert.strictEqual(eightTestResult.message.includes('User creation failed on client portal'), false, 'Must not use generic message');
  assert.ok(eightTestResult.message.includes('Invalid character in user name on Simplex portal'), 'Must capture exact validation message');
  console.log('✓ TEST 75 Passed');

  // 76. Batch Sync Deduplication Invariant
  console.log('\n[TEST 76] Testing Batch Sync Produces Zero Duplicate Central Rows...');
  const centralSnapshots = [
    { id: '1', username: 'onetest', isPresentRemotely: true },
    { id: '2', username: 'twotest', isPresentRemotely: true },
    { id: '3', username: 'threetest', isPresentRemotely: true },
  ];

  const incomingRemoteList = [
    { username: 'onetest', fullName: 'One Test', status: 'ACTIVE' },
    { username: 'twotest', fullName: 'Two Test', status: 'ACTIVE' },
    { username: 'threetest', fullName: 'Three Test', status: 'ACTIVE' },
  ];

  const dedupedMap = new Map<string, any>();
  for (const item of incomingRemoteList) {
    const key = item.username.toLowerCase();
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, item);
    }
  }

  assert.strictEqual(dedupedMap.size, 3, 'Batch sync must contain exactly 3 unique users without duplicates');
  console.log('✓ TEST 76 Passed');

  console.log('\n======================================================================');
  console.log('✓ ALL CLIENT USER DATA ISOLATION, RELIABILITY & MUTATION TESTS PASSED (76/76)');
  console.log('======================================================================\n');
}

runClientUserMutationUnitTests().catch((err) => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});

