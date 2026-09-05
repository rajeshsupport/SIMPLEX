export type ClientResourceStatus = 'ACTIVE' | 'INACTIVE';

export enum ResourceImportStage {
  NOT_STARTED = 'NOT_STARTED',
  VALIDATED = 'VALIDATED',
  FAILED_BEFORE_RESOURCE_CREATION = 'FAILED_BEFORE_RESOURCE_CREATION',
  RESOURCE_CREATED_USER_PENDING = 'RESOURCE_CREATED_USER_PENDING',
  USER_CREATED_ROLE_PENDING = 'USER_CREATED_ROLE_PENDING',
  ROLES_MAPPED_RESOURCE_USER_PENDING = 'ROLES_MAPPED_RESOURCE_USER_PENDING',
  RESOURCE_USER_MAPPING_VERIFICATION_FAILED = 'RESOURCE_USER_MAPPING_VERIFICATION_FAILED',
  COMPLETED = 'COMPLETED',
}

export interface ClientResourceDepartmentDto {
  departmentCode: string;
  departmentName: string;
}

export interface ClientResourceServiceDto {
  serviceCode: string;
  serviceName: string;
}

export interface ClientResource {
  id: string;
  clientId: string;
  clientCode?: string;
  clientName?: string;
  environment?: string;
  remoteResourceId: string;
  resourceName: string;
  isResourceHuman: boolean;
  remoteResourceTypeId?: string | null;
  resourceTypeName?: string | null;
  remoteSpecialtyId?: string | null;
  specialtyName?: string | null;
  colorIdentificationCode: string;
  operatingFrom: string;
  operatingTo: string;
  selectAllDepartments: boolean;
  selectAllServices: boolean;
  linkedRemoteUserId?: string | null;
  linkedUsername?: string | null;
  isShownInRegistration: boolean;
  branchId?: string | null;
  branchName?: string | null;
  remoteStatus: string;
  isPresentRemotely?: boolean;
  lastVerifiedAt: string;
  lastSyncedAt: string;
  departments?: ClientResourceDepartmentDto[];
  services?: ClientResourceServiceDto[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateQuickResourceInput {
  clientId: string;
  resourceName: string;
  isResourceHuman: boolean;
  resourceType: string;
  specialty: string;
  departments: string; // 'ALL' or comma-separated
  colorIdentificationCode?: string; // default 'FFFFFF'
  services: string; // 'ALL' or comma-separated
  operatingFrom?: string; // default '00:00'
  operatingTo?: string; // default '23:55'
  branchId?: string;
}

export interface MapResourceUserInput {
  clientId: string;
  remoteResourceId: string;
  resourceName?: string;
  remoteUserId: string;
  username: string;
  isShownInRegistration?: boolean;
  branchId?: string;
}

export interface CombinedResourceUserImportRow {
  sNo?: number;
  resourceName: string;
  isResourceHuman: boolean | string; // 'Yes' | 'No' | true | false
  resourceType: string;
  specialty: string;
  departments: string; // 'ALL' or comma-separated
  colorIdentificationCode?: string; // 'FFFFFF'
  services: string; // 'ALL' or comma-separated
  operatingFrom?: string; // '00:00'
  operatingTo?: string; // '23:55'
  // User fields (mandatory if isResourceHuman is true/Yes)
  username?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  mobile?: string;
  email?: string;
  nationality?: string;
  roles?: string;
  isShownInRegistration?: boolean | string; // 'Yes' | 'No' | true | false
}

export interface ResourceImportRowState {
  rowNumber: number;
  resourceName: string;
  isResourceHuman: boolean;
  remoteResourceId?: string | null;
  remoteUserId?: string | null;
  username?: string | null;
  stage: ResourceImportStage;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  retryStartingPoint?: string | null;
  safeErrorCode?: string | null;
  safeErrorMessage?: string | null;
}

export interface ResourceImportJobSummary {
  jobId: string;
  clientId: string;
  clientCode: string;
  fileName: string;
  status: 'PENDING' | 'PREVIEW' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  totalRows: number;
  completedRows: number;
  failedRows: number;
  skippedRows: number;
  rows: ResourceImportRowState[];
  createdAt: string;
  updatedAt: string;
}

export interface ClientResourceFilter {
  search?: string;
  isResourceHuman?: boolean | 'ALL';
  resourceType?: string;
  specialty?: string;
  status?: ClientResourceStatus | 'ALL';
  page?: number;
  limit?: number;
}
