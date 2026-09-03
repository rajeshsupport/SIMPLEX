export type ClientUserStatus = 'ACTIVE' | 'INACTIVE';

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
  remoteCreatedAt?: string | null;
  remoteUpdatedAt?: string | null;
  lastSyncedAt: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClientUserListResponse {
  users: ClientUser[];
  totalCount: number;
  lastSyncedAt: string | null;
  liveClientOptions?: {
    nationalities: string[];
    roles: string[];
    profileRoles: string[];
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
  | 'READY_CREATE'
  | 'READY_UPDATE'
  | 'READY_ACTIVATE'
  | 'READY_DEACTIVATE'
  | 'NO_CHANGE'
  | 'DUPLICATE_USERNAME'
  | 'POTENTIAL_DUPLICATE_NAME'
  | 'DUPLICATE_EMAIL'
  | 'DUPLICATE_MOBILE'
  | 'INVALID_REQUIRED_FIELD'
  | 'INVALID_EMAIL'
  | 'INVALID_MOBILE'
  | 'INVALID_NATIONALITY'
  | 'INVALID_ROLE'
  | 'CONFLICT'
  | 'BLOCKED';

export interface ExcelUserImportRow {
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
  classification: UserImportClassification;
  validationErrors: string[];
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
  errorRows: number;
  rows: ExcelUserImportRow[];
  liveClientOptions: {
    nationalities: string[];
    roles: string[];
    profileRoles: string[];
  };
}

export interface ExcelUserImportExecutionRowResult {
  rowNumber: number;
  action: UserImportAction;
  username: string;
  fullName: string;
  result: 'SUCCESS' | 'SKIPPED_DUPLICATE' | 'VALIDATION_FAILED' | 'REMOTE_ERROR' | 'UNKNOWN_RESULT_REQUIRES_REVIEW' | 'CREATED_WITH_INCORRECT_REMOTE_ERROR_MESSAGE' | 'REMOTE_CREATE_BLOCKED_UNKNOWN_ERROR';
  errorCode?: string;
  message: string;
  remoteStatus?: ClientUserStatus;
  executedAt: string;
  correlationId: string;
}

export interface ExcelUserImportExecutionSummary {
  jobId: string;
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
  results: ExcelUserImportExecutionRowResult[];
}
