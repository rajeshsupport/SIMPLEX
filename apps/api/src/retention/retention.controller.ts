import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { RetentionService } from './retention.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@hmc/shared';

@Controller('retention')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RetentionController {
  constructor(private retentionService: RetentionService) {}

  @Get('policies')
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  async getAllPolicies() {
    return this.retentionService.getAllPolicies();
  }

  @Put('policies/:id')
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  async updatePolicy(
    @Param('id') id: string,
    @Body() dto: { retentionDays: number; isArchiveEnabled: boolean; archiveDestination?: string }
  ) {
    return this.retentionService.updatePolicy(id, dto);
  }

  @Post('purge')
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  async executePurge() {
    return this.retentionService.executeRetentionPurge();
  }
}
