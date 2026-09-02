import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { AuditService } from './audit.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS, AuditResult } from '@hmc/shared';

@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  async getAuditLogs(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('action') action?: string,
    @Query('actorUsername') actorUsername?: string,
    @Query('clientId') clientId?: string,
    @Query('result') result?: AuditResult,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    return this.auditService.getAuditLogs({
      startDate,
      endDate,
      action,
      actorUsername,
      clientId,
      result,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.AUDIT_EXPORT)
  async exportAuditLogs(
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('action') action?: string,
    @Query('clientId') clientId?: string
  ) {
    const { fileName, csvContent } = await this.auditService.exportAuditCsv({
      startDate,
      endDate,
      action,
      clientId,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.status(HttpStatus.OK).send(csvContent);
  }
}
