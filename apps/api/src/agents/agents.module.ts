import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DesktopAgent,
  AutomationRun,
  AutomationRunStep,
  Client,
  AutomationWorkflow,
  AutomationWorkflowVersion,
} from '@hmc/database';
import { AgentsService } from './agents.service.js';
import { AgentsController } from './agents.controller.js';
import { ClientsModule } from '../clients/clients.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DesktopAgent,
      AutomationRun,
      AutomationRunStep,
      Client,
      AutomationWorkflow,
      AutomationWorkflowVersion,
    ]),
    ClientsModule,
  ],
  providers: [AgentsService],
  controllers: [AgentsController],
  exports: [AgentsService],
})
export class AgentsModule {}
