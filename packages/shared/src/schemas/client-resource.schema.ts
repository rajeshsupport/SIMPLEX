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
  remoteUserId: z.string().min(1, 'Remote User ID is required'),
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
    firstName: z.string().optional(),
    middleName: z.string().optional(),
    lastName: z.string().optional(),
    mobile: z.string().optional(),
    email: z.string().optional(),
    nationality: z.string().optional(),
    roles: z.string().optional(),
    isShownInRegistration: z.union([z.boolean(), z.enum(['Yes', 'No', 'YES', 'NO', 'yes', 'no'])]).optional().default(true),
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

// 10-Sheet Workbook Constants
export const RESOURCE_IMPORT_SHEETS = [
  'Resource Import',
  'Instructions',
  'Resource Types',
  'Specialties',
  'Departments',
  'Services',
  'Branches',
  'Nationalities',
  'Roles',
  'Template Info',
] as const;

export const RESOURCE_IMPORT_COLUMNS = [
  'S.No',
  'Resource Name*',
  'Is Resource Human*',
  'Resource Type*',
  'Specialty*',
  'Departments*',
  'Color Identification Code',
  'Services*',
  'Operating From*',
  'Operating To*',
  'Username* (Human Only)',
  'First Name* (Human Only)',
  'Middle Name',
  'Last Name* (Human Only)',
  'Mobile* (Human Only)',
  'Email',
  'Nationality* (Human Only)',
  'Roles* (Human Only)',
  'Is Shown in Registration',
] as const;
