import { SetMetadata } from '@nestjs/common';

export const CLIENT_ACCESS_KEY = 'require_client_access';
export const RequireClientAccess = (paramName: string = 'clientId') =>
  SetMetadata(CLIENT_ACCESS_KEY, paramName);
