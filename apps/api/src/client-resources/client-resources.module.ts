import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Client,
  ClientResourceSnapshot,
  ClientCredential,
  AutomationRun,
  AuditLog,
  ResourceImportJob,
  ResourceImportRow,
  ClientResourceDepartment,
  ClientResourceService,
} from '@hmc/database';
import { ClientResourcesController } from './client-resources.controller.js';
import { ClientResourcesService } from './client-resources.service.js';
import { AgentsModule } from '../agents/agents.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Client,
      ClientResourceSnapshot,
      ClientCredential,
      AutomationRun,
      AuditLog,
      ResourceImportJob,
      ResourceImportRow,
      ClientResourceDepartment,
      ClientResourceService,
    ]),
    AgentsModule,
  ],
  controllers: [ClientResourcesController],
  providers: [ClientResourcesService],
  exports: [ClientResourcesService],
})
export class ClientResourcesModule {}
