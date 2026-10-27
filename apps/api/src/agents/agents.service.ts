import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
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
  resolveTaskModePolicy,
  MultiTabTargetItem,
} from '@hmc/shared';
import { ClientsService } from '../clients/clients.service.js';
import { ClientDirectoryReconciliationService } from './client-directory-reconciliation.service.js';
import { EphemeralCredentialStore } from '../client-users/ephemeral-credential.store.js';

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
    private clientsService: ClientsService,
    private reconciliationService: ClientDirectoryReconciliationService
  ) {}

  async getAllAgents(): Promise<DesktopAgentSummary[]> {
    const agents = await this.agentRepo.find({
      relations: ['assignedUser'],
      order: { lastHeartbeatAt: 'DESC' },
    });

    const now = Date.now();
    // Query active runs within lease timeout (last 30s)
    const activeRuns = await this.runRepo.find({
      where: {
        status: In(['CLAIMED', 'RUNNING', 'AUTHENTICATING', 'NAVIGATING', 'EXECUTING', 'VERIFYING']),
        completedAt: IsNull(),
      },
      order: { updatedAt: 'DESC' },
    });

    const activeAgentIdToRun = new Map<string, AutomationRun>();
    for (const r of activeRuns) {
      if (r.desktopAgentId && !['SUCCEEDED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(r.status)) {
        const runAgeMs = now - new Date(r.updatedAt || r.startedAt || r.createdAt).getTime();
        // Valid lease within 30 seconds
        if (runAgeMs < 30000) {
          activeAgentIdToRun.set(r.desktopAgentId, r);
        }
      }
    }

    return agents.map((a) => {
      const activeRun = activeAgentIdToRun.get(a.id);
      const lastHeartbeatMs = a.lastHeartbeatAt ? now - new Date(a.lastHeartbeatAt).getTime() : Infinity;

      let status = a.status;
      if (activeRun) {
        // A claimed, actively leased job must never be classified as OFFLINE solely because a normal heartbeat is temporarily delayed.
        status = 'BUSY';
      } else if (Math.abs(lastHeartbeatMs) > 15000) {
        // Disconnect grace period (15s) expired or clock skew anomaly and no active task lease
        status = 'OFFLINE';
      }

      return {
        id: a.id,
        agentName: a.agentName,
        machineHostname: a.machineHostname,
        osInfo: a.osInfo,
        assignedUserId: a.assignedUserId,
        assignedUsername: a.assignedUser?.username,
        status,
        currentTaskDescription: activeRun
          ? `Executing ${activeRun.runType} (Run ID: ${activeRun.id})`
          : a.currentTaskDescription || undefined,
        lastHeartbeatAt: a.lastHeartbeatAt ? a.lastHeartbeatAt.toISOString() : null,
        supportsVisibleChromeMutations: true,
        buildCommit: '6d63f04',
        buildTimestamp: a.updatedAt.toISOString(),
        headedMutationVersion: 'v1.0.0',
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      };
    });
  }

  async getOnlineAgent(): Promise<DesktopAgentSummary | null> {
    const agents = await this.getAllAgents();
    const online = agents.find((a) => a.status === 'ONLINE' || a.status === 'BUSY');
    return online || null;
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

    // Check for pending/queued automation runs assigned to this agent or unassigned
    // IMPORTANT: Only assign new tasks if the agent is ONLINE / not currently BUSY
    let pendingRun: AutomationRun | null = null;
    if (agent.status !== 'BUSY') {
      pendingRun = await this.runRepo.findOne({
        where: [
          { desktopAgentId: agent.id, status: In(['PENDING', 'QUEUED']) },
          { status: In(['PENDING', 'QUEUED']) },
        ],
        relations: ['client'],
        order: { createdAt: 'ASC' },
      });
    }

    if (pendingRun) {
      // Atomic status claim to prevent multiple agents or overlapping polls claiming the same run
      const updateResult = await this.runRepo
        .createQueryBuilder()
        .update(AutomationRun)
        .set({
          status: 'CLAIMED',
          desktopAgentId: agent.id,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where('id = :id AND status IN (:...statuses)', {
          id: pendingRun.id,
          statuses: ['PENDING', 'QUEUED'],
        })
        .execute();

      if (updateResult.affected && updateResult.affected > 0) {
        pendingRun.status = 'CLAIMED';
        pendingRun.desktopAgentId = agent.id;
        const task = await this.buildTaskAssignment(pendingRun);

        agent.status = 'BUSY';
        agent.lastHeartbeatAt = new Date();
        await this.agentRepo.save(agent);

        return { acknowledged: true, pendingRun: task };
      }
    }


    return { acknowledged: true };
  }

  async dispatchOpenAndLogin(clientId: string, userId: string, agentId?: string, targetBranch?: string): Promise<AutomationRun> {
    const client = await this.clientRepo.findOne({
      where: { id: clientId },
      relations: ['credential'],
    });
    if (!client) throw new NotFoundException('Client not found');

    if (!client.baseUrl || !client.baseUrl.startsWith('http')) {
      throw new BadRequestException('CLIENT_URL_INVALID: Client base URL is not configured or invalid.');
    }

    if (!client.credential || !client.credential.isActive) {
      throw new BadRequestException('CLIENT_AUTO_LOGIN_FAILED: Saved login credentials are unavailable for this client. Edit the client and save valid credentials.');
    }

    try {
      await this.clientsService.getDecryptedCredentials(client.id);
    } catch (err: any) {
      throw new BadRequestException('CLIENT_AUTO_LOGIN_FAILED: Saved credentials could not be decrypted. Re-save the client credentials.');
    }

    // Check available online desktop agents
    const allAgents = await this.getAllAgents();
    const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
    if (onlineAgents.length === 0) {
      throw new BadRequestException('DESKTOP_AGENT_OFFLINE: Desktop browser agent is not running. Start the agent.');
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
      runType: 'OPEN_INTERACTIVE_CLIENT_SESSION',
      status: 'PENDING',
      parametersJson: JSON.stringify({
        isHeaded: true,
        leaveBrowserOpen: true,
        userId,
        targetBranch: targetBranch || client.branchName || undefined,
      }),
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
        targetBranch: targetBranch || client.branchName || 'DEFAULT',
      }),
      correlationId,
    });
    await this.auditRepo.save(audit);

    return savedRun;
  }

  async dispatchMultipleTabs(
    items: Array<{
      clientId: string;
      targetBranch?: string;
      targetRoute?: string;
      screenName?: string;
    }>,
    userId: string,
    agentId?: string
  ): Promise<AutomationRun> {
    if (!items || items.length < 2) {
      throw new BadRequestException('INVALID_SELECTION: At least two clients or screens must be selected to open multiple tabs.');
    }

    // Resolve unique clients
    const uniqueClientIds = Array.from(new Set(items.map((i) => i.clientId)));
    const clients = await this.clientRepo.find({
      where: { id: In(uniqueClientIds) },
      relations: ['credential'],
    });

    const clientMap = new Map<string, Client>();
    for (const c of clients) {
      clientMap.set(c.id, c);
    }

    const resolvedTabs: MultiTabTargetItem[] = [];
    const decryptedCredsMap = new Map<string, { username: string; password?: string }>();

    for (const item of items) {
      const client = clientMap.get(item.clientId);
      if (!client) {
        throw new NotFoundException(`Client ${item.clientId} not found`);
      }

      if (!client.baseUrl || !client.baseUrl.startsWith('http')) {
        throw new BadRequestException(`CLIENT_URL_INVALID: Client ${client.clientCode} base URL is not configured or invalid.`);
      }

      if (!client.credential || !client.credential.isActive) {
        throw new BadRequestException(`CLIENT_AUTO_LOGIN_FAILED: Saved login credentials unavailable for ${client.clientCode}.`);
      }

      let creds = decryptedCredsMap.get(client.id);
      if (!creds) {
        try {
          const rawCreds = await this.clientsService.getDecryptedCredentials(client.id);
          if (!rawCreds || !rawCreds.username) {
            throw new Error('Empty credentials');
          }
          creds = { username: rawCreds.username, password: rawCreds.password };
          decryptedCredsMap.set(client.id, creds);
        } catch (err: any) {
          throw new BadRequestException(`CLIENT_AUTO_LOGIN_FAILED: Credentials could not be decrypted for ${client.clientCode}.`);
        }
      }

      resolvedTabs.push({
        id: `${item.clientId}_${item.screenName || 'screen'}_${crypto.randomUUID().slice(0, 6)}`,
        clientId: client.id,
        clientCode: client.clientCode,
        clientName: client.clientName,
        baseUrl: client.baseUrl,
        loginRoute: client.loginRoute,
        targetRoute: item.targetRoute || '/hmc/dashboard',
        screenName: item.screenName || 'Dashboard',
        targetBranch: item.targetBranch || client.branchName || undefined,
        credentials: creds,
        status: 'QUEUED',
      });
    }

    // Check available online desktop agents
    const allAgents = await this.getAllAgents();
    const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
    if (onlineAgents.length === 0) {
      throw new BadRequestException('DESKTOP_AGENT_OFFLINE: Desktop browser agent is not running. Start the agent.');
    }

    let targetAgentId = agentId;
    if (!targetAgentId) {
      targetAgentId = onlineAgents[0].id;
    }

    const correlationId = crypto.randomUUID();

    const run = this.runRepo.create({
      clientId: resolvedTabs[0].clientId,
      desktopAgentId: targetAgentId || null,
      triggeredByUserId: userId,
      runType: 'OPEN_MULTIPLE_TABS_SESSION',
      status: 'PENDING',
      parametersJson: JSON.stringify({
        isHeaded: true,
        leaveBrowserOpen: true,
        userId,
        tabs: resolvedTabs,
      }),
    });

    const savedRun = await this.runRepo.save(run);

    // Record Security Audit Log
    const audit = this.auditRepo.create({
      action: 'CLIENT_MULTIPLE_TABS_LAUNCH',
      actorUserId: userId,
      actorUsername: userId,
      entityType: 'CLIENT',
      entityId: resolvedTabs[0].clientId,
      result: 'SUCCESS',
      detailsJson: JSON.stringify({
        tabCount: resolvedTabs.length,
        clientCount: uniqueClientIds.length,
        runId: savedRun.id,
        targetAgentId: targetAgentId || 'ANY_AVAILABLE',
        onlineAgentsCount: onlineAgents.length,
        tabs: resolvedTabs.map((t) => ({
          clientCode: t.clientCode,
          screen: t.screenName,
          route: t.targetRoute,
        })),
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

    if (!['SUCCEEDED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(run.status)) {
      run.status = 'CANCELLED';
      run.errorMessage = 'Sync cancelled by user.';
      run.completedAt = new Date();
      await this.runRepo.save(run);
    }
    this.reconciliationService.discardBuffer(runId);
    return run;
  }

  async updateRunTelemetry(
    runId: string,
    dto: {
      status: string;
      errorMessage?: string;
      step?: AutomationRunStepTelemetry;
      totalDurationMs?: number;
      resultData?: any;
    }
  ): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) return;

    run.updatedAt = new Date(); // Refresh active task execution lease
    if (dto.totalDurationMs) run.totalDurationMs = dto.totalDurationMs;

    // Automatic Live Branch Discovery: If agent discovered branches on /loginCheck, persist to client profile
    if (Array.isArray(dto.resultData?.discoveredBranches) && dto.resultData.discoveredBranches.length > 0) {
      try {
        const client = await this.clientRepo.findOne({ where: { id: run.clientId } });
        if (client) {
          const currentBranches: string[] = client.branchesJson ? JSON.parse(client.branchesJson) : [];
          const merged = Array.from(new Set([...currentBranches, ...dto.resultData.discoveredBranches]));
          client.branchesJson = JSON.stringify(merged);
          if (!client.branchName && merged.length > 0) {
            client.branchName = merged[0];
          }
          await this.clientRepo.save(client);
          this.logger.log(`Auto-discovered and saved ${merged.length} branches for client ${client.clientCode}`);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to auto-save discovered branches: ${err.message}`);
      }
    }

    const isCreationWorkflow = run.runType === 'PROCESS_USER_FULL_WORKFLOW' || run.runType === 'CREATE_CLIENT_USER';
    const isRemoteVerificationDone =
      dto.resultData?.stage === 'FINAL_ROLES_VERIFIED' ||
      dto.status === 'FINAL_ROLES_VERIFIED' ||
      dto.status === 'COMPLETED';

    if (isCreationWorkflow && isRemoteVerificationDone) {
      // Remote terminal stage FINAL_ROLES_VERIFIED reached.
      // Central snapshot transaction must now execute before emitting completion.
      try {
        const stagesEmitted: string[] = ['FINAL_ROLES_VERIFIED'];
        await this.reconciliationService.persistCreationCompletionSnapshot(run, dto.resultData, (stage) => {
          stagesEmitted.push(stage);
        });

        // Central transaction succeeded: now emit CENTRAL_SNAPSHOT_PERSISTED and COMPLETED
        run.status = 'COMPLETED' as any;
        run.completedAt = new Date();
        const existingSummary = dto.resultData ? { ...dto.resultData } : {};
        existingSummary.stage = 'COMPLETED';
        existingSummary.stagesEmitted = stagesEmitted;

        const capturedPassword =
          dto.resultData?.ephemeralDefaultPassword ||
          dto.resultData?.defaultPassword ||
          dto.resultData?.temporaryPassword;

        if (capturedPassword) {
          const operatorId = run.triggeredByUserId || '';
          const deliveryRes = EphemeralCredentialStore.storeEphemeralCredential({
            initiatingOperatorId: operatorId,
            clientId: run.clientId,
            username: dto.resultData?.username || '',
            fullName: dto.resultData?.fullName,
            password: capturedPassword,
            user: { sub: operatorId, isSuperAdmin: true } as any,
          });
          existingSummary.oneTimeCredentialEventId = deliveryRes.oneTimeEventId;
          existingSummary.credentialDeliveryStatus = deliveryRes.credentialDeliveryStatus;
        }

        run.resultSummaryJson = JSON.stringify(existingSummary);
      } catch (persistErr: any) {
        this.logger.error(`Failed to persist verified creation snapshot for run ${run.id}: ${persistErr.message}`);
        // Requirement 4: If Central persistence fails after remote verification, return REMOTE_COMPLETED_CENTRAL_SYNC_PENDING. Never report COMPLETED.
        run.status = 'REMOTE_COMPLETED_CENTRAL_SYNC_PENDING' as any;
        run.errorMessage = `Remote execution verified, but Central DB snapshot persistence failed: ${persistErr.message}`;
        const existingSummary = dto.resultData ? { ...dto.resultData } : {};
        existingSummary.stage = 'FINAL_ROLES_VERIFIED';
        existingSummary.overallStatus = 'REMOTE_COMPLETED_CENTRAL_SYNC_PENDING';
        run.resultSummaryJson = JSON.stringify(existingSummary);
      }
    } else {
      if (['COMPLETED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(dto.status)) {
        run.status = (dto.status === 'COMPLETED' ? 'SUCCEEDED' : dto.status) as any;
        run.completedAt = new Date();
      } else if (dto.resultData?.stage && !['SUCCEEDED', 'COMPLETED'].includes(dto.resultData.stage)) {
        run.status = dto.resultData.stage as any;
      } else if (dto.status) {
        run.status = (dto.status === 'COMPLETED' ? 'SUCCEEDED' : dto.status) as any;
      }

      if (dto.errorMessage) run.errorMessage = dto.errorMessage;
      if (dto.resultData !== undefined) {
        const isTerminalTelemetry = ['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(dto.status);
        const isCurrentlyTerminal = ['SUCCEEDED', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(run.status);

        if (!isCurrentlyTerminal || isTerminalTelemetry) {
          const existingSummary = typeof dto.resultData === 'object' ? { ...dto.resultData } : {};
          const capturedPass =
            existingSummary.ephemeralDefaultPassword ||
            existingSummary.defaultPassword ||
            existingSummary.temporaryPassword;
          if (capturedPass && !existingSummary.oneTimeCredentialEventId && isCreationWorkflow) {
            const operatorId = run.triggeredByUserId || '';
            const deliveryRes = EphemeralCredentialStore.storeEphemeralCredential({
              initiatingOperatorId: operatorId,
              clientId: run.clientId,
              username: existingSummary.username || '',
              fullName: existingSummary.fullName,
              password: capturedPass,
              user: { sub: operatorId, isSuperAdmin: true } as any,
            });
            existingSummary.oneTimeCredentialEventId = deliveryRes.oneTimeEventId;
            existingSummary.credentialDeliveryStatus = deliveryRes.credentialDeliveryStatus;
          }

          // Authoritative auto-persistence of scraped bill counters from headless sync
          if (Array.isArray(existingSummary.billCounters) && existingSummary.billCounters.length > 0 && run.clientId) {
            try {
              const rawMappings = existingSummary.billCounters;
              const clientId = run.clientId;
              await this.runRepo.manager.query('DELETE FROM client_bill_counter_mappings WHERE clientId = @0', [clientId]);
              const normalize = (s?: string | null) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
              for (const item of rawMappings) {
                if (item.billCounterName && item.userName) {
                  await this.runRepo.manager.query(
                    `INSERT INTO client_bill_counter_mappings (id, clientId, billCounterName, userName, normalizedUserName, role, status, lastSyncedAt, createdAt, updatedAt)
                     VALUES (NEWID(), @0, @1, @2, @3, @4, @5, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME())`,
                    [
                      clientId,
                      item.billCounterName,
                      item.userName,
                      normalize(item.userName),
                      item.role || null,
                      item.isActive === false ? 'INACTIVE' : 'ACTIVE',
                    ]
                  );
                }
              }
              await this.reconciliationService.reconcileBillCounterStatus(clientId);
            } catch (bcSaveErr: any) {
              this.logger.warn(`Failed to persist bill counters from telemetry: ${bcSaveErr.message}`);
            }
          }

          run.resultSummaryJson = JSON.stringify(existingSummary);
        }
      }
      if (['SUCCEEDED', 'COMPLETED', 'REMOTE_VERIFICATION_COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'REQUIRES_MANUAL_INTERVENTION'].includes(run.status)) {
        run.completedAt = run.completedAt || new Date();
      }
    }

    if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(run.status)) {
      this.reconciliationService.discardBuffer(runId);
    }

    await this.runRepo.save(run);

    // Maintain active agent lease & status as BUSY while task telemetry is received
    if (run.desktopAgentId) {
      const agent = await this.agentRepo.findOne({ where: { id: run.desktopAgentId } });
      if (agent) {
        agent.lastHeartbeatAt = new Date();
        if (['SUCCEEDED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'REMOTE_COMPLETED_CENTRAL_SYNC_PENDING'].includes(run.status)) {
          agent.status = 'ONLINE';
        } else {
          agent.status = 'BUSY';
        }
        await this.agentRepo.save(agent);
      }
    }

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

    const params = run.parametersJson ? JSON.parse(run.parametersJson) : {};
    const taskPolicy = resolveTaskModePolicy(run.runType, params);
    const leaveBrowserOpen =
      taskPolicy.namespace === 'interactive'
        ? params.leaveBrowserOpen === true
        : false;

    return {
      runId: run.id,
      taskType: run.runType,
      clientId: client.id,
      clientBaseUrl: params.clientBaseUrl || client.baseUrl,
      clientAppPath: params.clientAppPath || client.applicationPath,
      loginRoute: params.loginRoute || client.loginRoute,
      targetRoute: params.targetRoute || client.usersRoute || '/users',
      targetBranch: params.targetBranch || client.branchName || undefined,
      workflowVersion: versionConfig,
      payload: params.payload || params,
      executionMode: taskPolicy.executionMode,
      credentials: params.credentials || {
        username: creds?.username,
        password: creds?.password,
      },
      options: {
        isHeaded: taskPolicy.isHeaded,
        leaveBrowserOpen,
      },
    };
  }
}
