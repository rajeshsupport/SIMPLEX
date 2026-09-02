import { z } from 'zod';

export const LoginRequestSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type LoginRequestDto = z.infer<typeof LoginRequestSchema>;

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(10, 'Refresh token is required'),
});

export type RefreshTokenRequestDto = z.infer<typeof RefreshTokenRequestSchema>;

export const CreateUserRequestSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/, 'Username can only contain alphanumeric characters, underscores, dots, and hyphens'),
  email: z.string().email('Valid email is required'),
  fullName: z.string().min(2).max(100),
  password: z.string().min(10, 'Password must be at least 10 characters with upper, lower, number, and special character')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
  roleIds: z.array(z.string().uuid()).min(1, 'At least one role is required'),
  assignedClientIds: z.array(z.string().uuid()).optional().default([]),
});

export type CreateUserRequestDto = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  assignedClientIds: z.array(z.string().uuid()).optional(),
});

export type UpdateUserRequestDto = z.infer<typeof UpdateUserRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(10, 'New password must meet complexity requirements')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[a-z]/, 'Must contain lowercase')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
});

export type ChangePasswordRequestDto = z.infer<typeof ChangePasswordRequestSchema>;

export const AdminResetPasswordRequestSchema = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(10),
  requirePasswordChangeOnLogin: z.boolean().optional().default(true),
});

export type AdminResetPasswordRequestDto = z.infer<typeof AdminResetPasswordRequestSchema>;
