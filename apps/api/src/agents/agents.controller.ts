import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AgentsService } from './agents.service.js';
import { ClientDirectoryReconciliationService } from './client-directory-reconciliation.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../common/decorators/user.decorator.js';
import {
  PERMISSIONS,
  AgentHeartbeatPayload,
  AutomationRunStepTelemetry,
  SyncUserBatchDto,
} from '@hmc/shared';

@SkipThrottle()
@Controller('agents')
export class AgentsController {
  constructor(
    private agentsService: AgentsService,
    private reconciliationService: ClientDirectoryReconciliationService
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  async getAllAgents() {
    return this.agentsService.getAllAgents();
  }

  @Get('runs')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  async getRecentRuns() {
    return this.agentsService.getRecentRuns();
  }

  @Get('runs/:runId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CLIENT_OPEN)
  async getRunById(@Param('runId') runId: string) {
    return this.agentsService.getRunById(runId);
  }

  @Post('runs/:runId/cancel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CLIENT_OPEN)
  @HttpCode(HttpStatus.OK)
  async cancelRun(@Param('runId') runId: string) {
    return this.agentsService.cancelRun(runId);
  }

  @Post('pair')
  @HttpCode(HttpStatus.OK)
  async pairAgent(
    @Body() dto: {
      agentName: string;
      machineHostname: string;
      osInfo: string;
      userId: string;
      sharedSecret: string;
    }
  ) {
    return this.agentsService.registerOrPairAgent(dto);
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(@Body() dto: AgentHeartbeatPayload) {
    return this.agentsService.recordHeartbeat(dto);
  }

  @Post('runs/:runId/telemetry')
  @HttpCode(HttpStatus.OK)
  async updateTelemetry(
    @Param('runId') runId: string,
    @Body() dto: {
      status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REQUIRES_MANUAL_INTERVENTION';
      errorMessage?: string;
      step?: AutomationRunStepTelemetry;
      totalDurationMs?: number;
    }
  ) {
    await this.agentsService.updateRunTelemetry(runId, dto);
    return { success: true };
  }

  @Post('runs/:runId/client-users/sync-batches')
  @HttpCode(HttpStatus.OK)
  async ingestClientUsersSyncBatches(
    @Param('runId') runId: string,
    @Headers('x-agent-id') agentId: string,
    @Headers('x-agent-token') agentToken: string,
    @Body() dto: SyncUserBatchDto
  ) {
    dto.runId = runId;
    return this.reconciliationService.ingestSyncBatch(runId, dto, { agentId, agentToken });
  }

  @Post('dispatch-open-and-login')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CLIENT_OPEN)
  async dispatchOpenAndLogin(
    @Body('clientId') clientId: string,
    @Body('agentId') agentId: string,
    @CurrentUser('sub') userId: string
  ) {
    return this.agentsService.dispatchOpenAndLogin(clientId, userId, agentId);
  }
}
