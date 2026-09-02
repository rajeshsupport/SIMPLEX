import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ImportsService } from './imports.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { ClientAccessGuard } from '../common/guards/client-access.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { RequireClientAccess } from '../common/decorators/require-client.decorator.js';
import { CurrentUser } from '../common/decorators/user.decorator.js';
import { PERMISSIONS, ImportJobType } from '@hmc/shared';

@Controller('imports')
@UseGuards(JwtAuthGuard, PermissionsGuard, ClientAccessGuard)
export class ImportsController {
  constructor(private importsService: ImportsService) {}

  @Post('preview')
  @RequirePermissions(PERMISSIONS.IMPORT_PREVIEW)
  @UseInterceptors(FileInterceptor('file'))
  async previewImport(
    @UploadedFile() file: Express.Multer.File,
    @Body('jobType') jobType: ImportJobType,
    @Body('customMappings') customMappingsJson?: string
  ) {
    if (!file) throw new BadRequestException('No spreadsheet file uploaded');
    const customMappings = customMappingsJson ? JSON.parse(customMappingsJson) : undefined;
    return this.importsService.previewSpreadsheet(
      file.buffer,
      file.originalname,
      file.size,
      jobType || 'SERVICE_MASTER',
      customMappings
    );
  }

  @Post('jobs')
  @RequirePermissions(PERMISSIONS.IMPORT_EXECUTE)
  @RequireClientAccess('clientId')
  @UseInterceptors(FileInterceptor('file'))
  async createJob(
    @UploadedFile() file: Express.Multer.File,
    @Body('clientId') clientId: string,
    @Body('jobType') jobType: ImportJobType,
    @Body('oneRecordTestMode') oneRecordTestMode?: string,
    @Body('typedConfirmation') typedConfirmation?: string,
    @Body('columnMappings') columnMappingsJson?: string,
    @CurrentUser('username') username?: string
  ) {
    if (!file) throw new BadRequestException('No spreadsheet file uploaded');
    if (!clientId) throw new BadRequestException('Client ID is required');

    const columnMappings = columnMappingsJson ? JSON.parse(columnMappingsJson) : undefined;

    return this.importsService.createImportJob(
      {
        clientId,
        jobType: jobType || 'SERVICE_MASTER',
        oneRecordTestMode: oneRecordTestMode === 'true',
        typedConfirmation,
        columnMappings,
      },
      file.buffer,
      file.originalname,
      username || 'operator'
    );
  }

  @Get('jobs')
  @RequirePermissions(PERMISSIONS.IMPORT_PREVIEW)
  async getJobs(@Query('clientId') clientId?: string) {
    return this.importsService.getImportJobs(clientId);
  }

  @Get('jobs/:id')
  @RequirePermissions(PERMISSIONS.IMPORT_PREVIEW)
  async getJobById(@Param('id') id: string) {
    return this.importsService.getImportJobById(id);
  }

  @Post('jobs/:id/pause')
  @RequirePermissions(PERMISSIONS.IMPORT_PAUSE)
  async pauseJob(@Param('id') id: string, @CurrentUser('username') username: string) {
    return this.importsService.pauseImportJob(id, username);
  }

  @Post('jobs/:id/resume')
  @RequirePermissions(PERMISSIONS.IMPORT_RESUME)
  async resumeJob(@Param('id') id: string, @CurrentUser('username') username: string) {
    return this.importsService.resumeImportJob(id, username);
  }

  @Post('jobs/:id/retry')
  @RequirePermissions(PERMISSIONS.IMPORT_RETRY_FAILED)
  async retryFailed(@Param('id') id: string, @CurrentUser('username') username: string) {
    return this.importsService.retryFailedRows(id, username);
  }

  @Post('jobs/:id/cancel')
  @RequirePermissions(PERMISSIONS.IMPORT_CANCEL)
  async cancelJob(@Param('id') id: string, @CurrentUser('username') username: string) {
    return this.importsService.cancelImportJob(id, username);
  }

  @Get('jobs/:id/export-errors')
  @RequirePermissions(PERMISSIONS.IMPORT_EXPORT_ERRORS)
  async exportErrors(@Param('id') id: string, @Res() res: Response) {
    const { fileName, csvContent } = await this.importsService.exportErrorsCsv(id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.status(HttpStatus.OK).send(csvContent);
  }
}
