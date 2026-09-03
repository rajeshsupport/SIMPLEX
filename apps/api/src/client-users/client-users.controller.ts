import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ClientUsersService } from './client-users.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { ClientAccessGuard } from '../common/guards/client-access.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { RequireClientAccess } from '../common/decorators/require-client.decorator.js';
import { CurrentUser } from '../common/decorators/user.decorator.js';
import { SkipThrottle } from '@nestjs/throttler';
import {
  PERMISSIONS,
  JwtPayload,
  CreateClientUserDto,
  UpdateClientUserDto,
  ClientUserStatus,
  ExcelUserImportRow,
} from '@hmc/shared';

@SkipThrottle()
@Controller('client-users')
@UseGuards(JwtAuthGuard, PermissionsGuard, ClientAccessGuard)
export class ClientUsersController {
  constructor(private clientUsersService: ClientUsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
  async getClientUsers(
    @Query('clientId') clientId: string,
    @Query('search') search: string,
    @Query('status') status: string,
    @Query('role') role: string,
    @Query('page') page: number,
    @Query('limit') limit: number,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.getClientUsers(
      clientId,
      { search, status, role, page, limit },
      user
    );
  }

  @Get('form-options')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
  async getFormOptions(
    @Query('clientId') clientId: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.getLiveFormOptions(clientId, user);
  }

  @Post('sync')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_SYNC)
  @HttpCode(HttpStatus.OK)
  async syncClientUsers(
    @Body('clientId') clientId: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.syncClientUsers(clientId, user);
  }

  @Post('sync-job')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_SYNC)
  @HttpCode(HttpStatus.OK)
  async startSyncJob(
    @Body('clientId') clientId: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.startSyncJob(clientId, user);
  }

  @Get('sync-status/:jobId')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_SYNC)
  async getSyncJobStatus(
    @Param('jobId') jobId: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.getSyncJobStatus(jobId, user);
  }

  @Post('sync-job/:jobId/cancel')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_SYNC)
  @HttpCode(HttpStatus.OK)
  async cancelSyncJob(
    @Param('jobId') jobId: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.cancelSyncJob(jobId, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_CREATE)
  async createClientUser(
    @Body() dto: CreateClientUserDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.createClientUser(dto, user);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_EDIT)
  async updateClientUser(
    @Param('id') id: string,
    @Body() dto: UpdateClientUserDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.updateClientUser(id, dto, user);
  }

  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_STATUS_CHANGE)
  @HttpCode(HttpStatus.OK)
  async setUserStatus(
    @Param('id') id: string,
    @Body('status') status: ClientUserStatus,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.setUserStatus(id, status, user);
  }

  @Post(':id/reset-password')
  @RequirePermissions(PERMISSIONS.CLIENT_USER_PASSWORD_RESET)
  @HttpCode(HttpStatus.OK)
  async resetUserPassword(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.resetUserPassword(id, user);
  }

  @Get('export-excel')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_EXPORT)
  async exportExcel(
    @Query('clientId') clientId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response
  ) {
    const buffer = await this.clientUsersService.exportExcel(clientId, user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="client_users_export_${Date.now()}.xlsx"`);
    res.send(buffer);
  }

  @Get('import-template')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_IMPORT)
  async getImportTemplate(@Res() res: Response) {
    const buffer = this.clientUsersService.getImportTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="hmc_user_import_template.xlsx"');
    res.send(buffer);
  }

  @Post('import-preview')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_IMPORT)
  @UseInterceptors(FileInterceptor('file'))
  async importPreview(
    @Body('clientId') clientId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.importPreview(clientId, file.buffer, user);
  }

  @Post('import-execute')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_IMPORT)
  async importExecute(
    @Body('clientId') clientId: string,
    @Body('rows') rows: ExcelUserImportRow[],
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.importExecute(clientId, rows, user);
  }
}
