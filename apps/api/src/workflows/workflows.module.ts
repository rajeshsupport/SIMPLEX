import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationWorkflow, AutomationWorkflowVersion } from '@hmc/database';
import { WorkflowsService } from './workflows.service.js';
import { WorkflowsController } from './workflows.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([AutomationWorkflow, AutomationWorkflowVersion])],
  providers: [WorkflowsService],
  controllers: [WorkflowsController],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
