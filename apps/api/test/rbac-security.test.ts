import nestCommon from '@nestjs/common';
import nestCore from '@nestjs/core';
const { ForbiddenException } = nestCommon;
const { Reflector } = nestCore;

import { PermissionsGuard } from '../dist/common/guards/permissions.guard.js';
import { ClientAccessGuard } from '../dist/common/guards/client-access.guard.js';
import { PERMISSIONS, SYSTEM_ROLES } from '@hmc/shared';

function runRbacGuardTests() {
  console.log('--- Testing RBAC & Client Access Authorization Guards ---');

  const reflector = new Reflector();
  const permissionsGuard = new PermissionsGuard(reflector);
  const clientAccessGuard = new ClientAccessGuard(reflector);

  // Mock Reflector
  jestReflector(reflector);

  // 1. Super Admin Bypass Test
  const superAdminContext = createMockContext({
    roles: [SYSTEM_ROLES.SUPER_ADMIN],
    permissions: [],
    isSuperAdmin: true,
    allowedClientIds: [],
  });

  const canSuperAdminPass = permissionsGuard.canActivate(superAdminContext);
  if (!canSuperAdminPass) throw new Error('Super Admin was incorrectly blocked by PermissionsGuard');
  console.log('✓ Super Admin bypass verified.');

  // 2. Unauthorized Role Test (URL Operator attempting Client Creation)
  const urlOperatorContext = createMockContext({
    roles: [SYSTEM_ROLES.URL_OPERATOR],
    permissions: [PERMISSIONS.CLIENT_VIEW, PERMISSIONS.CLIENT_OPEN],
    isSuperAdmin: false,
    allowedClientIds: ['client-1'],
  });

  try {
    permissionsGuard.canActivate(urlOperatorContext);
    throw new Error('URL Operator should have been rejected for client.create permission');
  } catch (err: any) {
    if (!(err instanceof ForbiddenException)) throw err;
    console.log('✓ Negative Test: Unauthorized role correctly rejected with 403 Forbidden.');
  }

  // 3. Client Access Level 3 Guard Test
  const clientAccessContext = createMockContext(
    {
      roles: [SYSTEM_ROLES.URL_OPERATOR],
      permissions: [PERMISSIONS.CLIENT_OPEN],
      isSuperAdmin: false,
      allowedClientIds: ['client-101'],
    },
    { clientId: 'client-999' } // Target client not assigned to user
  );

  try {
    clientAccessGuard.canActivate(clientAccessContext);
    throw new Error('User was allowed access to unassigned client-999!');
  } catch (err: any) {
    if (!(err instanceof ForbiddenException)) throw err;
    console.log('✓ Client Scope Test: Unassigned client access correctly rejected with 403 Forbidden.');
  }

  console.log('All RBAC and Client Access Guard tests passed successfully!');
}

function jestReflector(reflector: any) {
  reflector.getAllAndOverride = (key: string) => {
    if (key === 'permissions') return [PERMISSIONS.CLIENT_CREATE];
    if (key === 'require_client_access') return 'clientId';
    return null;
  };
}

function createMockContext(user: any, params: any = {}): any {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        params,
        query: {},
        body: {},
      }),
      getResponse: () => ({}),
    }),
  };
}

runRbacGuardTests();
