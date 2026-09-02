import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { RbacService } from './rbac.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../common/decorators/user.decorator.js';
import { PERMISSIONS, PermissionCode } from '@hmc/shared';

@Controller('rbac')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RbacController {
  constructor(private rbacService: RbacService) {}

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLE_VIEW)
  async getPermissions() {
    return this.rbacService.getAllPermissions();
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLE_VIEW)
  async getRoles() {
    return this.rbacService.getAllRoles();
  }

  @Get('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLE_VIEW)
  async getRoleById(@Param('id') id: string) {
    return this.rbacService.getRoleById(id);
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  async createRole(
    @Body() dto: { name: string; description?: string; permissionCodes: PermissionCode[] },
    @CurrentUser('username') username: string
  ) {
    return this.rbacService.createRole(dto, username);
  }

  @Put('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  async updateRole(
    @Param('id') id: string,
    @Body() dto: { name?: string; description?: string; permissionCodes?: PermissionCode[] },
    @CurrentUser('username') username: string
  ) {
    return this.rbacService.updateRole(id, dto, username);
  }
}
