import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DesktopAgent,
  AutomationRun,
  AutomationRunStep,
  Client,
  ClientUserSnapshot,
  AutomationWorkflow,
  AutomationWorkflowVersion,
  AuditLog,
} from '@hmc/database';
import { AgentsService } from './agents.service.js';
import { AgentsController } from './agents.controller.js';
import { ClientDirectoryReconciliationService } from './client-directory-reconciliation.service.js';
import { ClientsModule } from '../clients/clients.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DesktopAgent,
      AutomationRun,
      AutomationRunStep,
      Client,
      ClientUserSnapshot,
      AutomationWorkflow,
      AutomationWorkflowVersion,
      AuditLog,
    ]),
    ClientsModule,
  ],
  providers: [AgentsService, ClientDirectoryReconciliationService],
  controllers: [AgentsController],
  exports: [AgentsService, ClientDirectoryReconciliationService],
})
export class AgentsModule {}
