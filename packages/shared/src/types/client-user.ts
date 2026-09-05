export type ClientUserStatus = 'ACTIVE' | 'INACTIVE';

export type SyncJobState =
  | 'QUEUED'
  | 'CLAIMED'
  | 'AUTHENTICATING'
  | 'NAVIGATING'
  | 'EXTRACTING'
  | 'PERSISTING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export interface SyncProgressUpdate {
  stage: SyncJobState;
  message: string;
  currentPage: number;
  totalPages?: number;
  count: number;
  streamedUsers?: any[];
}

export interface ClientUser {
  id: string;
  clientId: string;
  clientCode?: string;
  clientName?: string;
  environment?: string;
  remoteUserId?: string | null;
  username: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  fullName: string;
  nickName?: string | null;
  email?: string | null;
  mobileNumber?: string | null;
  nationality?: string | null;
  role?: string | null;
  profileRole?: string | null;
  status: ClientUserStatus;
  barcodeNumber?: string | null;
  hasSignature: boolean;
  signatureUrl?: string | null;
  hasStamp: boolean;
  stampUrl?: string | null;
  hasProfileImage: boolean;
  profileImageUrl?: string | null;
  isPresentRemotely?: boolean;
  syncRunId?: string | null;
  remoteCreatedAt?: string | null;
  remoteUpdatedAt?: string | null;
  lastSyncedAt: string;
  createdAt?: string;
  updatedAt?: string;
  credentialDeliveryStatus?: CredentialDeliveryStatus;
  message?: string;
}

export interface FormDropdownOption {
  label: string;
  value: string;
  clientId?: string;
  applicationVersion?: string;
  roleDependency?: string;
}

export interface ClientCreateFormMetadata {
  clientId: string;
  applicationVersion: string;
  addUsersUrl: string;
  nationalities: FormDropdownOption[];
  roles: FormDropdownOption[];
  profileRoles: FormDropdownOption[];
  fieldMappings?: Record<string, string>;
}

export interface ClientUserSyncSummary {
  remoteRowsRead: number;
  remotePagesRead: number;
  remoteDuplicatesRemoved: number;
  remoteUniqueUsers: number;
  centralRowsPersisted: number;
  centralRowsDisplayed: number;
  staleRowsExcluded: number;
  crossClientRowsExcluded: number;
  syncRunId?: string;
  remoteUsersFetched?: number;
  excludedStaleRecords?: number;
  duplicateRemoteRecordsRemoved?: number;
}

export interface ClientUserListResponse {
  users: ClientUser[];
  totalCount: number;
  activeCount?: number;
  inactiveCount?: number;
  lastSyncedAt: string | null;
  syncSummary?: ClientUserSyncSummary;
  liveClientOptions?: {
    nationalities: string[] | FormDropdownOption[];
    roles: string[] | FormDropdownOption[];
    profileRoles: string[] | FormDropdownOption[];
  };
}

export interface CreateClientUserDto {
  clientId: string;
  username: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  nickName?: string;
  email?: string;
  mobileNumber: string;
  nationality: string;
  role?: string;
  roles?: string[];
  profileRole?: string;
  barcodeNumber?: string;
  signatureBase64?: string;
  signatureFilename?: string;
  stampBase64?: string;
  stampFilename?: string;
  profileBase64?: string;
  profileFilename?: string;
  status?: ClientUserStatus;
  overrideDuplicateName?: boolean;
}

export interface UpdateClientUserDto {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  nickName?: string;
  email?: string;
  mobileNumber?: string;
  nationality?: string;
  role?: string;
  roles?: string[];
  profileRole?: string;
  barcodeNumber?: string;
  signatureBase64?: string;
  signatureFilename?: string;
  stampBase64?: string;
  stampFilename?: string;
  profileBase64?: string;
  profileFilename?: string;
  status?: ClientUserStatus;
}

export type UserImportAction = 'CREATE' | 'UPDATE' | 'ACTIVATE' | 'DEACTIVATE';

export type UserImportClassification =
  | 'READY'
  | 'READY_CREATE'
  | 'READY_UPDATE'
  | 'READY_ACTIVATE'
  | 'READY_DEACTIVATE'
  | 'WARNING_REQUIRES_CONFIRMATION'
  | 'INVALID'
  | 'DUPLICATE'
  | 'ALREADY_EXISTS'
  | 'CREATED'
  | 'FAILED'
  | 'CANCELLED'
  | 'NOT_PROCESSED'
  | 'NO_CHANGE'
  | 'DUPLICATE_SERIAL_NUMBER'
  | 'DUPLICATE_USERNAME'
  | 'DUPLICATE_USERNAME_IN_FILE'
  | 'POTENTIAL_DUPLICATE_NAME'
  | 'DUPLICATE_EMAIL'
  | 'DUPLICATE_MOBILE'
  | 'INVALID_REQUIRED_FIELD'
  | 'INVALID_EMAIL'
  | 'INVALID_MOBILE'
  | 'INVALID_NATIONALITY'
  | 'INVALID_ROLE'
  | 'INVALID_EXCEL_FORMAT'
  | 'FORM_OPTIONS_UNAVAILABLE'
  | 'CONFLICT'
  | 'BLOCKED';

export interface ParsedRoleValidationResult {
  rawValue: string;
  parsedRoles: string[];
  validRoles: string[];
  invalidRoles: string[];
  isValid: boolean;
  canonicalRoleString: string;
}

export interface ExcelUserImportRow {
  sNo?: number | string;
  rowNumber: number;
  action: UserImportAction;
  username: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  nickName?: string;
  email?: string;
  mobileNumber?: string;
  nationality?: string;
  role?: string;
  roles?: string[];
  parsedRoles?: string[];
  validRoles?: string[];
  invalidRoles?: string[];
  profileRole?: string;
  barcodeNumber?: string;
  requestedStatus?: ClientUserStatus;
  existingStatus?: ClientUserStatus;
  classification: UserImportClassification;
  validationErrors: string[];
  errorCode?: string;
  message?: string;
  isApproved?: boolean;
  retryStartingPoint?: UserWorkflowRetryStartingPoint;
  validationState?: UserValidationStageState;
  creationState?: UserCreationStageState;
  userSearchState?: UserSearchStageState;
  roleSelectionState?: RoleSelectionStageState;
  roleUpdateState?: RoleUpdateStageState;
  roleVerificationState?: RoleVerificationStageState;
  potentialDuplicateOf?: {
    username: string;
    fullName: string;
    mobileNumber?: string;
    status: string;
  };
}

export interface ExcelUserImportPreviewResult {
  totalRows: number;
  readyRows: number;
  warningRows?: number;
  alreadyExistingRows?: number;
  errorRows: number;
  rows: ExcelUserImportRow[];
  liveClientOptions: {
    nationalities: string[];
    roles: string[];
    profileRoles: string[];
  };
}

export type UserValidationStageState = 'NOT_STARTED' | 'IN_PROGRESS' | 'PASSED' | 'FAILED';
export type UserCreationStageState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
export type UserSearchStageState = 'NOT_STARTED' | 'IN_PROGRESS' | 'EXACT_MATCH_FOUND' | 'FAILED' | 'AMBIGUOUS' | 'SKIPPED';
export type RoleSelectionStageState = 'NOT_STARTED' | 'IN_PROGRESS' | 'SELECTED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
export type RoleUpdateStageState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
export type RoleVerificationStageState = 'NOT_STARTED' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'SKIPPED';
export type ImportProgressStage =
  | 'VALIDATING'
  | 'CREATING_USER'
  | 'USER_CREATED'
  | 'OPENING_ROLE_SCREEN'
  | 'SEARCHING_USER'
  | 'SELECTING_ROLES'
  | 'SUBMITTING_ROLES'
  | 'VERIFYING_ROLES'
  | 'COMPLETED';
export type UserWorkflowOverallStatus = 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIAL_FAILED' | 'FAILED' | 'ALREADY_EXISTS' | 'CANCELLED' | 'NOT_PROCESSED' | 'SKIPPED_DUPLICATE';
export type UserWorkflowRetryStartingPoint = 'USER_CREATION' | 'ROLE_MAPPING' | 'VALIDATION' | 'NONE';
export type BatchFinalStatus = 'COMPLETED' | 'COMPLETED_WITH_ROW_ERRORS' | 'PAUSED_SYSTEM_ERROR' | 'FAILED_NO_ROWS_PROCESSED';

export interface ExcelUserImportExecutionRowResult {
  sNo?: number | string;
  rowNumber: number;
  action: UserImportAction;
  username: string;
  fullName: string;
  result: 'SUCCESS' | 'CREATED' | 'COMPLETED' | 'PARTIAL_FAILED' | 'ALREADY_EXISTS' | 'FAILED' | 'SKIPPED_DUPLICATE' | 'CANCELLED' | 'VALIDATION_FAILED' | 'INVALID' | 'NOT_PROCESSED' | 'REMOTE_ERROR' | 'UNKNOWN_RESULT_REQUIRES_REVIEW' | 'CREATED_WITH_INCORRECT_REMOTE_ERROR_MESSAGE' | 'REMOTE_CREATE_BLOCKED_UNKNOWN_ERROR' | 'USER_SELECTION_AMBIGUOUS' | 'ROLE_MAPPING_FAILED';
  errorCode?: string;
  message: string;
  remoteStatus?: ClientUserStatus;
  existingStatus?: ClientUserStatus;
  executedAt: string;
  correlationId: string;

  // Granular stage-by-stage status breakdown
  validationState?: UserValidationStageState;
  creationState?: UserCreationStageState;
  userSearchState?: UserSearchStageState;
  roleSelectionState?: RoleSelectionStageState;
  roleUpdateState?: RoleUpdateStageState;
  roleVerificationState?: RoleVerificationStageState;
  overallStatus?: UserWorkflowOverallStatus;
  failureReason?: string;
  retryStartingPoint?: UserWorkflowRetryStartingPoint;
  nextAction?: string;

  // Role Mapping details
  requestedRoles?: string[];
  mappedRoles?: string[];
  missingRoles?: string[];
  roleSelectionProgress?: string;

  // Non-sensitive credential delivery status (zero password or event-id retention in generic results)
  credentialDeliveryStatus?: CredentialDeliveryStatus;
}

export type CredentialDeliveryStatus = 'DELIVERED' | 'RESTRICTED' | 'UNAVAILABLE' | 'EXPIRED' | 'FAILED';

export interface EphemeralCredentialPayload {
  oneTimeEventId: string;
  oneTimeEventIdHash: string;
  initiatingOperatorId: string;
  initiatingSessionId?: string;
  clientId: string;
  jobId: string;
  rowNumber?: number;
  username: string;
  fullName?: string;
  password?: string | null;
  createdAt: string;
  hardExpiresAt: string;
}

export interface ClaimEphemeralCredentialDto {
  oneTimeEventId: string;
  clientId: string;
  jobId: string;
  sessionId?: string;
}

export interface AckEphemeralCredentialDto {
  oneTimeEventId: string;
  status?: 'DELIVERED' | 'VIEWED' | 'DISMISSED' | 'EXPIRED' | 'FAILED';
}

export interface EphemeralCredentialAck {
  oneTimeEventIdHash: string;
  acknowledged: boolean;
  acknowledgedAt: string;
  status?: string;
}

export interface EphemeralCredentialDeliveryMetadata {
  oneTimeEventIdHash: string;
  jobId: string;
  deliveryStatus: CredentialDeliveryStatus;
  deliveredAt: string | null;
  expiredAt: string | null;
}

export interface UserEphemeralCredentialEvent {
  eventType: 'USER_EPHEMERAL_CREDENTIAL_READY';
  oneTimeEventId: string;
  oneTimeEventIdHash: string;
  jobId: string;
  clientId: string;
  rowNumber?: number;
  username: string;
  fullName?: string;
  credentialDeliveryStatus: CredentialDeliveryStatus;
  createdAt: string;
  hardExpiresAt: string;
  displayDurationSeconds: number;
}

export const CREDENTIAL_QUEUE_REQUIRES_OPERATOR_ATTENTION = 'CREDENTIAL_QUEUE_REQUIRES_OPERATOR_ATTENTION';

export interface ExcelUserImportExecutionSummary {
  jobId: string;
  totalRows: number;
  createdRows: number;
  completedRows?: number;
  failedBeforeCreationRows?: number;
  userCreatedRolePendingRows?: number;
  alreadyExistingRows: number;
  invalidRows: number;
  failedRows: number;
  cancelledRows: number;
  notProcessedRows: number;
  succeededRows: number;
  skippedRows: number;
  remainingUnprocessedRows?: number;
  batchStatus?: BatchFinalStatus;
  systemPaused?: boolean;
  systemPauseReason?: string;
  lastSuccessfulUser?: string;
  currentFailedUser?: string;
  results: ExcelUserImportExecutionRowResult[];
  ephemeralCredentials?: UserEphemeralCredentialEvent[];
}

export const CLIENT_USER_ERROR_CODES = {
  DUPLICATE_SERIAL_NUMBER: 'DUPLICATE_SERIAL_NUMBER',
  DUPLICATE_USERNAME: 'DUPLICATE_USERNAME',
  DUPLICATE_USERNAME_IN_FILE: 'DUPLICATE_USERNAME_IN_FILE',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  POTENTIAL_DUPLICATE_NAME: 'POTENTIAL_DUPLICATE_NAME',
  REQUIRED_FIELD_MISSING: 'REQUIRED_FIELD_MISSING',
  INVALID_FIELD_FORMAT: 'INVALID_FIELD_FORMAT',
  REMOTE_DROPDOWN_OPTION_NOT_FOUND: 'REMOTE_DROPDOWN_OPTION_NOT_FOUND',
  FORM_OPTIONS_UNAVAILABLE: 'FORM_OPTIONS_UNAVAILABLE',
  REMOTE_USER_NOT_FOUND: 'REMOTE_USER_NOT_FOUND',
  REMOTE_FORM_NOT_RECOGNIZED: 'REMOTE_FORM_NOT_RECOGNIZED',
  REMOTE_FORM_NOT_READY: 'REMOTE_FORM_NOT_READY',
  REMOTE_SAVE_REJECTED: 'REMOTE_SAVE_REJECTED',
  REMOTE_CREATE_VERIFICATION_FAILED: 'REMOTE_CREATE_VERIFICATION_FAILED',
  REMOTE_VALIDATION_FAILED: 'REMOTE_VALIDATION_FAILED',
  REMOTE_STATUS_VERIFICATION_FAILED: 'REMOTE_STATUS_VERIFICATION_FAILED',
  CLIENT_AUTO_LOGIN_FAILED: 'CLIENT_AUTO_LOGIN_FAILED',
  CLIENT_MUTATION_TIMEOUT: 'CLIENT_MUTATION_TIMEOUT',
  PASSWORD_RESET_FAILED: 'PASSWORD_RESET_FAILED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  FACILITY_CONTEXT_NOT_INITIALIZED: 'FACILITY_CONTEXT_NOT_INITIALIZED',
  AGENT_OFFLINE: 'AGENT_OFFLINE',
  OPERATION_TIMED_OUT: 'OPERATION_TIMED_OUT',
  PRODUCTION_MUTATION_BLOCKED: 'PRODUCTION_MUTATION_BLOCKED',
  OPERATION_IN_PROGRESS: 'OPERATION_IN_PROGRESS',
  INVALID_EXCEL_FORMAT: 'INVALID_EXCEL_FORMAT',
  NOT_PROCESSED: 'NOT_PROCESSED',
  BROWSER_CONTEXT_CLOSED_BEFORE_ACTION: 'BROWSER_CONTEXT_CLOSED_BEFORE_ACTION',
  BROWSER_CONTEXT_CLOSED_AFTER_ACTION: 'BROWSER_CONTEXT_CLOSED_AFTER_ACTION',
  REMOTE_OUTCOME_UNKNOWN: 'REMOTE_OUTCOME_UNKNOWN',
  PROFILE_ALREADY_IN_USE: 'PROFILE_ALREADY_IN_USE',
  BROWSER_DISCONNECTED: 'BROWSER_DISCONNECTED',
  DOM_READ_ABORTED: 'DOM_READ_ABORTED',
  REMOTE_CREATE_UNCONFIRMED: 'REMOTE_CREATE_UNCONFIRMED',
  REMOTE_REQUIRED_FIELD_UNSUPPORTED: 'REMOTE_REQUIRED_FIELD_UNSUPPORTED',
  CLIENT_MISMATCH: 'CLIENT_MISMATCH',
  INVALID_CLIENT_URL: 'INVALID_CLIENT_URL',
  MISSING_CLIENT_URL: 'MISSING_CLIENT_URL',
  HOST_MISMATCH_AFTER_REDIRECT: 'HOST_MISMATCH_AFTER_REDIRECT',
  USER_SELECTION_AMBIGUOUS: 'USER_SELECTION_AMBIGUOUS',
  ROLE_CONTROL_NOT_FOUND: 'ROLE_CONTROL_NOT_FOUND',
  ROLE_UPDATE_FAILED: 'ROLE_UPDATE_FAILED',
  ROLE_VERIFICATION_MISMATCH: 'ROLE_VERIFICATION_MISMATCH',
  BATCH_PAUSED_SYSTEM_ERROR: 'BATCH_PAUSED_SYSTEM_ERROR',
  CLIENT_UNREACHABLE: 'CLIENT_UNREACHABLE',
  ROUTE_ADD_USERS_UNAVAILABLE: 'ROUTE_ADD_USERS_UNAVAILABLE',
  ROUTE_ADD_USER_ROLE_UNAVAILABLE: 'ROUTE_ADD_USER_ROLE_UNAVAILABLE',
  SELECTOR_PROFILE_INCOMPATIBLE: 'SELECTOR_PROFILE_INCOMPATIBLE',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  MUTATION_WORKER_UNAVAILABLE: 'MUTATION_WORKER_UNAVAILABLE',
  CONSECUTIVE_INFRASTRUCTURE_FAILURES: 'CONSECUTIVE_INFRASTRUCTURE_FAILURES',
  AGENT_DISCONNECTED: 'AGENT_DISCONNECTED',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  BROWSER_PROCESS_CRASHED: 'BROWSER_PROCESS_CRASHED',
} as const;

export type ClientUserErrorCode = keyof typeof CLIENT_USER_ERROR_CODES;

export const SYSTEM_CIRCUIT_BREAKER_CODES = new Set<string>([
  'AGENT_DISCONNECTED',
  'AGENT_OFFLINE',
  'DESKTOP_AGENT_OFFLINE',
  'AUTH_SESSION_EXPIRED',
  'CLIENT_AUTO_LOGIN_FAILED',
  'AUTHENTICATION_FAILED',
  'BROWSER_PROCESS_CRASHED',
  'BROWSER_CONTEXT_CLOSED_BEFORE_ACTION',
  'BROWSER_DISCONNECTED',
  'CLIENT_UNREACHABLE',
  'DATABASE_UNAVAILABLE',
  'MUTATION_WORKER_UNAVAILABLE',
  'CONSECUTIVE_INFRASTRUCTURE_FAILURES',
  'HOST_MISMATCH_AFTER_REDIRECT',
]);

export const ROW_LEVEL_ERROR_CODES = new Set<string>([
  'ROLE_UPDATE_FAILED',
  'ROLE_CONTROL_NOT_FOUND',
  'REMOTE_USER_NOT_FOUND',
  'USER_SELECTION_NOT_FOUND',
  'USER_SELECTION_AMBIGUOUS',
  'USER_SELECTION_ID_MISMATCH',
  'ROLE_VERIFICATION_MISMATCH',
  'SELECTOR_PROFILE_INCOMPATIBLE',
  'ROUTE_ADD_USER_ROLE_UNAVAILABLE',
  'REMOTE_REQUIRED_FIELD_NOT_FOUND',
  'REMOTE_DROPDOWN_OPTION_NOT_FOUND',
  'REMOTE_FORM_VALIDATION_FAILED',
  'REMOTE_CREATE_VERIFICATION_FAILED',
  'REMOTE_SUBMIT_BUTTON_DISABLED',
  'REMOTE_FORM_NOT_RECOGNIZED',
  'REMOTE_ERROR',
  'OPERATION_TIMED_OUT',
]);

export function isSystemCircuitBreakerError(errorCode?: string, errorMessage?: string): boolean {
  if (!errorCode) return false;
  if (ROW_LEVEL_ERROR_CODES.has(errorCode)) return false;
  if (SYSTEM_CIRCUIT_BREAKER_CODES.has(errorCode)) return true;

  const msg = (errorMessage || '').toLowerCase();
  if (
    msg.includes('net::err_connection') ||
    msg.includes('econnrefused') ||
    msg.includes('client unreachable') ||
    msg.includes('enotfound')
  ) {
    return true;
  }
  if (
    msg.includes('agent offline') ||
    msg.includes('agent disconnected') ||
    msg.includes('worker unavailable') ||
    msg.includes('mutation worker unavailable')
  ) {
    return true;
  }
  if (
    msg.includes('browser crashed') ||
    msg.includes('target closed') ||
    msg.includes('browser process')
  ) {
    return true;
  }
  if (
    msg.includes('database unavailable') ||
    msg.includes('mssql unavailable') ||
    msg.includes('connection to db failed')
  ) {
    return true;
  }
  return false;
}
