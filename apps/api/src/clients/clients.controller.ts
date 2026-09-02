import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ClientsService } from './clients.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { ClientAccessGuard } from '../common/guards/client-access.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { RequireClientAccess } from '../common/decorators/require-client.decorator.js';
import { CurrentUser } from '../common/decorators/user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  CreateClientSchema,
  CreateClientDto,
  UpdateClientSchema,
  UpdateClientDto,
  SaveClientCredentialsSchema,
  SaveClientCredentialsDto,
  JwtPayload,
  PERMISSIONS,
} from '@hmc/shared';

@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard, ClientAccessGuard)
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CLIENT_VIEW)
  async getAllClients(@CurrentUser() user: JwtPayload) {
    return this.clientsService.getAllClients(user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CLIENT_VIEW)
  @RequireClientAccess('id')
  async getClientById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clientsService.getClientById(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CLIENT_CREATE)
  async createClient(
    @Body(new ZodValidationPipe(CreateClientSchema)) dto: CreateClientDto,
    @CurrentUser('username') username: string
  ) {
    return this.clientsService.createClient(dto, username);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.CLIENT_UPDATE)
  @RequireClientAccess('id')
  async updateClient(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateClientSchema)) dto: UpdateClientDto,
    @CurrentUser('username') username: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientsService.updateClient(id, dto, username, user);
  }

  @Post(':id/credentials')
  @RequirePermissions(PERMISSIONS.CREDENTIAL_MANAGE)
  @RequireClientAccess('id')
  @HttpCode(HttpStatus.OK)
  async saveClientCredentials(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SaveClientCredentialsSchema)) dto: SaveClientCredentialsDto,
    @CurrentUser('username') username: string
  ) {
    dto.clientId = id;
    return this.clientsService.saveClientCredentials(dto, username);
  }

  @Post(':id/test-connection')
  @RequirePermissions(PERMISSIONS.CLIENT_TEST_LOGIN)
  @RequireClientAccess('id')
  @HttpCode(HttpStatus.OK)
  async testConnection(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload
  ) {
    return this.clientsService.testConnection(id, user);
  }
}
