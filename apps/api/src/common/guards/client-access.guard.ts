import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CLIENT_ACCESS_KEY } from '../decorators/require-client.decorator.js';
import { SYSTEM_ROLES } from '@hmc/shared';

@Injectable()
export class ClientAccessGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const paramName = this.reflector.getAllAndOverride<string>(
      CLIENT_ACCESS_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!paramName) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('User context missing');
    }

    // Super Admin has universal client access
    if (user.isSuperAdmin || user.roles?.includes(SYSTEM_ROLES.SUPER_ADMIN)) {
      return true;
    }

    const clientId =
      request.params[paramName] ||
      request.params.clientId ||
      request.params.id ||
      request.query[paramName] ||
      request.body?.[paramName] ||
      request.body?.clientId;

    if (!clientId) {
      return true; // No client param present to restrict
    }

    const allowedClientIds: string[] = user.allowedClientIds || [];
    if (!allowedClientIds.includes(clientId)) {
      throw new ForbiddenException(`Access to client ${clientId} is not authorized for this user account`);
    }

    return true;
  }
}
