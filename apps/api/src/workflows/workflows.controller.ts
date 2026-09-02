import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { WorkflowsService } from './workflows.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../common/decorators/user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CreateWorkflowSchema, CreateWorkflowDto, PERMISSIONS } from '@hmc/shared';

@Controller('workflows')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkflowsController {
  constructor(private workflowsService: WorkflowsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WORKFLOW_VIEW)
  async getAllWorkflows() {
    return this.workflowsService.getAllWorkflows();
  }

  @Get(':code')
  @RequirePermissions(PERMISSIONS.WORKFLOW_VIEW)
  async getWorkflowByCode(@Param('code') code: string) {
    return this.workflowsService.getWorkflowByCode(code);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WORKFLOW_MANAGE)
  async createWorkflow(
    @Body(new ZodValidationPipe(CreateWorkflowSchema)) dto: CreateWorkflowDto,
    @CurrentUser('username') username: string
  ) {
    return this.workflowsService.createWorkflow(dto, username);
  }
}
