export type ImportJobType = 'SERVICE_MASTER' | 'USER_CREATION';

export type ImportJobStatus =
  | 'PENDING'
  | 'VALIDATED'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PAUSED'
  | 'CANCELLED';

export type ImportRowStatus =
  | 'PENDING'
  | 'VALIDATED'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'REQUIRES_REVIEW';

export interface ColumnMappingDefinition {
  sourceColumn: string;
  targetField: string;
  isRequired: boolean;
  dataType: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'EMAIL';
  defaultValue?: string | number | boolean;
}

export interface ImportPreviewSummary {
  fileName: string;
  fileSizeBytes: number;
  totalRows: number;
  validRowsCount: number;
  invalidRowsCount: number;
  duplicateRowsCount: number;
  previewRows: Array<{
    rowIndex: number;
    rawValues: Record<string, any>;
    mappedValues: Record<string, any>;
    isValid: boolean;
    validationErrors: string[];
    isDuplicate: boolean;
  }>;
  availableColumns: string[];
  suggestedMappings: Record<string, string>;
}

export interface ServiceMasterRowData {
  serviceCode: string;
  serviceName: string;
  category: string;
  department: string;
  unitPrice: number;
  taxRate?: number;
  billingFrequency?: string;
  isActive: boolean;
  notes?: string;
}

export interface UserImportRowData {
  username: string;
  email: string;
  fullName: string;
  department: string;
  role: string;
  initialPassword?: string;
  forcePasswordChange?: boolean;
}
