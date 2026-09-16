import { z } from 'zod';

export const CreateQuickResourceSchema = z.object({
  clientId: z.string().uuid('Invalid Client ID format'),
  resourceName: z
    .string()
    .min(1, 'Resource name is required')
    .max(250, 'Resource name max 250 characters')
    .trim(),
  isResourceHuman: z.boolean().default(true),
  resourceType: z.string().min(1, 'Resource type is required').max(150).trim(),
  specialty: z.string().min(1, 'Specialty is required').max(150).trim(),
  departments: z.string().min(1, 'Departments is required').trim().default('ALL'),
  colorIdentificationCode: z.string().max(10).default('FFFFFF').optional(),
  services: z.string().min(1, 'Services is required').trim().default('ALL'),
  operatingFrom: z.string().max(10).default('00:00').optional(),
  operatingTo: z.string().max(10).default('23:55').optional(),
  branchId: z.string().optional(),
});

export type CreateQuickResourceDto = z.infer<typeof CreateQuickResourceSchema>;

// Alias for generic creation
export const CreateClientResourceSchema = CreateQuickResourceSchema;
export type CreateClientResourceDto = CreateQuickResourceDto;

export const MapResourceUserSchema = z.object({
  clientId: z.string().uuid('Invalid Client ID format'),
  remoteResourceId: z.string().min(1, 'Remote Resource ID is required'),
  resourceName: z.string().optional(),
  remoteUserId: z.string().optional(),
  username: z.string().min(1, 'Username is required'),
  isShownInRegistration: z.boolean().default(true),
  branchId: z.string().optional(),
});

export type MapResourceUserDto = z.infer<typeof MapResourceUserSchema>;

export const CombinedResourceUserRowSchema = z
  .object({
    sNo: z.number().optional(),
    resourceName: z.string().min(1, 'Resource name is required').max(250).trim(),
    isResourceHuman: z.union([z.boolean(), z.enum(['Yes', 'No', 'YES', 'NO', 'yes', 'no'])]),
    resourceType: z.string().min(1, 'Resource type is required').max(150).trim(),
    specialty: z.string().min(1, 'Specialty is required').max(150).trim(),
    departments: z.string().default('ALL'),
    colorIdentificationCode: z.string().default('FFFFFF').optional(),
    services: z.string().default('ALL'),
    operatingFrom: z.string().default('00:00').optional(),
    operatingTo: z.string().default('23:55').optional(),
    // User fields (mandatory if Human)
    username: z.string().optional(),
    password: z.string().optional(),
    firstName: z.string().optional(),
    middleName: z.string().optional(),
    lastName: z.string().optional(),
    nickName: z.string().optional(),
    gender: z.string().optional(),
    dob: z.string().optional(),
    designation: z.string().optional(),
    mobile: z.string().optional(),
    email: z.string().optional(),
    nationality: z.string().optional(),
    roles: z.string().optional(),
    branch: z.string().optional(),
    isShownInRegistration: z.union([z.boolean(), z.enum(['Yes', 'No', 'YES', 'NO', 'yes', 'no'])]).optional().default(true),
    // Section 4: eClaim Configuration (optional)
    eclaimLink: z.string().optional(),
    eclaimName: z.string().optional(),
    eclaimPassword: z.string().optional(),
    eclaimDesignation: z.string().optional(),
    eclaimProviderType: z.string().optional(),
    eclaimActivityType: z.string().optional(),
    eclaimLicenseNumber: z.string().optional(),
    eclaimInsuranceCompany: z.string().optional(),
    eclaimBranchName: z.string().optional(),
    oldEclaimName: z.string().optional(),
    oldEclaimPassword: z.string().optional(),
    oldLicenseNo: z.string().optional(),
    actualLicenseNo: z.string().optional(),
    eclaimProviderId: z.string().optional(),
    eclaimFacilityId: z.string().optional(),
    eclaimSpecialtyCode: z.string().optional(),
    // Section 5 & 6: EMR Form Assignment & Transfer (optional)
    emrForms: z.string().optional(),
    emrDefaultForm: z.string().optional(),
    emrEncounterType: z.string().optional(),
    emrGroup: z.string().optional(),
    emrTransferTargetBranch: z.string().optional(),
    emrTransferDefaultFormIndicator: z.string().optional(),
  })
  .refine(
    (data) => {
      const isHuman =
        typeof data.isResourceHuman === 'boolean'
          ? data.isResourceHuman
          : ['yes', 'true', '1'].includes(String(data.isResourceHuman).toLowerCase());

      if (isHuman) {
        // Must provide mandatory user fields
        if (!data.username || !data.username.trim()) return false;
        if (!data.firstName || !data.firstName.trim()) return false;
        if (!data.lastName || !data.lastName.trim()) return false;
        if (!data.mobile || !data.mobile.trim()) return false;
        if (!data.roles || !data.roles.trim()) return false;
      } else {
        // Non-human resources must not have user credentials / user fields
        if (data.username && data.username.trim()) return false;
        if (data.firstName && data.firstName.trim()) return false;
      }
      return true;
    },
    {
      message: 'Human resources require Username, First Name, Last Name, Mobile, and Roles. Non-human resources must not specify user fields.',
      path: ['username'],
    }
  );

export type CombinedResourceUserRowDto = z.infer<typeof CombinedResourceUserRowSchema>;

export const RetryResourceJobSchema = z.object({
  jobId: z.string().uuid('Invalid Job ID format'),
  rowNumbers: z.array(z.number()).optional(),
  startStage: z
    .enum([
      'FAILED_BEFORE_RESOURCE_CREATION',
      'RESOURCE_CREATED_USER_PENDING',
      'USER_CREATED_ROLE_PENDING',
      'ROLES_MAPPED_RESOURCE_USER_PENDING',
      'RESOURCE_USER_MAPPING_VERIFICATION_FAILED',
    ])
    .optional(),
});

export type RetryResourceJobDto = z.infer<typeof RetryResourceJobSchema>;

export const ExecuteResourceImportSchema = z.object({
  clientId: z.string().uuid('Invalid Client ID format'),
  fileName: z.string().min(1),
  rows: z.array(z.any()),
});

export type ExecuteResourceImportDto = z.infer<typeof ExecuteResourceImportSchema>;

export const SetClientResourceStatusSchema = z.object({
  clientId: z.string().uuid('Invalid Client ID format'),
  remoteResourceId: z.string().min(1, 'Resource ID is required'),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  reason: z.string().max(500).optional(),
});

export type SetClientResourceStatusDto = z.infer<typeof SetClientResourceStatusSchema>;

export const SyncClientResourcesSchema = z.object({
  clientId: z.string().uuid('Invalid Client ID format'),
  forceFreshSession: z.boolean().optional().default(false),
});

export type SyncClientResourcesDto = z.infer<typeof SyncClientResourcesSchema>;

export const UpdateClientResourceSchema = z.object({
  resourceName: z.string().min(1).max(250).trim().optional(),
  specialty: z.string().max(150).optional().nullable(),
  resourceType: z.string().max(150).optional(),
  linkedUsername: z.string().max(100).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type UpdateClientResourceDto = z.infer<typeof UpdateClientResourceSchema>;

// Master Workbook Constants
export const RESOURCE_IMPORT_SHEETS = [
  'Resource Import',
  'Instructions',
  'EMR Forms',
  'Resource Types',
  'Specialties',
  'Departments',
  'Services',
  'Branches',
  'Nationalities',
  'Roles',
  'Template Info',
] as const;

// 6-Sheet Integrated Master Workbook Constants
export const RESOURCE_INTEGRATED_SHEETS = [
  'Resource Details',
  'Associated User',
  'User–Resource Mapping',
  'eClaim Configuration',
  'EMR Form Assignment',
  'Template Info',
] as const;

export const RESOURCE_STEP_COLUMNS = [
  // Step 1: Resource Core Profile (10 cols)
  { step: 1, name: 'S.No', required: false, width: 8, group: 'Step 1: Resource Details' },
  { step: 1, name: 'Resource Name*', required: true, width: 26, group: 'Step 1: Resource Details' },
  { step: 1, name: 'Is Resource Human*', required: true, width: 22, group: 'Step 1: Resource Details' },
  { step: 1, name: 'Resource Type*', required: true, width: 24, group: 'Step 1: Resource Details' },
  { step: 1, name: 'Specialty*', required: true, width: 22, group: 'Step 1: Resource Details' },
  { step: 1, name: 'Departments*', required: true, width: 20, group: 'Step 1: Resource Details' },
  { step: 1, name: 'Color Identification Code', required: false, width: 25, group: 'Step 1: Resource Details' },
  { step: 1, name: 'Services*', required: true, width: 20, group: 'Step 1: Resource Details' },
  { step: 1, name: 'Operating From*', required: true, width: 18, group: 'Step 1: Resource Details' },
  { step: 1, name: 'Operating To*', required: true, width: 18, group: 'Step 1: Resource Details' },

  // Step 2: User Account & Credentials (9 cols - Password, Nick Name, Date of Birth, Designation removed)
  { step: 2, name: 'Username* (Human Only)', required: true, width: 25, group: 'Step 2: Associated User' },
  { step: 2, name: 'First Name* (Human Only)', required: true, width: 25, group: 'Step 2: Associated User' },
  { step: 2, name: 'Middle Name', required: false, width: 18, group: 'Step 2: Associated User' },
  { step: 2, name: 'Last Name* (Human Only)', required: true, width: 25, group: 'Step 2: Associated User' },
  { step: 2, name: 'Gender', required: false, width: 14, group: 'Step 2: Associated User' },
  { step: 2, name: 'Mobile* (Human Only)', required: true, width: 22, group: 'Step 2: Associated User' },
  { step: 2, name: 'Email', required: false, width: 26, group: 'Step 2: Associated User' },
  { step: 2, name: 'Nationality* (Human Only)', required: true, width: 26, group: 'Step 2: Associated User' },
  { step: 2, name: 'Roles* (Comma-Separated, Human Only)', required: true, width: 32, group: 'Step 2: Associated User' },


  // Step 3: Resource Mapping & Registration Display (1 col - Branch removed)
  { step: 3, name: 'Is Shown in Registration*', required: true, width: 26, group: 'Step 3: User–Resource Mapping' },

  // Step 4: eClaim Configuration (10 cols matching live /addUserEclaim screen)
  { step: 4, name: 'Eclaim Link', required: false, width: 24, group: 'Step 4: eClaim Configuration' },
  { step: 4, name: 'Eclaim Name', required: false, width: 24, group: 'Step 4: eClaim Configuration' },
  { step: 4, name: 'Eclaim Password', required: false, width: 22, group: 'Step 4: eClaim Configuration' },
  { step: 4, name: 'License No', required: false, width: 20, group: 'Step 4: eClaim Configuration' },
  { step: 4, name: 'Insurance Company', required: false, width: 26, group: 'Step 4: eClaim Configuration' },
  { step: 4, name: 'Branch Name', required: false, width: 22, group: 'Step 4: eClaim Configuration' },
  { step: 4, name: 'Old Eclaim Name', required: false, width: 24, group: 'Step 4: eClaim Configuration' },
  { step: 4, name: 'Old Eclaim Password', required: false, width: 22, group: 'Step 4: eClaim Configuration' },
  { step: 4, name: 'Old License No', required: false, width: 20, group: 'Step 4: eClaim Configuration' },
  { step: 4, name: 'Actual License No', required: false, width: 22, group: 'Step 4: eClaim Configuration' },

  // Step 5: EMR Form Assignment & Transfer (4 cols - EMR Group & EMR Target Branch removed)
  { step: 5, name: 'EMR Forms* (Comma-Separated)', required: true, width: 32, group: 'Step 5: EMR Form Assignment' },
  { step: 5, name: 'EMR Default Form', required: false, width: 24, group: 'Step 5: EMR Form Assignment' },
  { step: 5, name: 'EMR Encounter Type', required: false, width: 22, group: 'Step 5: EMR Form Assignment' },
  { step: 5, name: 'EMR Transfer Default (Yes/No)', required: false, width: 28, group: 'Step 5: EMR Form Assignment' },
] as const;

export const RESOURCE_IMPORT_COLUMNS = RESOURCE_STEP_COLUMNS.map((c) => c.name);



