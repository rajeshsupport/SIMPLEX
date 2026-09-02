import { PermissionCode } from '../constants/permissions.js';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'LOCKED';

export interface UserSummary {
  id: string;
  username: string;
  email: string;
  fullName: string;
  status: UserStatus;
  failedAttempts: number;
  lockoutUntil?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
  roles: RoleSummary[];
  assignedClientIds: string[];
}

export interface RoleSummary {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: PermissionCode[];
}

export interface JwtPayload {
  sub: string;
  username: string;
  email: string;
  roles: string[];
  permissions: PermissionCode[];
  allowedClientIds: string[]; // empty array means ALL if super admin
  isSuperAdmin: boolean;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResult {
  tokens: AuthTokens;
  user: UserSummary;
}

export interface ClientAccessMapping {
  userId: string;
  clientId: string;
  accessLevel: 'READ_ONLY' | 'OPERATOR' | 'ADMIN';
  grantedBy: string;
  createdAt: string;
}
