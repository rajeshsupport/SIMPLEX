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
  defaultPassword?: string;
  temporaryPassword?: string;
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
  profileRole?: string;
  barcodeNumber?: string;
  requestedStatus?: ClientUserStatus;
  existingStatus?: ClientUserStatus;
  classification: UserImportClassification;
  validationErrors: string[];
  errorCode?: string;
  message?: string;
  isApproved?: boolean;
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

export interface ExcelUserImportExecutionRowResult {
  sNo?: number | string;
  rowNumber: number;
  action: UserImportAction;
  username: string;
  fullName: string;
  result: 'SUCCESS' | 'CREATED' | 'ALREADY_EXISTS' | 'FAILED' | 'SKIPPED_DUPLICATE' | 'CANCELLED' | 'VALIDATION_FAILED' | 'INVALID' | 'NOT_PROCESSED' | 'REMOTE_ERROR' | 'UNKNOWN_RESULT_REQUIRES_REVIEW' | 'CREATED_WITH_INCORRECT_REMOTE_ERROR_MESSAGE' | 'REMOTE_CREATE_BLOCKED_UNKNOWN_ERROR';
  errorCode?: string;
  message: string;
  remoteStatus?: ClientUserStatus;
  existingStatus?: ClientUserStatus;
  executedAt: string;
  correlationId: string;
}

export interface ExcelUserImportExecutionSummary {
  jobId: string;
  totalRows: number;
  createdRows: number;
  alreadyExistingRows: number;
  invalidRows: number;
  failedRows: number;
  cancelledRows: number;
  notProcessedRows: number;
  succeededRows: number;
  skippedRows: number;
  results: ExcelUserImportExecutionRowResult[];
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
} as const;

export type ClientUserErrorCode = keyof typeof CLIENT_USER_ERROR_CODES;
