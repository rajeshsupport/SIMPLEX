import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import {
  DesktopAgent,
  AutomationRun,
  AutomationRunStep,
  Client,
  AutomationWorkflow,
  AutomationWorkflowVersion,
} from '@hmc/database';
import {
  DesktopAgentSummary,
  AgentHeartbeatPayload,
  AgentTaskAssignment,
  AutomationRunStepTelemetry,
} from '@hmc/shared';
import { ClientsService } from '../clients/clients.service.js';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @InjectRepository(DesktopAgent)
    private agentRepo: Repository<DesktopAgent>,
    @InjectRepository(AutomationRun)
    private runRepo: Repository<AutomationRun>,
    @InjectRepository(AutomationRunStep)
    private stepRepo: Repository<AutomationRunStep>,
    @InjectRepository(Client)
    private clientRepo: Repository<Client>,
    @InjectRepository(AutomationWorkflow)
    private workflowRepo: Repository<AutomationWorkflow>,
    @InjectRepository(AutomationWorkflowVersion)
    private versionRepo: Repository<AutomationWorkflowVersion>,
    private clientsService: ClientsService
  ) {}

  async getAllAgents(): Promise<DesktopAgentSummary[]> {
    const agents = await this.agentRepo.find({
      relations: ['assignedUser'],
      order: { lastHeartbeatAt: 'DESC' },
    });

    const now = Date.now();
    return agents.map((a) => {
      // Mark as OFFLINE if heartbeat is older than 30s
      const isStale = !a.lastHeartbeatAt || now - new Date(a.lastHeartbeatAt).getTime() > 30000;
      const status = isStale ? 'OFFLINE' : a.status;

      return {
        id: a.id,
        agentName: a.agentName,
        machineHostname: a.machineHostname,
        osInfo: a.osInfo,
        assignedUserId: a.assignedUserId,
        assignedUsername: a.assignedUser?.username,
        status,
        currentTaskDescription: a.currentTaskDescription || undefined,
        lastHeartbeatAt: a.lastHeartbeatAt ? a.lastHeartbeatAt.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      };
    });
  }

  async registerOrPairAgent(dto: {
    agentName: string;
    machineHostname: string;
    osInfo: string;
    userId: string;
    sharedSecret: string;
  }): Promise<{ agentId: string; token: string }> {
    const expectedSecret = process.env.AGENT_SHARED_SECRET || 'hmc_agent_shared_secret_pair_key_2026';
    if (dto.sharedSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid agent registration shared secret');
    }

    const rawToken = `agt_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const authTokenHash = await argon2.hash(rawToken);

    let agent = await this.agentRepo.findOne({ where: { agentName: dto.agentName } });
    if (!agent) {
      agent = this.agentRepo.create({
        agentName: dto.agentName,
        machineHostname: dto.machineHostname,
        osInfo: dto.osInfo,
        assignedUserId: dto.userId,
        authTokenHash,
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
      });
    } else {
      agent.machineHostname = dto.machineHostname;
      agent.osInfo = dto.osInfo;
      agent.assignedUserId = dto.userId;
      agent.authTokenHash = authTokenHash;
      agent.status = 'ONLINE';
      agent.lastHeartbeatAt = new Date();
    }

    const saved = await this.agentRepo.save(agent);
    return { agentId: saved.id, token: rawToken };
  }

  async recordHeartbeat(dto: AgentHeartbeatPayload): Promise<{ acknowledged: boolean; pendingRun?: AgentTaskAssignment }> {
    const agent = await this.agentRepo.findOne({ where: { id: dto.agentId } });
    if (!agent) throw new NotFoundException('Agent not found');

    agent.machineHostname = dto.machineHostname;
    agent.osInfo = dto.osInfo;
    agent.status = dto.status;
    agent.lastHeartbeatAt = new Date();
    if (dto.systemMetrics) {
      agent.systemMetricsJson = JSON.stringify(dto.systemMetrics);
    }
    await this.agentRepo.save(agent);

    // Check for pending automation run assigned to this agent or user
    const pendingRun = await this.runRepo.findOne({
      where: { desktopAgentId: agent.id, status: 'PENDING' },
      relations: ['client'],
    });

    if (pendingRun) {
      const task = await this.buildTaskAssignment(pendingRun);
      pendingRun.status = 'RUNNING';
      pendingRun.startedAt = new Date();
      await this.runRepo.save(pendingRun);
      return { acknowledged: true, pendingRun: task };
    }

    return { acknowledged: true };
  }

  async dispatchOpenAndLogin(clientId: string, userId: string, agentId?: string): Promise<AutomationRun> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');

    // Find agent if not explicitly passed
    let targetAgentId = agentId;
    if (!targetAgentId) {
      const activeAgent = await this.agentRepo.findOne({
        where: { assignedUserId: userId, status: 'ONLINE' },
      });
      if (activeAgent) {
        targetAgentId = activeAgent.id;
      }
    }

    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: targetAgentId || null,
      triggeredByUserId: userId,
      runType: 'INTERACTIVE_LOGIN',
      status: 'PENDING',
      parametersJson: JSON.stringify({ isHeaded: true, leaveBrowserOpen: true }),
    });

    return this.runRepo.save(run);
  }

  async updateRunTelemetry(
    runId: string,
    dto: {
      status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REQUIRES_MANUAL_INTERVENTION';
      errorMessage?: string;
      step?: AutomationRunStepTelemetry;
      totalDurationMs?: number;
    }
  ): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) return;

    if (dto.status) run.status = dto.status;
    if (dto.errorMessage) run.errorMessage = dto.errorMessage;
    if (dto.totalDurationMs) run.totalDurationMs = dto.totalDurationMs;
    if (dto.status === 'COMPLETED' || dto.status === 'FAILED' || dto.status === 'REQUIRES_MANUAL_INTERVENTION') {
      run.completedAt = new Date();
    }
    await this.runRepo.save(run);

    if (dto.step) {
      const step = this.stepRepo.create({
        automationRunId: run.id,
        stepIndex: dto.step.stepIndex,
        stepName: dto.step.stepName,
        status: dto.step.status,
        startedAt: dto.step.startedAt ? new Date(dto.step.startedAt) : new Date(),
        completedAt: dto.step.completedAt ? new Date(dto.step.completedAt) : undefined,
        durationMs: dto.step.durationMs,
        errorMessage: dto.step.errorMessage,
      });
      await this.stepRepo.save(step);
    }
  }

  async getRecentRuns(limit: number = 20): Promise<AutomationRun[]> {
    return this.runRepo.find({
      relations: ['client', 'steps', 'desktopAgent'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  private async buildTaskAssignment(run: AutomationRun): Promise<AgentTaskAssignment> {
    const client = run.client;
    const creds = await this.clientsService.getDecryptedCredentials(client.id);

    const workflow = await this.workflowRepo.findOne({
      where: { workflowCode: 'HMC_LOGIN' },
      relations: ['versions'],
    });

    const activeVersion = workflow?.versions?.find((v) => v.isActive) || workflow?.versions?.[0];

    const versionConfig = activeVersion ? {
      versionNumber: activeVersion.versionNumber,
      applicableAppVersion: activeVersion.applicableAppVersion,
      pageRoute: activeVersion.pageRoute,
      steps: JSON.parse(activeVersion.stepsJson || '[]'),
      successConditions: JSON.parse(activeVersion.successConditionsJson || '[]'),
      errorConditions: JSON.parse(activeVersion.errorConditionsJson || '[]'),
      securityBlockConditions: JSON.parse(activeVersion.securityBlockConditionsJson || '[]'),
      defaultTimeoutMs: activeVersion.defaultTimeoutMs,
      maxRetries: activeVersion.maxRetries,
    } : {
      versionNumber: 1,
      applicableAppVersion: 'v1.0',
      pageRoute: client.loginRoute,
      steps: [],
      successConditions: [],
      errorConditions: [],
      securityBlockConditions: [],
      defaultTimeoutMs: 30000,
      maxRetries: 1,
    };

    return {
      runId: run.id,
      taskType: run.runType,
      clientId: client.id,
      clientBaseUrl: client.baseUrl,
      clientAppPath: client.applicationPath,
      loginRoute: client.loginRoute,
      workflowVersion: versionConfig,
      payload: run.parametersJson ? JSON.parse(run.parametersJson) : {},
      credentials: {
        username: creds.username,
        password: creds.password,
      },
      options: {
        isHeaded: true,
        leaveBrowserOpen: true,
      },
    };
  }
}
