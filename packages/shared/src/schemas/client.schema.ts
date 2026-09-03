import { z } from 'zod';

export const CreateClientSchema = z.object({
  clientCode: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[A-Za-z0-9_-]+$/, 'Client code must be alphanumeric, hyphens or underscores')
    .transform((v) => v.toUpperCase()),
  clientName: z.string().min(2).max(100),
  baseUrl: z.string().url('Must be a valid URL (e.g. https://client-hmc.example.com or http://localhost:4000)'),
  applicationPath: z.string().default('/hmc'),
  environment: z.enum(['Production', 'Staging', 'UAT', 'Test', 'Development', 'Local']),
  applicationVersion: z.string().default('v1.0'),
  loginRoute: z.string().default('/hmc/login'),
  usersRoute: z.string().default('/hmc/users'),
  servicesRoute: z.string().default('/hmc/services'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).default('ACTIVE'),
  allowedDesktopAgents: z.array(z.string()).optional().default([]),
});

export type CreateClientDto = z.infer<typeof CreateClientSchema>;

export const UpdateClientSchema = CreateClientSchema.partial();
export type UpdateClientDto = z.infer<typeof UpdateClientSchema>;

export const SaveClientCredentialsSchema = z.object({
  clientId: z.string().uuid(),
  credentialName: z.string().min(2).max(50).default('Default HMC Operator'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export type SaveClientCredentialsDto = z.infer<typeof SaveClientCredentialsSchema>;
