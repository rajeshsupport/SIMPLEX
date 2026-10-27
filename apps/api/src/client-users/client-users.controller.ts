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
  ExcelUserImportExecutionSummary,
  ClaimEphemeralCredentialDto,
  AckEphemeralCredentialDto,
  MapExistingUserRolesDto,
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

  
  @Get('bill-counter-mappings')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
  async getBillCounterMappings(
    @Query('clientId') clientId: string
  ) {
    return this.clientUsersService.getBillCounterMappings(clientId);
  }

  @Get('stock-location-urls')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
  async getStockLocationUrls(
    @Query('clientId') clientId: string
  ) {
    return this.clientUsersService.getStockLocationUrls(clientId);
  }

  @Get('stock-location-mappings')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
  async getStockLocationMappings(
    @Query('clientId') clientId: string
  ) {
    return this.clientUsersService.getStockLocationMappings(clientId);
  }


  
  @Get('form-assembly')
  async getFormAssemblyForms(
    @Query('clientId') clientId: string,
    @Query('userId') userId?: string
  ) {
    return this.clientUsersService.getFormAssemblyForms(clientId, userId);
  }

  @Post('form-assembly/refresh')
  async refreshFormAssemblyMappings(
    @Body('clientId') clientId: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.fetchFormAssemblyMappingsRemote(clientId, user, targetBranch);
  }

  @Post(':id/update-form-assembly')
  async updateFormAssemblyMappings(
    @Param('id') id: string,
    @Body('clientId') clientId: string,
    @Body('formIds') formIds: string[],
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.updateFormAssemblyMappingsRemote(id, user, { clientId, formIds, targetBranch });
  }

  @Post(':id/open-form-assembly-session')
  async openFormAssemblySession(
    @Param('id') id: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.openFormAssemblySessionRemote(id, user, targetBranch);
  }

  @Get('document-types')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
  async getDocumentTypes(
    @Query('clientId') clientId: string
  ) {
    return this.clientUsersService.getDocumentTypes(clientId);
  }

  @Post('document-type-mappings/refresh')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_SYNC)
  @HttpCode(HttpStatus.OK)
  async refreshDocumentTypeMappings(
    @Query('clientId') clientId: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.fetchDocumentTypeMappingsRemote(clientId, user, targetBranch);
  }

  @Post('document-types/:docTypeId/update-mappings')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_EDIT)
  @HttpCode(HttpStatus.OK)
  async updateDocumentTypeMappings(
    @Param('docTypeId') docTypeId: string,
    @Query('clientId') clientId: string,
    @Body('selectedUsernames') selectedUsernames: string[],
    @Body('targetBranch') targetBranch: string | undefined,
    @Body('userDocGroup') userDocGroup: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.updateDocumentTypeMappingsRemote(
      clientId,
      docTypeId,
      selectedUsernames || [],
      user,
      targetBranch,
      userDocGroup
    );
  }

  @Post('open-document-type-session')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
  @HttpCode(HttpStatus.OK)
  async openDocumentTypeSession(
    @Query('clientId') clientId: string,
    @Body('docTypeId') docTypeId: string | undefined,
    @Body('username') username: string | undefined,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.openDocumentTypeSessionRemote(
      clientId,
      user,
      docTypeId,
      username,
      targetBranch
    );
  }

  @Post('stock-location-mappings/refresh')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_SYNC)
  @HttpCode(HttpStatus.OK)
  async refreshStockLocationMappings(
    @Query('clientId') clientId: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.fetchStockLocationMappingsRemote(clientId, user, targetBranch);
  }

  @Post('bill-counter-mappings/refresh')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_SYNC)
  @HttpCode(HttpStatus.OK)
  async refreshBillCounterMappings(
    @Query('clientId') clientId: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.fetchBillCounterMappingsRemote(clientId, user, targetBranch);
  }

  @Get('form-options')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_CREATE)
  async getFormOptions(
    @Query('clientId') clientId: string,
    @CurrentUser() user: JwtPayload,
    @Query('refresh') refresh?: string
  ) {
    return this.clientUsersService.getLiveFormOptions(clientId, user, refresh === 'true');
  }

  @Post('sync')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_SYNC)
  @RequireClientAccess()
  @HttpCode(HttpStatus.OK)
  async syncClientUsers(
    @Body('clientId') clientId: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.syncClientUsers(clientId, user, targetBranch);
  }

  @Post('sync-job')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_SYNC)
  @RequireClientAccess()
  @HttpCode(HttpStatus.ACCEPTED)
  async startSyncJob(
    @Body('clientId') clientId: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.startSyncJob(clientId, user, targetBranch);
  }

  @Get('sync-status/:jobId')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
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

  @Post('reconcile')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_CREATE)
  @HttpCode(HttpStatus.OK)
  async reconcileUser(
    @Body('clientId') clientId: string,
    @Body('username') username: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.reconcileCreatedUser(clientId, username, user);
  }

  @Post('claim-ephemeral-credential')
  @RequirePermissions(PERMISSIONS.CLIENT_USER_CREDENTIAL_VIEW)
  @HttpCode(HttpStatus.OK)
  async claimEphemeralCredential(
    @Body() dto: ClaimEphemeralCredentialDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.claimEphemeralCredential(dto, user);
  }

  @Post('ack-ephemeral-credential')
  @HttpCode(HttpStatus.OK)
  async ackEphemeralCredential(
    @Body() dto: AckEphemeralCredentialDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.ackEphemeralCredential(dto, dto.status, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_CREATE)
  async createClientUser(
    @Body() dto: CreateClientUserDto,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.clientUsersService.createClientUser(dto, user);
    if (result && typeof result === 'object' && 'operationStatus' in result && (result as any).operationStatus === 'AUTOMATION_IN_PROGRESS') {
      res.status(HttpStatus.ACCEPTED);
    } else {
      res.status(HttpStatus.CREATED);
    }
    return result;
  }

  @Get('creation-status/:runId')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
  async getCreationRunStatus(
    @Param('runId') runId: string,
    @Query('clientId') clientId: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.getCreationRunStatus(runId, user, clientId);
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
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.setUserStatus(id, status, user, targetBranch);
  }

  
  @Post(':id/map-bill-counter')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_EDIT)
  @HttpCode(HttpStatus.OK)
  async mapBillCounterUser(
    @Param('id') id: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @Body('roleName') roleName: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.mapBillCounterUser(id, user, targetBranch, roleName);
  }

  @Post(':id/map-stock-location')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_EDIT)
  @HttpCode(HttpStatus.OK)
  async mapStockLocationUser(
    @Param('id') id: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @Body('stockLocationNames') stockLocationNames: string[] | undefined,
    @Body('stockLocationIds') stockLocationIds: string[] | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.mapStockLocationUserRemote(id, user, { targetBranch, stockLocationNames, stockLocationIds });
  }

  @Post(':id/open-stock-location-session')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
  @HttpCode(HttpStatus.OK)
  async openStockLocationSession(
    @Param('id') id: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.openStockLocationSessionRemote(id, user, targetBranch);
  }

  @Post(':id/reset-password')
  @RequirePermissions(PERMISSIONS.CLIENT_USER_PASSWORD_RESET)
  @HttpCode(HttpStatus.OK)
  async resetUserPassword(
    @Param('id') id: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.resetUserPassword(id, user, targetBranch);
  }

  @Post('map-roles')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_EDIT)
  @HttpCode(HttpStatus.OK)
  async mapUserRoles(
    @Body() dto: { clientId: string; username: string; roles: string[]; fullName?: string; firstName?: string; remoteUserId?: string; allowDeactivation?: boolean; targetBranch?: string },
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.mapUserRoles(dto, user);
  }

  @Post(':id/roles')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_EDIT)
  @HttpCode(HttpStatus.OK)
  async mapExistingUserRoles(
    @Param('id') id: string,
    @Body() dto: MapExistingUserRolesDto,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.mapExistingUserRoles(id, dto, user);
  }

  @Get(':id/roles')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_VIEW)
  async getUserRoles(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.getUserRoles(id, user);
  }

  @Post(':id/roles/refresh')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_SYNC)
  @HttpCode(HttpStatus.OK)
  async refreshUserRoles(
    @Param('id') id: string,
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.refreshUserRolesRemote(id, user, targetBranch);
  }

  @Get('export-excel')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_EXPORT)
  async exportExcel(
    @Query('clientId') clientId: string,
    @Query('mode') mode: 'ALL_USERS' | 'ACTIVE_ONLY' = 'ALL_USERS',
    @CurrentUser() user: JwtPayload,
    @Res() res: Response
  ) {
    const { buffer, filename } = await this.clientUsersService.exportExcel(clientId, mode, user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('import-template')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_IMPORT)
  async getImportTemplate(
    @Query('clientId') clientId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response
  ) {
    const { buffer, filename } = await this.clientUsersService.getImportTemplate(clientId, user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
    @Body('targetBranch') targetBranch: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientUsersService.importExecute(clientId, rows, user, targetBranch);
  }

  @Post('export-import-results')
  @RequirePermissions(PERMISSIONS.CLIENT_USERS_EXPORT)
  async exportImportResults(
    @Body('clientId') clientId: string,
    @Body('summary') summary: ExcelUserImportExecutionSummary,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response
  ) {
    const buffer = await this.clientUsersService.exportImportResults(clientId, summary, user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="user_import_results_${Date.now()}.xlsx"`);
    res.send(buffer);
  }
}
