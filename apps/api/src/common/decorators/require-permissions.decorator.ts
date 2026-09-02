import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from '@hmc/shared';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
