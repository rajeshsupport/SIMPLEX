import { z } from 'zod';

export const ServiceMasterRowSchema = z.object({
  serviceCode: z.string().min(1, 'Service Code is required').max(50),
  serviceName: z.string().min(2, 'Service Name is required').max(150),
  category: z.string().min(1, 'Category is required').max(50),
  department: z.string().min(1, 'Department is required').max(50),
  unitPrice: z.coerce.number().min(0, 'Unit Price must be non-negative'),
  taxRate: z.coerce.number().min(0).max(100).optional().default(0),
  billingFrequency: z.string().optional().default('ONE_TIME'),
  isActive: z.coerce.boolean().optional().default(true),
  notes: z.string().max(500).optional(),
});

export type ServiceMasterRowDto = z.infer<typeof ServiceMasterRowSchema>;

export const UserImportRowSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50),
  email: z.string().email('Valid email is required'),
  fullName: z.string().min(2, 'Full Name is required').max(100),
  department: z.string().min(1, 'Department is required'),
  role: z.string().min(1, 'Role is required'),
  initialPassword: z.string().min(8).optional(),
  forcePasswordChange: z.coerce.boolean().optional().default(true),
});

export type UserImportRowDto = z.infer<typeof UserImportRowSchema>;

export const CreateImportJobSchema = z.object({
  clientId: z.string().uuid('Valid client ID is required'),
  jobType: z.enum(['SERVICE_MASTER', 'USER_CREATION']),
  columnMappings: z.record(z.string(), z.string()).optional(),
  oneRecordTestMode: z.boolean().optional().default(false),
  typedConfirmation: z.string().optional(), // Required for production clients
});

export type CreateImportJobDto = z.infer<typeof CreateImportJobSchema>;
