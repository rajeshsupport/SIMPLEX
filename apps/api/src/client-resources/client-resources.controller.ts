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
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ClientResourcesService } from './client-resources.service.js';
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
  CreateClientResourceDto,
  CreateClientResourceSchema,
  SetClientResourceStatusDto,
  SetClientResourceStatusSchema,
  MapResourceUserDto,
  MapResourceUserSchema,
  ClientResourceStatus,
} from '@hmc/shared';

@SkipThrottle()
@Controller('client-resources')
@UseGuards(JwtAuthGuard, PermissionsGuard, ClientAccessGuard)
export class ClientResourcesController {
  constructor(private clientResourcesService: ClientResourcesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getClientResources(
    @Query('clientId') clientId: string,
    @Query('search') search: string,
    @Query('isResourceHuman') isResourceHuman: string,
    @Query('status') status: ClientResourceStatus | 'ALL',
    @Query('specialty') specialty: string,
    @Query('resourceType') resourceType: string,
    @Query('page') page: number,
    @Query('limit') limit: number,
    @CurrentUser() user: JwtPayload
  ) {
    if (!clientId) {
      throw new BadRequestException('Query parameter "clientId" is required');
    }
    return this.clientResourcesService.getClientResources(
      clientId,
      {
        search,
        isResourceHuman: isResourceHuman === 'true' ? true : isResourceHuman === 'false' ? false : 'ALL',
        status,
        specialty,
        resourceType,
        page,
        limit,
      },
      user
    );
  }

  @Get('template')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getTemplate(
    @Query('clientId') clientId: string,
    @Query('clientCode') clientCode: string,
    @Query('format') format: '1-SHEET' | '6-SHEET' | '10-SHEET',
    @Res() res: Response
  ) {
    const activeFormat = format || '1-SHEET';
    const buffer = await this.clientResourcesService.generateImportTemplate(clientId, clientCode, activeFormat);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const filenameSuffix = activeFormat === '6-SHEET' ? 'Integrated_6Sheet' : activeFormat === '1-SHEET' ? 'Master_1Sheet_StepWise' : 'Template';
    res.setHeader('Content-Disposition', `attachment; filename=HMC_Client_Resources_${filenameSuffix}.xlsx`);
    res.send(buffer);
  }


  @Get('export')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_EXPORT)
  async exportResources(
    @Query('clientId') clientId: string,
    @Query('mode') mode: 'ALL' | 'ACTIVE_ONLY' | 'INACTIVE_ONLY',
    @CurrentUser() user: JwtPayload,
    @Res() res: Response
  ) {
    if (!clientId) {
      throw new BadRequestException('Query parameter "clientId" is required');
    }
    const buffer = await this.clientResourcesService.exportResourcesWorkbook(clientId, mode || 'ALL', user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=HMC_Resources_${(mode || 'ALL').toLowerCase()}.xlsx`);
    res.send(buffer);
  }

  @Get('emr-forms')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getEmrForms(
    @Query('clientId') clientId: string,
    @Query('username') username: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    if (!clientId) {
      throw new BadRequestException('Query parameter "clientId" is required');
    }
    return this.clientResourcesService.getEmrForms(clientId, user, username);
  }

  @Get('eclaim-options')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getEclaimOptions(
    @Query('clientId') clientId: string,
    @CurrentUser() user: JwtPayload
  ) {
    if (!clientId) {
      throw new BadRequestException('Query parameter "clientId" is required');
    }
    return this.clientResourcesService.getEclaimOptions(clientId, user);
  }

  @Get('resource-types')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getResourceTypes(
    @Query('clientId') clientId: string,
    @Query('isResourceHuman') isResourceHuman: string | undefined,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientResourcesService.getResourceTypes(clientId, isResourceHuman, user);
  }

  @Get('specialties')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getSpecialties(@Query('clientId') clientId: string, @CurrentUser() user: JwtPayload) {
    return this.clientResourcesService.getSpecialties(clientId, user);
  }

  @Get('departments')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getDepartments(@Query('clientId') clientId: string, @CurrentUser() user: JwtPayload) {
    return this.clientResourcesService.getDepartments(clientId, user);
  }

  @Get('services')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getServices(@Query('clientId') clientId: string, @CurrentUser() user: JwtPayload) {
    return this.clientResourcesService.getServices(clientId, user);
  }

  @Post('import-preview')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_IMPORT)
  @RequireClientAccess()
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  async importPreview(
    @Body('clientId') clientId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload
  ) {
    if (!clientId) {
      throw new BadRequestException('Form field "clientId" is required');
    }
    if (!file || !file.buffer) {
      throw new BadRequestException('Spreadsheet file is required');
    }
    return this.clientResourcesService.importPreview(clientId, file.buffer, file.originalname, user);
  }

  @Post('import-execute')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_IMPORT)
  @HttpCode(HttpStatus.OK)
  async importExecute(
    @Body('jobId') jobId: string,
    @CurrentUser() user: JwtPayload
  ) {
    if (!jobId) {
      throw new BadRequestException('Body field "jobId" is required');
    }
    return this.clientResourcesService.importExecute(jobId, user);
  }

  @Get('import-jobs/:jobId')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getImportJob(@Param('jobId') jobId: string, @CurrentUser() user: JwtPayload) {
    return this.clientResourcesService.getImportJob(jobId, user);
  }

  @Post('import-jobs/:jobId/retry')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_IMPORT)
  @HttpCode(HttpStatus.OK)
  async retryImportJob(@Param('jobId') jobId: string, @CurrentUser() user: JwtPayload) {
    return this.clientResourcesService.retryImportJob(jobId, user);
  }

  @Get('import-jobs/:jobId/export-results')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_EXPORT)
  async exportJobResults(
    @Param('jobId') jobId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response
  ) {
    const buffer = await this.clientResourcesService.exportJobResults(jobId, user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=HMC_Resource_Import_Results_${jobId.slice(0, 8)}.xlsx`);
    res.send(buffer);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getClientResourceById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clientResourcesService.getClientResourceById(id, user);
  }

  @Post('sync')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_SYNC)
  @RequireClientAccess()
  @HttpCode(HttpStatus.OK)
  async syncClientResources(
    @Body('clientId') clientId: string,
    @CurrentUser() user: JwtPayload
  ) {
    if (!clientId) {
      throw new BadRequestException('Body property "clientId" is required');
    }
    return this.clientResourcesService.syncClientResources(clientId, user);
  }

  @Post('create')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_CREATE)
  @RequireClientAccess()
  @HttpCode(HttpStatus.CREATED)
  async createClientResource(
    @Body() body: CreateClientResourceDto,
    @CurrentUser() user: JwtPayload
  ) {
    const parsed = CreateClientResourceSchema.parse(body);
    return this.clientResourcesService.createClientResource(parsed.clientId, parsed, user);
  }

  @Post('create-integrated')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_CREATE)
  @RequireClientAccess()
  async createIntegratedResource(
    @Body() body: any,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.clientResourcesService.createIntegratedResource(body.clientId, body, user);
    if (result.status === 'IN_PROGRESS' || result.isPending) {
      res.status(HttpStatus.ACCEPTED);
    } else {
      res.status(HttpStatus.CREATED);
    }
    return result;
  }

  @Post('resume-integrated')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_CREATE)
  @RequireClientAccess()
  async resumeIntegratedProvisioning(
    @Body() body: any,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.clientResourcesService.resumeIntegratedProvisioning(body.clientId, body, user);
    if ((result as any).status === 'IN_PROGRESS' || (result as any).isPending) {
      res.status(HttpStatus.ACCEPTED);
    } else {
      res.status(HttpStatus.OK);
    }
    return result;
  }

  @Get('runs/:runId/status')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_VIEW)
  async getProvisioningRunStatus(@Param('runId') runId: string) {
    return this.clientResourcesService.getProvisioningRunStatus(runId);
  }

  @Post('status')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCES_STATUS_CHANGE)
  @RequireClientAccess()
  @HttpCode(HttpStatus.OK)
  async setResourceStatus(
    @Body() body: SetClientResourceStatusDto,
    @CurrentUser() user: JwtPayload
  ) {
    const parsed = SetClientResourceStatusSchema.parse(body);
    return this.clientResourcesService.setResourceStatus(
      parsed.clientId,
      parsed.remoteResourceId,
      parsed.status,
      parsed.reason,
      user
    );
  }

  @Post('map-user')
  @RequirePermissions(PERMISSIONS.CLIENT_RESOURCE_USER_MAP)
  @RequireClientAccess()
  @HttpCode(HttpStatus.OK)
  async mapResourceUser(
    @Body() body: MapResourceUserDto,
    @CurrentUser() user: JwtPayload
  ) {
    const parsed = MapResourceUserSchema.parse(body);
    return this.clientResourcesService.mapResourceUser(
      parsed.clientId,
      parsed.remoteResourceId,
      parsed.username,
      user,
      parsed.resourceName
    );
  }
}
