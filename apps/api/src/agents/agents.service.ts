import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import {
  DesktopAgent,
  AutomationRun,
  AutomationRunStep,
  Client,
  AutomationWorkflow,
  AutomationWorkflowVersion,
  AuditLog,
  ApplicationUser,
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
    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,
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

    // Resolve valid user GUID if not provided as GUID
    let assignedUserId = dto.userId;
    const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignedUserId);
    if (!isGuid) {
      const userRepo = this.agentRepo.manager.getRepository(ApplicationUser);
      const user = await userRepo.findOne({ where: {} });
      if (user) assignedUserId = user.id;
    }

    let agent = await this.agentRepo.findOne({ where: { agentName: dto.agentName } });
    if (!agent) {
      agent = this.agentRepo.create({
        agentName: dto.agentName,
        machineHostname: dto.machineHostname,
        osInfo: dto.osInfo,
        assignedUserId,
        authTokenHash,
        status: 'ONLINE',
        lastHeartbeatAt: new Date(),
      });
    } else {
      agent.machineHostname = dto.machineHostname;
      agent.osInfo = dto.osInfo;
      agent.assignedUserId = assignedUserId;
      agent.authTokenHash = authTokenHash;
      agent.status = 'ONLINE';
      agent.lastHeartbeatAt = new Date();
    }

    const saved = await this.agentRepo.save(agent);
    return { agentId: saved.id, token: rawToken };
  }

  async recordHeartbeat(dto: AgentHeartbeatPayload): Promise<{ acknowledged: boolean; pendingRun?: AgentTaskAssignment }> {
    let agent = await this.agentRepo.findOne({ where: { id: dto.agentId } });
    if (!agent) {
      const userRepo = this.agentRepo.manager.getRepository(ApplicationUser);
      const user = await userRepo.findOne({ where: {} });
      const rawToken = `agt_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      const authTokenHash = await argon2.hash(rawToken);
      // Auto-register local agent if missing
      agent = this.agentRepo.create({
        id: dto.agentId,
        agentName: `Agent-${dto.machineHostname}`,
        machineHostname: dto.machineHostname,
        osInfo: dto.osInfo,
        assignedUserId: user ? user.id : '00000000-0000-0000-0000-000000000000',
        authTokenHash,
        status: dto.status,
        lastHeartbeatAt: new Date(),
      });
    } else {
      agent.machineHostname = dto.machineHostname;
      agent.osInfo = dto.osInfo;
      agent.status = dto.status;
      agent.lastHeartbeatAt = new Date();
      if (dto.systemMetrics) {
        agent.systemMetricsJson = JSON.stringify(dto.systemMetrics);
      }
    }
    await this.agentRepo.save(agent);

    // Check for pending automation run assigned to this agent or unassigned pending runs
    let pendingRun = await this.runRepo.findOne({
      where: { desktopAgentId: agent.id, status: 'PENDING' },
      relations: ['client'],
      order: { createdAt: 'ASC' },
    });

    if (!pendingRun) {
      pendingRun = await this.runRepo.findOne({
        where: { desktopAgentId: undefined, status: 'PENDING' },
        relations: ['client'],
        order: { createdAt: 'ASC' },
      });
    }

    if (pendingRun) {
      pendingRun.desktopAgentId = agent.id;
      const task = await this.buildTaskAssignment(pendingRun);
      pendingRun.status = 'RUNNING';
      pendingRun.startedAt = new Date();
      await this.runRepo.save(pendingRun);
      return { acknowledged: true, pendingRun: task };
    }

    return { acknowledged: true };
  }

  async dispatchOpenAndLogin(clientId: string, userId: string, agentId?: string): Promise<AutomationRun> {
    const client = await this.clientRepo.findOne({
      where: { id: clientId },
      relations: ['credential'],
    });
    if (!client) throw new NotFoundException('Client not found');

    if (!client.credential || !client.credential.isActive) {
      throw new BadRequestException('Saved login credentials are unavailable for this client. Edit the client and save valid credentials.');
    }

    try {
      await this.clientsService.getDecryptedCredentials(client.id);
    } catch (err: any) {
      throw new BadRequestException('Saved credentials could not be decrypted. Re-save the client credentials.');
    }

    // Check available online desktop agents
    const allAgents = await this.getAllAgents();
    const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE');
    if (onlineAgents.length === 0) {
      throw new BadRequestException('Desktop browser agent is not running.');
    }

    let targetAgentId = agentId;
    if (!targetAgentId) {
      targetAgentId = onlineAgents[0].id;
    }

    const correlationId = crypto.randomUUID();

    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: targetAgentId || null,
      triggeredByUserId: userId,
      runType: 'INTERACTIVE_LOGIN',
      status: 'PENDING',
      parametersJson: JSON.stringify({ isHeaded: true, leaveBrowserOpen: true, userId }),
    });

    const savedRun = await this.runRepo.save(run);

    // Record Security Audit Log
    const audit = this.auditRepo.create({
      action: 'CLIENT_BROWSER_SESSION_LAUNCH',
      actorUserId: userId,
      actorUsername: userId,
      entityType: 'CLIENT',
      entityId: client.id,
      result: 'SUCCESS',
      detailsJson: JSON.stringify({
        clientCode: client.clientCode,
        environment: client.environment,
        runId: savedRun.id,
        targetAgentId: targetAgentId || 'ANY_AVAILABLE',
        onlineAgentsCount: onlineAgents.length,
      }),
      correlationId,
    });
    await this.auditRepo.save(audit);

    return savedRun;
  }

  async getRunById(runId: string): Promise<AutomationRun> {
    const run = await this.runRepo.findOne({
      where: { id: runId },
      relations: ['client', 'steps', 'desktopAgent'],
    });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);

    if (run.steps) {
      run.steps.sort((a, b) => a.stepIndex - b.stepIndex);
    }
    return run;
  }

  async cancelRun(runId: string): Promise<AutomationRun> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);

    if (run.status === 'PENDING' || run.status === 'RUNNING') {
      run.status = 'FAILED';
      run.errorMessage = 'Launch cancelled by user.';
      run.completedAt = new Date();
      await this.runRepo.save(run);
    }
    return run;
  }

  async updateRunTelemetry(
    runId: string,
    dto: {
      status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REQUIRES_MANUAL_INTERVENTION';
      errorMessage?: string;
      step?: AutomationRunStepTelemetry;
      totalDurationMs?: number;
      resultData?: any;
    }
  ): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) return;

    if (dto.status) run.status = dto.status;
    if (dto.errorMessage) run.errorMessage = dto.errorMessage;
    if (dto.totalDurationMs) run.totalDurationMs = dto.totalDurationMs;
    if (dto.resultData !== undefined) run.resultSummaryJson = JSON.stringify(dto.resultData);
    if (dto.status === 'COMPLETED' || dto.status === 'FAILED' || dto.status === 'REQUIRES_MANUAL_INTERVENTION') {
      run.completedAt = new Date();
    }
    await this.runRepo.save(run);

    if (dto.step) {
      let step = await this.stepRepo.findOne({
        where: { automationRunId: run.id, stepIndex: dto.step.stepIndex },
      });

      if (!step) {
        step = this.stepRepo.create({
          automationRunId: run.id,
          stepIndex: dto.step.stepIndex,
          stepName: dto.step.stepName,
          status: dto.step.status,
          startedAt: dto.step.startedAt ? new Date(dto.step.startedAt) : new Date(),
          completedAt: dto.step.completedAt ? new Date(dto.step.completedAt) : undefined,
          durationMs: dto.step.durationMs,
          errorMessage: dto.step.errorMessage,
        });
      } else {
        step.status = dto.step.status;
        step.stepName = dto.step.stepName;
        if (dto.step.completedAt) step.completedAt = new Date(dto.step.completedAt);
        if (dto.step.durationMs) step.durationMs = dto.step.durationMs;
        if (dto.step.errorMessage) step.errorMessage = dto.step.errorMessage;
      }
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
      steps: [
        {
          stepIndex: 1,
          stepName: 'Opening client URL…',
          action: 'NAVIGATE' as const,
          valueTemplate: '{{loginUrl}}',
          timeoutMs: 15000,
        },
        {
          stepIndex: 2,
          stepName: 'Enter Username',
          action: 'FILL' as const,
          targetSelector: {
            strategy: 'TEST_ID' as const,
            value: 'input-username',
            fallbackSelectors: [
              { strategy: 'ID' as const, value: 'username' },
              { strategy: 'NAME' as const, value: 'username' },
              { strategy: 'LABEL' as const, value: 'Username' },
              { strategy: 'PLACEHOLDER' as const, value: 'Enter your username' },
              { strategy: 'CSS' as const, value: 'input[type="text"]' },
            ],
          },
          valueTemplate: '{{username}}',
          timeoutMs: 10000,
        },
        {
          stepIndex: 3,
          stepName: 'Entering credentials securely…',
          action: 'FILL' as const,
          targetSelector: {
            strategy: 'TEST_ID' as const,
            value: 'input-password',
            fallbackSelectors: [
              { strategy: 'ID' as const, value: 'password' },
              { strategy: 'NAME' as const, value: 'password' },
              { strategy: 'LABEL' as const, value: 'Password' },
              { strategy: 'PLACEHOLDER' as const, value: 'Enter your password' },
              { strategy: 'CSS' as const, value: 'input[type="password"]' },
            ],
          },
          valueTemplate: '{{password}}',
          timeoutMs: 10000,
        },
        {
          stepIndex: 4,
          stepName: 'Click Sign In Button',
          action: 'CLICK' as const,
          targetSelector: {
            strategy: 'TEST_ID' as const,
            value: 'btn-login',
            fallbackSelectors: [
              { strategy: 'ID' as const, value: 'btnLogin' },
              { strategy: 'ROLE' as const, value: 'button', roleName: 'Sign In' },
              { strategy: 'CSS' as const, value: 'button[type="submit"]' },
            ],
          },
          timeoutMs: 10000,
        },
        {
          stepIndex: 5,
          stepName: 'Verifying login…',
          action: 'WAIT_FOR_ELEMENT' as const,
          targetSelector: {
            strategy: 'TEST_ID' as const,
            value: 'hmc-dashboard',
            fallbackSelectors: [
              { strategy: 'ID' as const, value: 'hmc-app-header' },
              { strategy: 'CSS' as const, value: '.hmc-authenticated-layout' },
            ],
          },
          timeoutMs: 20000,
        },
      ],
      successConditions: [
        { type: 'URL_CONTAINS' as const, expectedValue: '/hmc/dashboard', isTerminalSuccess: true },
        { type: 'ELEMENT_VISIBLE' as const, selector: { strategy: 'TEST_ID' as const, value: 'hmc-dashboard' }, isTerminalSuccess: true },
      ],
      errorConditions: [
        { type: 'TEXT_PRESENT' as const, expectedValue: 'Invalid credentials', isTerminalError: true, errorMessage: 'Client login was unsuccessful. Verify the stored credentials.' },
        { type: 'TEXT_PRESENT' as const, expectedValue: 'Account locked', isTerminalError: true, errorMessage: 'Account locked out on target HMC' },
      ],
      securityBlockConditions: [
        { type: 'ELEMENT_VISIBLE' as const, selector: { strategy: 'TEST_ID' as const, value: 'mfa-challenge' }, isSecurityControlBlock: true, errorMessage: 'Manual security verification is required in the opened browser window.' },
        { type: 'ELEMENT_VISIBLE' as const, selector: { strategy: 'TEST_ID' as const, value: 'captcha-container' }, isSecurityControlBlock: true, errorMessage: 'Manual security verification is required in the opened browser window.' },
      ],
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
