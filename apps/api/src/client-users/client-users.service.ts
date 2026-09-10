import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  BadGatewayException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In, Not, IsNull } from 'typeorm';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import * as XLSX from 'xlsx';
import {
  Client,
  ClientUserSnapshot,
  AutomationRun,
  AuditLog,
  ClientCredential,
  EnvelopeEncryption,
} from '@hmc/database';
import {
  ClientUser,
  ClientUserListResponse,
  ClientUserSyncSummary,
  CreateClientUserDto,
  UpdateClientUserDto,
  ExcelUserImportPreviewResult,
  ExcelUserImportRow,
  ExcelUserImportExecutionSummary,
  ExcelUserImportExecutionRowResult,
  ClientUserStatus,
  JwtPayload,
  resolveClientRoute,
  resolveClientRoleUrl,
  normalizeClientBaseUrl,
  ClientCreateFormMetadata,
  UserImportAction,
  UserImportClassification,
  parseAndValidateRoles,
  BatchFinalStatus,
  isSystemCircuitBreakerError,
  SYSTEM_CIRCUIT_BREAKER_CODES,
  PERMISSIONS,
  UserEphemeralCredentialEvent,
  CredentialDeliveryStatus,
  EphemeralCredentialPayload,
  EphemeralCredentialAck,
  CREDENTIAL_QUEUE_REQUIRES_OPERATOR_ATTENTION,
  assertValidOneTimeEventId,
  isValidOneTimeEventId,
  computeOneTimeEventIdHash,
  SHA256_EMPTY_DIGEST,
  MapExistingUserRolesDto,
  computeRoleDiff,
  computeBidirectionalRoleDiff,
  RoleDiffResult,
  CreationOutcome,
  CreationWorkflowStage,
  toRoleItems,
  ClientUserRoleItem,
  AutomationInProgressResponse,
  UserCreationRunStatusResponse,
  SyncUserBatchDto,
  SyncUserBatchResponse,
  ScrapedUserBatchItem,
} from '@hmc/shared';
import { AgentsService } from '../agents/agents.service.js';

interface StoredEphemeralCredential {
  oneTimeEventId: string;
  oneTimeEventIdHash: string;
  initiatingOperatorId: string;
  initiatingSessionId?: string;
  clientId: string;
  jobId?: string;
  rowNumber?: number;
  username: string;
  fullName?: string;
  password?: string | null;
  createdAt: number;
  hardExpiresAt: number;
  displayDurationSeconds: number;
}

@Injectable()
export class ClientUsersService implements OnModuleInit {
  private readonly logger = new Logger(ClientUsersService.name);

  // Client-scoped single-flight map: SYNC_USERS:{clientId}
  private syncFlightPromises = new Map<string, Promise<ClientUserListResponse>>();
  private syncJobPromises = new Map<string, Promise<{ jobId: string; status: string; message: string }>>();

  constructor(
    @InjectRepository(ClientUserSnapshot)
    private snapshotRepo: Repository<ClientUserSnapshot>,
    @InjectRepository(Client)
    private clientRepo: Repository<Client>,
    @InjectRepository(ClientCredential)
    private credRepo: Repository<ClientCredential>,
    @InjectRepository(AutomationRun)
    private runRepo: Repository<AutomationRun>,
    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,
    private agentsService: AgentsService
  ) {}

  async onModuleInit() {
    try {
      await this.snapshotRepo.query(`
        IF NOT EXISTS (
          SELECT * FROM sys.columns 
          WHERE object_id = OBJECT_ID(N'[client_user_snapshots]') 
          AND name = 'syncRunId'
        )
        BEGIN
          ALTER TABLE [client_user_snapshots] ADD [syncRunId] NVARCHAR(100) NULL;
        END

        IF NOT EXISTS (
          SELECT * FROM sys.columns 
          WHERE object_id = OBJECT_ID(N'[client_user_snapshots]') 
          AND name = 'isPresentRemotely'
        )
        BEGIN
          ALTER TABLE [client_user_snapshots] ADD [isPresentRemotely] BIT NOT NULL DEFAULT 1;
        END
      `);
      this.logger.log('ClientUserSnapshot database schema columns verified.');
    } catch (err: any) {
      this.logger.warn(`Schema verification warning: ${err.message}`);
    }
  }

  /**
   * Resolves client routes safely using a structured URL builder and enforces version consistency.
   */
  public resolveClientUserRoutes(client: Client): {
    origin: string;
    resolvedLoginUrl: string;
    resolvedUsersUrl: string;
    resolvedAddUsersUrl: string;
    resolvedRoleUrl: string;
  } {
    let origin = client.baseUrl;
    try {
      if (client.baseUrl.startsWith('http')) {
        origin = new URL(client.baseUrl).origin;
      }
    } catch {}

    const resolvedLoginUrl = resolveClientRoute({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      route: client.loginRoute,
      fallbackRoute: '/login',
    });

    const resolvedUsersUrl = resolveClientRoute({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      route: client.usersRoute,
      fallbackRoute: '/users',
    });

    const resolvedAddUsersUrl = resolveClientRoute({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      route: '/addUsers',
      fallbackRoute: '/addUsers',
    });

    const resolvedRoleUrl = resolveClientRoleUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      userRoleRoute: client.userRoleRoute,
    });

    return {
      origin,
      resolvedLoginUrl,
      resolvedUsersUrl,
      resolvedAddUsersUrl,
      resolvedRoleUrl,
    };
  }

  /**
   * Retrieves paginated client user snapshots with optional search and filters.
   */
  async getClientUsers(
    clientId: string,
    query: {
      search?: string;
      status?: string;
      role?: string;
      page?: number;
      limit?: number;
    },
    user: JwtPayload
  ): Promise<ClientUserListResponse> {
    if (!clientId || clientId.trim() === '') {
      throw new BadRequestException({
        code: 'CLIENT_ID_REQUIRED',
        message: 'Target client ID is required.',
      });
    }

    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('You are not authorized to view this client');
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const skip = (page - 1) * limit;

    // Find latest successful syncRunId for this client
    const latestSyncRecord = await this.snapshotRepo
      .createQueryBuilder('u')
      .select('u.syncRunId', 'syncRunId')
      .addSelect('u.lastSyncedAt', 'lastSyncedAt')
      .where('u.clientId = :clientId AND u.isPresentRemotely = :isPresent AND u.syncRunId IS NOT NULL', {
        clientId,
        isPresent: true,
      })
      .orderBy('u.lastSyncedAt', 'DESC')
      .getRawOne();

    const latestSyncRunId = latestSyncRecord?.syncRunId;

    const qb = this.snapshotRepo
      .createQueryBuilder('u')
      .where('u.clientId = :clientId AND u.isPresentRemotely = :isPresent', { clientId, isPresent: true });

    if (latestSyncRunId) {
      qb.andWhere('u.syncRunId = :latestSyncRunId', { latestSyncRunId });
    }

    if (query.status && query.status !== 'ALL') {
      qb.andWhere('u.status = :status', { status: query.status });
    }

    if (query.role && query.role !== 'ALL') {
      qb.andWhere('u.role = :role', { role: query.role });
    }

    if (query.search && query.search.trim()) {
      const s = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(u.username) LIKE :s OR LOWER(u.fullName) LIKE :s OR LOWER(u.email) LIKE :s OR u.mobileNumber LIKE :s)',
        { s }
      );
    }

    qb.orderBy('u.fullName', 'ASC').skip(skip).take(limit);

    const [users, totalCount] = await qb.getManyAndCount();

    const baseCountQb = this.snapshotRepo
      .createQueryBuilder('u')
      .where('u.clientId = :clientId AND u.isPresentRemotely = :isPresent', { clientId, isPresent: true });
    if (latestSyncRunId) {
      baseCountQb.andWhere('u.syncRunId = :latestSyncRunId', { latestSyncRunId });
    }
    const totalClientUsers = await baseCountQb.getCount();

    const activeCountQb = this.snapshotRepo
      .createQueryBuilder('u')
      .where('u.clientId = :clientId AND u.isPresentRemotely = :isPresent AND u.status = :status', {
        clientId,
        isPresent: true,
        status: 'ACTIVE',
      });
    if (latestSyncRunId) {
      activeCountQb.andWhere('u.syncRunId = :latestSyncRunId', { latestSyncRunId });
    }
    const activeCount = await activeCountQb.getCount();

    const inactiveCountQb = this.snapshotRepo
      .createQueryBuilder('u')
      .where('u.clientId = :clientId AND u.isPresentRemotely = :isPresent AND u.status = :status', {
        clientId,
        isPresent: true,
        status: 'INACTIVE',
      });
    if (latestSyncRunId) {
      inactiveCountQb.andWhere('u.syncRunId = :latestSyncRunId', { latestSyncRunId });
    }
    const inactiveCount = await inactiveCountQb.getCount();

    const latestSync = await this.snapshotRepo.findOne({
      where: { clientId, isPresentRemotely: true },
      order: { lastSyncedAt: 'DESC' },
    });

    let liveOptions: ClientCreateFormMetadata | null = null;
    try {
      liveOptions = await this.getLiveFormOptions(clientId, user);
    } catch {}

    return {
      users: users.map((u) => this.mapToDto(u, client)),
      totalCount,
      activeCount: totalClientUsers > 0 ? activeCount : users.filter((u) => u.status === 'ACTIVE').length,
      inactiveCount: totalClientUsers > 0 ? inactiveCount : users.filter((u) => u.status === 'INACTIVE').length,
      lastSyncedAt: latestSync?.lastSyncedAt ? latestSync.lastSyncedAt.toISOString() : null,
      liveClientOptions: liveOptions
        ? {
            nationalities: liveOptions.nationalities,
            roles: liveOptions.roles,
            profileRoles: liveOptions.profileRoles,
          }
        : undefined,
    };
  }

  /**
   * Helper to accurately compute run elapsed ms regardless of database timezone serialization.
   */
  private getRunElapsedMs(run: AutomationRun): number {
    if (run.parametersJson) {
      try {
        const parsed = JSON.parse(run.parametersJson);
        if (parsed.createdEpochMs && typeof parsed.createdEpochMs === 'number') {
          return Math.max(0, Date.now() - parsed.createdEpochMs);
        }
      } catch {}
    }
    const diff = Date.now() - new Date(run.createdAt).getTime();
    return Math.max(0, diff);
  }

  /**
   * Safely marks stale non-terminal sync runs as TIMED_OUT.
   */
  public async cleanupStaleSyncJobs(clientId?: string): Promise<void> {
    const nonTerminalStatuses = [
      'QUEUED',
      'CLAIMED',
      'AUTHENTICATING',
      'NAVIGATING',
      'EXTRACTING',
      'PERSISTING',
      'PENDING',
      'RUNNING',
    ];

    const query: any = {
      runType: In(['SYNC_CLIENT_USERS_HEADLESS', 'SYNC_CLIENT_USERS']),
      status: In(nonTerminalStatuses),
    };
    if (clientId) query.clientId = clientId;

    const staleRuns = await this.runRepo.find({
      where: query,
      relations: ['desktopAgent'],
    });

    const now = Date.now();
    for (const run of staleRuns) {
      const elapsedMs = this.getRunElapsedMs(run);
      const isClaimTimeout = run.status === 'QUEUED' && elapsedMs >= 3000;
      const isTotalTimeout = elapsedMs >= 30000;
      const isAgentOffline =
        run.desktopAgent &&
        (!run.desktopAgent.lastHeartbeatAt ||
          now - new Date(run.desktopAgent.lastHeartbeatAt).getTime() > 5000);

      if (isTotalTimeout) {
        run.status = 'TIMED_OUT';
        run.errorMessage = 'Sync timed out after 30 seconds. Previous cached data is still available.';
        run.completedAt = new Date();
        await this.runRepo.save(run);
      } else if (isClaimTimeout) {
        run.status = 'TIMED_OUT';
        run.errorMessage = 'Sync job was not claimed by automation agent within 3 seconds.';
        run.completedAt = new Date();
        await this.runRepo.save(run);
      } else if (isAgentOffline) {
        run.status = 'FAILED';
        run.errorMessage = 'Sync failed: Automation agent is offline.';
        run.completedAt = new Date();
        await this.runRepo.save(run);
      }
    }
  }

  /**
   * Starts a client user sync job via the automation agent and returns immediately with the job ID.
   */
  async startSyncJob(clientId: string, user: JwtPayload): Promise<{ jobId: string; status: string; message: string }> {
    if (!clientId) {
      throw new BadRequestException({
        code: 'CLIENT_ID_REQUIRED',
        message: 'Target client ID is required.',
      });
    }

    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    const flightKey = `SYNC_USERS:${clientId}`;
    if (this.syncJobPromises.has(flightKey)) {
      return this.syncJobPromises.get(flightKey)!;
    }

    const execPromise = (async () => {
      // Clean up stale jobs before evaluating active status
      await this.cleanupStaleSyncJobs(clientId);

      // Version & URL validation
      const routes = this.resolveClientUserRoutes(client);

      // Duplicate sync job prevention - reuse existing in-flight run
      const existingActive = await this.runRepo.findOne({
        where: {
          clientId,
          runType: 'SYNC_CLIENT_USERS_HEADLESS',
          status: In(['QUEUED', 'CLAIMED', 'AUTHENTICATING', 'NAVIGATING', 'EXTRACTING', 'PERSISTING', 'PENDING', 'RUNNING']),
        },
        order: { createdAt: 'DESC' },
      });

      if (existingActive) {
        const elapsed = this.getRunElapsedMs(existingActive);
        if (elapsed < 45000) {
          return {
            jobId: existingActive.id,
            status: existingActive.status,
            message: 'Connecting to automation agent…',
          };
        }
      }

      const allAgents = await this.agentsService.getAllAgents();
      const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
      if (onlineAgents.length === 0) {
        throw new BadRequestException({
          code: 'DESKTOP_AGENT_OFFLINE',
          message: 'Sync failed: Automation agent is offline.',
        });
      }

      let credentials: { username: string; password: string } | undefined = undefined;
      const cred = await this.credRepo.findOne({ where: { clientId, isActive: true } });
      if (cred) {
        const username = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedUsername,
          iv: cred.usernameIv,
          tag: cred.usernameTag,
          keyVersion: cred.keyVersion,
        });
        const password = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedPassword,
          iv: cred.passwordIv,
          tag: cred.passwordTag,
          keyVersion: cred.keyVersion,
        });
        credentials = { username, password };
      }

      const correlationId = crypto.randomUUID();
      const now = new Date();

      const run = this.runRepo.create({
        clientId: client.id,
        desktopAgentId: onlineAgents[0].id,
        triggeredByUserId: user.sub,
        runType: 'SYNC_CLIENT_USERS_HEADLESS',
        status: 'QUEUED',
        createdAt: now,
        parametersJson: JSON.stringify({
          taskType: 'SYNC_CLIENT_USERS_HEADLESS',
          userId: user.sub,
          clientBaseUrl: client.baseUrl,
          loginRoute: routes.resolvedLoginUrl,
          targetRoute: routes.resolvedUsersUrl,
          credentials,
          createdEpochMs: Date.now(),
        }),
      });

      const savedRun = await this.runRepo.save(run);

      await this.auditRepo.save(
        this.auditRepo.create({
          action: 'CLIENT_USERS_SYNC_REQUESTED',
          actorUserId: user.sub,
          actorUsername: user.username,
          entityType: 'CLIENT',
          entityId: clientId,
          result: 'SUCCESS',
          correlationId,
          detailsJson: JSON.stringify({ clientCode: client.clientCode, runId: savedRun.id, executionMode: 'HEADLESS' }),
        })
      );

      return {
        jobId: savedRun.id,
        status: 'QUEUED',
        message: 'Connecting to automation agent…',
      };
    })();

    this.syncJobPromises.set(flightKey, execPromise);
    try {
      return await execPromise;
    } finally {
      setTimeout(() => {
        this.syncJobPromises.delete(flightKey);
      }, 1000);
    }
  }

  /**
   * Checks the status of a running sync job, enforces bounded timeouts, and persists snapshots.
   */
  async getSyncJobStatus(jobId: string, user: JwtPayload): Promise<any> {
    const run = await this.runRepo.findOne({
      where: { id: jobId },
      relations: ['desktopAgent'],
    });
    if (!run) throw new NotFoundException(`Sync job ${jobId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(run.clientId)) {
      throw new ForbiddenException('Not authorized to view this sync job');
    }

    const now = Date.now();
    const elapsedMs = this.getRunElapsedMs(run);
    const isTerminal = ['SUCCEEDED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(run.status);

    // Enforce bounded execution timeouts
    if (!isTerminal) {
      if (elapsedMs >= 90000) {
        run.status = 'TIMED_OUT';
        run.errorMessage = 'Sync timed out after 90 seconds. Previous cached data is still available.';
        run.completedAt = new Date();
        await this.runRepo.save(run);
      } else if (run.status === 'QUEUED' && elapsedMs >= 15000) {
        run.status = 'TIMED_OUT';
        run.errorMessage = 'Sync job was not claimed by automation agent within 15 seconds.';
        run.completedAt = new Date();
        await this.runRepo.save(run);
      } else if (
        run.desktopAgent &&
        (!run.desktopAgent.lastHeartbeatAt ||
          now - new Date(run.desktopAgent.lastHeartbeatAt).getTime() > 20000)
      ) {
        run.status = 'FAILED';
        run.errorMessage = 'Sync failed: Automation agent is offline.';
        run.completedAt = new Date();
        await this.runRepo.save(run);
      }
    }

    let resultData: any = null;
    if (run.resultSummaryJson) {
      try {
        resultData = JSON.parse(run.resultSummaryJson);
      } catch {}
    }

    // When run completes successfully, persist scraped users into snapshot DB
    if ((run.status === 'SUCCEEDED' || run.status === 'COMPLETED') && resultData && resultData.users) {
      await this.persistScrapedUsers(run.clientId, resultData.users);
    }

    const normalizedStatus =
      run.status === 'COMPLETED' ? 'SUCCEEDED' : run.status;

    return {
      jobId: run.id,
      status: normalizedStatus,
      stage: resultData?.stage || normalizedStatus,
      progressMessage:
        resultData?.message ||
        run.errorMessage ||
        (normalizedStatus === 'QUEUED' ? 'Connecting to automation agent…' : normalizedStatus),
      errorMessage: run.errorMessage || resultData?.errorMessage,
      errorCode:
        resultData?.errorCode ||
        (normalizedStatus === 'TIMED_OUT'
          ? 'SYNC_TIMEOUT'
          : normalizedStatus === 'FAILED'
          ? 'CLIENT_USER_SYNC_FAILED'
          : undefined),
      totalScraped: resultData?.totalScraped || resultData?.count || 0,
      elapsedSeconds: Math.floor(elapsedMs / 1000),
      streamedUsers: resultData?.streamedUsers || [],
      liveStatus:
        resultData?.liveStatus ||
        (['SUCCEEDED', 'COMPLETED'].includes(normalizedStatus) ? 'LIVE' : 'CACHED'),
    };
  }

  /**
   * Explicitly cancels an in-flight sync job upon user request.
   */
  async cancelSyncJob(jobId: string, user: JwtPayload): Promise<{ jobId: string; status: string; message: string }> {
    const run = await this.runRepo.findOne({ where: { id: jobId } });
    if (!run) throw new NotFoundException(`Sync job ${jobId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(run.clientId)) {
      throw new ForbiddenException('Not authorized to cancel this sync job');
    }

    if (!['SUCCEEDED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(run.status)) {
      run.status = 'CANCELLED';
      run.errorMessage = 'Sync cancelled by user.';
      run.completedAt = new Date();
      await this.runRepo.save(run);

      await this.auditRepo.save(
        this.auditRepo.create({
          action: 'CLIENT_USERS_SYNC_CANCELLED',
          actorUserId: user.sub,
          actorUsername: user.username,
          entityType: 'CLIENT',
          entityId: run.clientId,
          result: 'SUCCESS',
          detailsJson: JSON.stringify({ runId: run.id }),
        })
      );
    }

    return {
      jobId: run.id,
      status: 'CANCELLED',
      message: 'Sync cancelled by user.',
    };
  }

  /**
   * Helper to persist scraped snapshot users into MSSQL database with exact client-level deduplication and reconciliation.
   */
  private async persistScrapedUsers(
    clientId: string,
    scrapedUsers: any[],
    meta?: {
      remoteRowsRead?: number;
      remotePagesRead?: number;
      remoteDuplicatesRemoved?: number;
      remoteUniqueUsers?: number;
    }
  ): Promise<ClientUserSyncSummary> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client || !scrapedUsers) {
      return {
        remoteRowsRead: 0,
        remotePagesRead: 0,
        remoteDuplicatesRemoved: 0,
        remoteUniqueUsers: 0,
        centralRowsPersisted: 0,
        centralRowsDisplayed: 0,
        staleRowsExcluded: 0,
        crossClientRowsExcluded: 0,
        syncRunId: '',
      };
    }

    const rawRowsRead = meta?.remoteRowsRead ?? scrapedUsers.length;
    const pagesRead = meta?.remotePagesRead ?? 1;

    // Deduplicate only within this client by (clientId + remoteUserId) or (clientId + normalizedUsername)
    const deduplicatedMap = new Map<string, any>();
    for (const u of scrapedUsers) {
      if (u && u.username) {
        const key = u.remoteUserId
          ? `${clientId}:${u.remoteUserId}`
          : `${clientId}:${u.username.trim().toLowerCase()}`;
        deduplicatedMap.set(key, u);
      }
    }
    const deduplicatedUsers = Array.from(deduplicatedMap.values());
    const duplicatesRemoved = rawRowsRead - deduplicatedUsers.length;
    const remoteUniqueUsers = deduplicatedUsers.length;

    const syncRunId = crypto.randomUUID();
    const now = new Date();
    const activeUsernames = new Set<string>();

    let centralRowsPersisted = 0;
    for (const su of deduplicatedUsers) {
      const normUsername = su.username.trim();
      activeUsernames.add(normUsername.toLowerCase());

      let snapshot = await this.snapshotRepo.findOne({
        where: { clientId, username: normUsername },
      });

      if (!snapshot) {
        snapshot = this.snapshotRepo.create({
          clientId,
          clientCode: client.clientCode,
          username: normUsername,
          firstName: su.firstName,
          middleName: su.middleName,
          lastName: su.lastName,
          fullName: su.fullName || `${su.firstName} ${su.lastName}`.trim(),
          nickName: su.nickName,
          email: su.email,
          mobileNumber: su.mobileNumber,
          nationality: su.nationality,
          role: su.role,
          profileRole: su.profileRole,
          status: su.status,
          barcodeNumber: su.barcodeNumber,
          hasSignature: su.hasSignature || false,
          hasStamp: su.hasStamp || false,
          hasProfileImage: su.hasProfileImage || false,
          isPresentRemotely: true,
          syncRunId,
          lastSyncedAt: now,
        });
      } else {
        snapshot.firstName = su.firstName;
        snapshot.middleName = su.middleName;
        snapshot.lastName = su.lastName;
        snapshot.fullName = su.fullName || `${su.firstName} ${su.lastName}`.trim();
        snapshot.email = su.email;
        snapshot.mobileNumber = su.mobileNumber;
        if (su.role && su.role.trim().toUpperCase() !== 'USER') {
          snapshot.role = su.role;
        } else if (!snapshot.role) {
          snapshot.role = su.role;
        }
        snapshot.status = su.status;
        snapshot.hasSignature = su.hasSignature || false;
        snapshot.hasStamp = su.hasStamp || false;
        snapshot.hasProfileImage = su.hasProfileImage || false;
        snapshot.isPresentRemotely = true;
        snapshot.syncRunId = syncRunId;
        snapshot.lastSyncedAt = now;
      }
      await this.snapshotRepo.save(snapshot);
      centralRowsPersisted++;
    }

    // Mark previous snapshots of this client that were NOT present remotely as isPresentRemotely = false
    const existingSnapshots = await this.snapshotRepo.find({ where: { clientId } });
    let staleRowsExcluded = 0;
    for (const existing of existingSnapshots) {
      if (!activeUsernames.has(existing.username.toLowerCase())) {
        existing.isPresentRemotely = false;
        await this.snapshotRepo.save(existing);
        staleRowsExcluded++;
      }
    }

    // Count records belonging to OTHER clients to record crossClientRowsExcluded
    const crossClientRowsExcluded = await this.snapshotRepo.count({
      where: { clientId: Not(clientId), isPresentRemotely: true },
    });

    const centralRowsDisplayed = await this.snapshotRepo.count({
      where: { clientId, isPresentRemotely: true, syncRunId },
    });

    // Invariant verification: remoteUniqueUsers = centralRowsPersisted = centralRowsDisplayed
    if (remoteUniqueUsers !== centralRowsPersisted || centralRowsPersisted !== centralRowsDisplayed) {
      throw new BadRequestException({
        code: 'CLIENT_USER_COUNT_MISMATCH',
        message: `Synchronization count mismatch: remoteUniqueUsers (${remoteUniqueUsers}), centralRowsPersisted (${centralRowsPersisted}), centralRowsDisplayed (${centralRowsDisplayed}) do not match.`,
      });
    }

    return {
      remoteRowsRead: rawRowsRead,
      remotePagesRead: pagesRead,
      remoteDuplicatesRemoved: Math.max(0, duplicatesRemoved),
      remoteUniqueUsers,
      centralRowsPersisted,
      centralRowsDisplayed,
      staleRowsExcluded,
      crossClientRowsExcluded,
      syncRunId,
      // legacy compatibility
      remoteUsersFetched: rawRowsRead,
      excludedStaleRecords: staleRowsExcluded,
      duplicateRemoteRecordsRemoved: Math.max(0, duplicatesRemoved),
    };
  }

  /**
   * Synchronous / polling wrapper for syncClientUsers with single-flight coalescing.
   */
  async syncClientUsers(clientId: string, user: JwtPayload): Promise<ClientUserListResponse> {
    if (!clientId || clientId.trim() === '') {
      throw new BadRequestException({
        code: 'CLIENT_ID_REQUIRED',
        message: 'Target client ID is required.',
      });
    }

    const flightKey = `SYNC_USERS:${clientId}`;
    if (this.syncFlightPromises.has(flightKey)) {
      return this.syncFlightPromises.get(flightKey)!;
    }

    const syncPromise = (async () => {
      const { jobId } = await this.startSyncJob(clientId, user);

      // Wait up to 15s for the job to complete
      const startTime = Date.now();
      let completedRun: AutomationRun | null = null;

      while (Date.now() - startTime < 15000) {
        await new Promise((r) => setTimeout(r, 300));
        const r = await this.runRepo.findOne({ where: { id: jobId } });
        if (r && ['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(r.status)) {
          completedRun = r;
          break;
        }
      }

      let syncSummary: ClientUserSyncSummary | undefined = undefined;
      if (completedRun && (completedRun.status === 'COMPLETED' || completedRun.status === 'SUCCEEDED') && completedRun.resultSummaryJson) {
        try {
          const resultData = JSON.parse(completedRun.resultSummaryJson);
          if (resultData.users) {
            syncSummary = await this.persistScrapedUsers(clientId, resultData.users, {
              remoteRowsRead: resultData.remoteRowsRead,
              remotePagesRead: resultData.remotePagesRead,
              remoteDuplicatesRemoved: resultData.remoteDuplicatesRemoved,
              remoteUniqueUsers: resultData.remoteUniqueUsers,
            });
          }
        } catch (err: any) {
          if (err instanceof BadRequestException) throw err;
          console.error('Error saving scraped snapshot users:', err);
        }
      } else if (completedRun && (completedRun.status === 'FAILED' || completedRun.status === 'TIMED_OUT')) {
        let errorCode = 'CLIENT_USER_SYNC_FAILED';
        try {
          const parsed = JSON.parse(completedRun.resultSummaryJson || '{}');
          if (parsed.errorCode) errorCode = parsed.errorCode;
        } catch {}
        throw new BadRequestException({
          code: errorCode,
          message: completedRun.errorMessage || 'Background sync failed',
        });
      }

      const response = await this.getClientUsers(clientId, { page: 1, limit: 100 }, user);
      if (syncSummary) response.syncSummary = syncSummary;
      return response;
    })();

    this.syncFlightPromises.set(flightKey, syncPromise);
    try {
      return await syncPromise;
    } finally {
      this.syncFlightPromises.delete(flightKey);
    }
  }

  private static activeMutationLocks = new Map<
    string,
    { ownerToken: string; acquiredAt: number; lastHeartbeatAt: number; timer?: NodeJS.Timeout }
  >();
  private static readonly MUTATION_LOCK_STALE_TTL_MS = 60000;

  private acquireMutationLock(clientId: string, username: string): () => void {
    const key = `${clientId}:${username.trim().toLowerCase()}`;
    const now = Date.now();
    const existing = ClientUsersService.activeMutationLocks.get(key);

    if (existing) {
      if (now - existing.lastHeartbeatAt < ClientUsersService.MUTATION_LOCK_STALE_TTL_MS) {
        throw new ConflictException({
          statusCode: 409,
          code: 'OPERATION_IN_PROGRESS',
          message: `Another mutation operation is already in progress for user '${username}'.`,
        });
      }
      // Recover stale lock from dead process/unhandled crash
      if (existing.timer) clearInterval(existing.timer);
    }

    const ownerToken = crypto.randomUUID();
    const lockEntry = {
      ownerToken,
      acquiredAt: now,
      lastHeartbeatAt: now,
      timer: undefined as NodeJS.Timeout | undefined,
    };

    // Lifecycle heartbeat renewal: holds the lock until task terminal state calls release
    lockEntry.timer = setInterval(() => {
      const current = ClientUsersService.activeMutationLocks.get(key);
      if (current && current.ownerToken === ownerToken) {
        current.lastHeartbeatAt = Date.now();
      } else {
        clearInterval(lockEntry.timer);
      }
    }, 15000);

    ClientUsersService.activeMutationLocks.set(key, lockEntry);

    return () => {
      if (lockEntry.timer) clearInterval(lockEntry.timer);
      const current = ClientUsersService.activeMutationLocks.get(key);
      if (current && current.ownerToken === ownerToken) {
        ClientUsersService.activeMutationLocks.delete(key);
      }
    };
  }

  /**
   * Creates a user with duplicate validation and automated browser execution.
   */
  async createClientUser(
    dto: CreateClientUserDto,
    user: JwtPayload,
    options?: { skipPostSync?: boolean }
  ): Promise<ClientUser & { credentialDeliveryStatus?: CredentialDeliveryStatus; oneTimeCredentialEventId?: string; creationOutcome?: CreationOutcome; workflowStage?: CreationWorkflowStage }> {
    const client = await this.clientRepo.findOne({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException(`Client ${dto.clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(dto.clientId)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    // Normalize roles using shared role engine
    const rawRoles = (dto.roles && dto.roles.length > 0) ? dto.roles : (dto.role ? [dto.role] : []);
    const roleValidation = parseAndValidateRoles(rawRoles);
    const normalizedRoles = roleValidation.parsedRoles;
    const canonicalRoleString = roleValidation.canonicalRoleString || normalizedRoles.join(', ') || null;

    // Securely discard any password-related properties from older clients/requests
    const sanitizedDto: CreateClientUserDto = {
      clientId: dto.clientId,
      username: dto.username,
      firstName: dto.firstName,
      middleName: dto.middleName,
      lastName: dto.lastName,
      nickName: dto.nickName,
      email: dto.email,
      mobileNumber: dto.mobileNumber,
      nationality: dto.nationality,
      role: canonicalRoleString || dto.role,
      roles: normalizedRoles,
      profileRole: dto.profileRole,
      barcodeNumber: dto.barcodeNumber,
      signatureBase64: dto.signatureBase64,
      signatureFilename: dto.signatureFilename,
      stampBase64: dto.stampBase64,
      stampFilename: dto.stampFilename,
      profileBase64: dto.profileBase64,
      profileFilename: dto.profileFilename,
      status: dto.status,
      overrideDuplicateName: dto.overrideDuplicateName,
    };

    // Production mutation safeguard
    if ((client.environment as string).toUpperCase() === 'PRODUCTION') {
      throw new ForbiddenException({
        code: 'PRODUCTION_MUTATION_BLOCKED',
        message: `Client mutations are strictly blocked for PRODUCTION client '${client.clientCode}'. Only TEST and STAGING clients permit mutations.`,
      });
    }

    // Check if role has dependent profile roles that require profileRole
    try {
      const formMeta = await this.getLiveFormOptions(dto.clientId, user, false).catch(() => null);
      if (formMeta && formMeta.profileRoles && (dto.role || (dto.roles && dto.roles.length > 0))) {
        const rolesToCheck = (dto.roles && dto.roles.length > 0) ? dto.roles : (dto.role ? [dto.role] : []);
        const hasDependent = rolesToCheck.some((r) => {
          const dependentProfileRoles = formMeta.profileRoles.filter((pr: any) => {
            const parent = typeof pr === 'object' && pr?.roleDependency ? pr.roleDependency : '';
            return parent && parent.toLowerCase().trim() === r.toLowerCase().trim();
          });
          return dependentProfileRoles.length > 0;
        });
        if (hasDependent && !dto.profileRole) {
          throw new BadRequestException({
            code: 'REMOTE_REQUIRED_FIELD_UNSUPPORTED',
            message: 'REMOTE_REQUIRED_FIELD_UNSUPPORTED — Selected Role requires Profile Role.',
          });
        }
      }
    } catch (err: any) {
      if (err instanceof BadRequestException && (err.getResponse() as any)?.code === 'REMOTE_REQUIRED_FIELD_UNSUPPORTED') {
        throw err;
      }
    }

    // Acquire mutation lock
    const releaseLock = this.acquireMutationLock(sanitizedDto.clientId, sanitizedDto.username);

    try {
      // 1. Exact Username Duplicate Check
      const normalizedUsername = sanitizedDto.username.trim().toLowerCase();
      const existingByUsername = await this.snapshotRepo.findOne({
        where: { clientId: sanitizedDto.clientId, username: sanitizedDto.username.trim() },
      });

      if (existingByUsername) {
        throw new BadRequestException({
          code: 'DUPLICATE_USERNAME',
          message: `User already exists: the username '${sanitizedDto.username}' is already registered for this client.`,
        });
      }

      // 2. Same First Name & Last Name Duplicate Check
      const normFirst = sanitizedDto.firstName.trim().toLowerCase();
      const normLast = sanitizedDto.lastName.trim().toLowerCase();
      const existingByName = await this.snapshotRepo
        .createQueryBuilder('u')
        .where('u.clientId = :clientId', { clientId: sanitizedDto.clientId })
        .andWhere('LOWER(u.firstName) = :normFirst AND LOWER(u.lastName) = :normLast', { normFirst, normLast })
        .getOne();

      if (existingByName && !sanitizedDto.overrideDuplicateName) {
        throw new BadRequestException({
          code: 'POTENTIAL_DUPLICATE_NAME',
          message: `Possible duplicate user: another user already has the same first and last name (${existingByName.fullName}).`,
          potentialDuplicateOf: {
            username: existingByName.username,
            fullName: existingByName.fullName,
            mobileNumber: existingByName.mobileNumber,
            status: existingByName.status,
          },
        });
      }

      // 3. Dispatch Create Task via Desktop Agent or Headless Automation
      const onlineAgents = (await this.agentsService.getAllAgents()).filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
      let credentials: { username: string; password: string } | undefined = undefined;
      const cred = await this.credRepo.findOne({ where: { clientId: sanitizedDto.clientId, isActive: true } });
      if (cred) {
        const username = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedUsername,
          iv: cred.usernameIv,
          tag: cred.usernameTag,
          keyVersion: cred.keyVersion,
        });
        const password = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedPassword,
          iv: cred.passwordIv,
          tag: cred.passwordTag,
          keyVersion: cred.keyVersion,
        });
        credentials = { username, password };
      }

      if (onlineAgents.length === 0) {
        throw new BadRequestException('Mutation failed: Automation agent is offline.');
      }

      const routes = this.resolveClientUserRoutes(client);
      const correlationId = crypto.randomUUID();
      const hasMultiRoles = normalizedRoles && normalizedRoles.length > 0;
      const targetTaskType = hasMultiRoles ? 'PROCESS_USER_FULL_WORKFLOW' : 'CREATE_CLIENT_USER';
      const run = this.runRepo.create({
        clientId: client.id,
        desktopAgentId: onlineAgents[0].id,
        triggeredByUserId: user.sub,
        runType: targetTaskType as any,
        status: 'QUEUED',
        correlationId,
        parametersJson: JSON.stringify({
          taskType: targetTaskType,
          userId: user.sub,
          clientBaseUrl: client.baseUrl,
          clientAppPath: client.applicationPath,
          loginRoute: routes.resolvedLoginUrl,
          targetRoute: routes.resolvedUsersUrl,
          addUsersRoute: routes.resolvedAddUsersUrl,
          userRoleRoute: routes.resolvedRoleUrl,
          credentials,
          payload: {
            ...sanitizedDto,
            addUsersRoute: routes.resolvedAddUsersUrl,
            userRoleRoute: routes.resolvedRoleUrl,
            roles: normalizedRoles,
          },
          ...sanitizedDto,
        }),
      });

      const savedRun = await this.runRepo.save(run);

      // Bounded synchronous wait budget (20s)
      const startTime = Date.now();
      const SYNC_WAIT_BUDGET_MS = 20000;
      let completedRun: AutomationRun | null = null;
      while (Date.now() - startTime < SYNC_WAIT_BUDGET_MS) {
        await new Promise((r) => setTimeout(r, 400));
        const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
        if (r && ['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(r.status)) {
          completedRun = r;
          break;
        }
      }

      // If still pending or running at synchronous deadline: return HTTP 202 AUTOMATION_IN_PROGRESS
      if (!completedRun) {
        const latestRun = await this.runRepo.findOne({ where: { id: savedRun.id } });
        let latestStage = 'USER_CREATION_SUBMITTED';
        try {
          const p = JSON.parse(latestRun?.resultSummaryJson || '{}');
          if (p.workflowStage) latestStage = p.workflowStage;
          else if (p.message) latestStage = p.message;
        } catch {}

        return {
          operationStatus: 'AUTOMATION_IN_PROGRESS',
          runId: savedRun.id,
          stage: latestStage,
          targetUsername: sanitizedDto.username,
          message: 'User creation and multi-role mapping is in progress on remote portal.',
        } as any;
      }

      let parsedResult: any = {};
      try {
        parsedResult = JSON.parse(completedRun?.resultSummaryJson || '{}');
      } catch {}

      const isConfirmedSuccess =
        completedRun &&
        (['COMPLETED', 'SUCCEEDED'].includes(completedRun.status) ||
          (completedRun.status === 'FAILED' && parsedResult.isRemoteSaveConfirmed));

      const isUserCreated =
        isConfirmedSuccess ||
        Boolean(parsedResult && (parsedResult.creationState === 'COMPLETED' || parsedResult.isRemoteSaveConfirmed));

      if (!isConfirmedSuccess && !isUserCreated) {
        let errorCode = parsedResult.errorCode || 'REMOTE_VALIDATION_FAILED';
        let errorMessage = parsedResult.errorMessage || completedRun?.errorMessage || 'User creation failed on client portal.';
        if (completedRun?.status === 'TIMED_OUT') errorCode = 'OPERATION_TIMED_OUT';
        const outcome: CreationOutcome =
          errorCode === 'REMOTE_USER_NOT_FOUND_AFTER_CREATE' || errorCode === 'REMOTE_CREATE_VERIFICATION_FAILED'
            ? 'CREATION_VERIFICATION_REQUIRED'
            : 'FAILED_BEFORE_CREATION';
        throw new BadRequestException({
          code: errorCode,
          creationOutcome: outcome,
          workflowStage: parsedResult.workflowStage || 'USER_CREATION_SUBMITTED',
          message: errorMessage,
        });
      }

      // Safe error boundary for post-creation persistence and automatic pull sync
      let saved: ClientUserSnapshot | null = null;
      let centralSyncPending = false;

      try {
        // Automatically trigger post-mutation pull sync (unless skipped for batch import)
        if (!options?.skipPostSync) {
          try {
            await this.syncClientUsers(client.id, user);
          } catch (syncErr: any) {
            this.logger.warn(`Post-creation automatic sync failed: ${syncErr.message}`);
          }
        }

        // Save snapshot or update existing if found during pull sync
        const now = new Date();
        const normUsername = dto.username.trim().toLowerCase();
        let existingSnap = await this.snapshotRepo
          .createQueryBuilder('u')
          .where('u.clientId = :clientId', { clientId: client.id })
          .andWhere('LOWER(u.username) = :normUsername', { normUsername })
          .getOne();

        if (existingSnap) {
          if (canonicalRoleString) existingSnap.role = canonicalRoleString;
          if (isConfirmedSuccess) existingSnap.lastVerifiedAt = now;
          existingSnap.lastSyncedAt = now;
          saved = await this.snapshotRepo.save(existingSnap);
        } else {
          const fullName = `${dto.firstName} ${dto.middleName ? dto.middleName + ' ' : ''}${dto.lastName}`.trim();
          const snapshot = this.snapshotRepo.create({
            clientId: client.id,
            clientCode: client.clientCode,
            username: dto.username.trim(),
            firstName: dto.firstName.trim(),
            middleName: dto.middleName?.trim() || null,
            lastName: dto.lastName.trim(),
            fullName,
            nickName: dto.nickName?.trim() || null,
            email: dto.email?.trim() || null,
            mobileNumber: dto.mobileNumber.trim(),
            nationality: dto.nationality,
            role: canonicalRoleString || dto.role || null,
            profileRole: dto.profileRole || null,
            status: dto.status || 'ACTIVE',
            barcodeNumber: dto.barcodeNumber || null,
            hasSignature: Boolean(dto.signatureBase64),
            hasStamp: Boolean(dto.stampBase64),
            hasProfileImage: Boolean(dto.profileBase64),
            isPresentRemotely: true,
            lastVerifiedAt: isConfirmedSuccess ? now : undefined,
            lastSyncedAt: now,
          });
          saved = await this.snapshotRepo.save(snapshot);
        }
      } catch (persistErr: any) {
        this.logger.error(`Post-creation central persistence/sync failed for '${dto.username}': ${persistErr.message}`, persistErr.stack);
        centralSyncPending = true;
      }

      if (centralSyncPending || !saved) {
        const fullName = `${dto.firstName} ${dto.middleName ? dto.middleName + ' ' : ''}${dto.lastName}`.trim();
        const pendingUser: any = {
          id: crypto.randomUUID(),
          clientId: client.id,
          clientCode: client.clientCode,
          username: dto.username.trim(),
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          fullName,
          role: canonicalRoleString || dto.role || null,
          status: dto.status || 'ACTIVE',
          isPresentRemotely: true,
          creationOutcome: 'REMOTE_COMPLETED_CENTRAL_SYNC_PENDING',
          overallStatus: 'REMOTE_COMPLETED_CENTRAL_SYNC_PENDING',
          workflowStage: 'FINAL_ROLES_VERIFIED',
          credentialDeliveryStatus: 'DELIVERED',
          message: 'User and roles were created successfully in Simplex. Central synchronization is pending. No duplicate creation will be attempted.',
        };
        return pendingUser;
      }

      if (!isConfirmedSuccess && isUserCreated) {
        throw new BadRequestException({
          code: parsedResult.errorCode || 'ROLE_MAPPING_PENDING',
          creationOutcome: 'USER_CREATED_ROLE_PENDING',
          workflowStage: 'ROLE_MAPPING_SUBMITTED',
          message: parsedResult.errorMessage || 'User created successfully, but role mapping is pending. Retry role mapping without recreating the user.',
          retryStartingPoint: 'ROLE_STATE_INSPECTION',
          createdUser: saved,
        });
      }

      // Record Audit (Zero password leakage in audit log)
      await this.auditRepo.save(
        this.auditRepo.create({
          action: 'CLIENT_USER_CREATED',
          actorUserId: user.sub,
          actorUsername: user.username,
          entityType: 'CLIENT_USER',
          entityId: saved.id,
          result: 'SUCCESS',
          correlationId: crypto.randomUUID(),
          detailsJson: JSON.stringify({
            clientCode: client.clientCode,
            username: dto.username,
            duplicateNameOverrideUsed: Boolean(dto.overrideDuplicateName),
          }),
        })
      );

      // Extract ephemeral default/temporary password from completed run result summary
      let capturedPassword: string | undefined = undefined;
      if (parsedResult.ephemeralDefaultPassword || parsedResult.defaultPassword || parsedResult.temporaryPassword) {
        capturedPassword = parsedResult.ephemeralDefaultPassword || parsedResult.defaultPassword || parsedResult.temporaryPassword;
      }

      const deliveryRes = ClientUsersService.storeEphemeralCredential({
        initiatingOperatorId: user.sub,
        clientId: client.id,
        username: dto.username,
        fullName: saved.fullName,
        password: capturedPassword,
        user,
      });

      // Immediately scrub captured plaintext password from memory
      capturedPassword = undefined;

      const resultDto = this.mapToDto(saved, client);

      return {
        ...resultDto,
        credentialDeliveryStatus: deliveryRes.credentialDeliveryStatus,
        oneTimeCredentialEventId: deliveryRes.oneTimeEventId,
        creationOutcome: 'COMPLETED',
        workflowStage: 'COMPLETED',
        message: `User '${dto.username}' created and verified on client.`,
      };
    } finally {
      releaseLock();
    }
  }

  /**
   * Polls the live status of an asynchronous user creation / multi-role workflow.
   * Strictly read-only: 0 inserts or updates to ClientUserSnapshot, AutomationRun, AuditLog, or any database record.
   */
  async getCreationRunStatus(
    runId: string,
    user: JwtPayload,
    requestedClientId?: string
  ): Promise<UserCreationRunStatusResponse> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException({
        code: 'RUN_NOT_FOUND',
        message: `Automation run '${runId}' not found.`,
      });
    }

    if (requestedClientId && run.clientId !== requestedClientId) {
      throw new ForbiddenException({
        code: 'CLIENT_MISMATCH',
        message: 'Automation run does not belong to the requested client.',
      });
    }

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(run.clientId)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_CLIENT',
        message: 'Not authorized for this client',
      });
    }

    let params: any = {};
    try {
      params = JSON.parse(run.parametersJson || '{}');
    } catch {}
    const targetUsername = params.username || params.payload?.username || 'user';
    let parsedResult: any = {};
    try {
      parsedResult = JSON.parse(run.resultSummaryJson || '{}');
    } catch {}

    // 1. In-progress states
    if (['QUEUED', 'RUNNING', 'CLAIMED', 'AUTHENTICATING', 'NAVIGATING', 'EXTRACTING', 'PERSISTING'].includes(run.status)) {
      const stage = parsedResult.workflowStage || parsedResult.message || run.status;
      return {
        operationStatus: 'AUTOMATION_IN_PROGRESS',
        runId: run.id,
        stage,
        targetUsername,
        message: parsedResult.message || 'Operation is still running on remote portal.',
      };
    }

    // 2. Terminal completion (SUCCEEDED / COMPLETED)
    if (['COMPLETED', 'SUCCEEDED'].includes(run.status)) {
      const client = await this.clientRepo.findOne({ where: { id: run.clientId } });
      const normUsername = targetUsername.trim().toLowerCase();
      const snapshot = await this.snapshotRepo
        .createQueryBuilder('u')
        .where('u.clientId = :clientId', { clientId: run.clientId })
        .andWhere('LOWER(u.username) = :normUsername', { normUsername })
        .getOne();

      if (!snapshot) {
        return {
          operationStatus: 'COMPLETED',
          runId: run.id,
          stage: 'REMOTE_COMPLETED_CENTRAL_SYNC_PENDING',
          targetUsername,
          creationOutcome: 'REMOTE_COMPLETED_CENTRAL_SYNC_PENDING',
          message: 'User and roles were created successfully in Simplex. Central synchronization is pending.',
        };
      }

      return {
        operationStatus: 'COMPLETED',
        runId: run.id,
        stage: 'ROLES_VERIFIED',
        targetUsername,
        creationOutcome: 'COMPLETED',
        user: client ? this.mapToDto(snapshot, client) : (snapshot as any),
        oneTimeCredentialEventId: parsedResult.oneTimeCredentialEventId,
        credentialDeliveryStatus: parsedResult.credentialDeliveryStatus || 'DELIVERED',
        message: `User '${targetUsername}' created and verified on client portal.`,
      };
    }

    // 3. Terminal failure
    if (run.status === 'FAILED') {
      if (parsedResult.isRemoteSaveConfirmed) {
        return {
          operationStatus: 'FAILED',
          runId: run.id,
          stage: parsedResult.workflowStage || 'ROLES_FAILED_AFTER_USER_CREATED',
          targetUsername,
          creationOutcome: 'REMOTE_COMPLETED_CENTRAL_SYNC_PENDING',
          errorMessage: run.errorMessage || 'User created on remote portal but role assignment failed.',
        };
      }

      const isBeforeCreate = parsedResult.isRemoteUserCreated === false && parsedResult.creationState !== 'COMPLETED';
      const outcome: CreationOutcome = isBeforeCreate ? 'FAILED_BEFORE_CREATION' : 'CREATION_VERIFICATION_REQUIRED';

      return {
        operationStatus: 'FAILED',
        runId: run.id,
        stage: parsedResult.workflowStage || 'FAILED',
        targetUsername,
        creationOutcome: outcome,
        errorMessage: run.errorMessage || parsedResult.errorMessage || 'User creation failed on client portal.',
      };
    }

    // 4. TIMED_OUT or unknown status -> NEVER generic failure, always CREATION_VERIFICATION_REQUIRED
    return {
      operationStatus: 'FAILED',
      runId: run.id,
      stage: 'OPERATION_TIMED_OUT',
      targetUsername,
      creationOutcome: 'CREATION_VERIFICATION_REQUIRED',
      errorMessage: 'Operation timed out during automation execution. Verification required.',
    };
  }

  /**
   * Reconciles a created client user via read-only pull sync without re-submitting remote forms.
   */
  async reconcileCreatedUser(clientId: string, username: string, user: JwtPayload): Promise<ClientUser> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    const normUsername = username.trim().toLowerCase();

    // Trigger authoritative read-only pull sync from remote Simplex
    try {
      await this.syncClientUsers(clientId, user);
    } catch (err: any) {
      this.logger.warn(`Reconciliation sync failed: ${err.message}`);
    }

    const reconciled = await this.snapshotRepo
      .createQueryBuilder('u')
      .where('u.clientId = :clientId', { clientId })
      .andWhere('LOWER(u.username) = :normUsername', { normUsername })
      .getOne();

    if (!reconciled) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND_ON_REMOTE',
        message: `User '${username}' could not be verified on client portal after synchronization.`,
      });
    }

    return {
      ...this.mapToDto(reconciled, client),
      message: `User '${username}' successfully verified and synchronized with Central Console.`,
    };
  }

  /**
   * Updates an existing user on the remote client with verification and automatic pull sync.
   */
  async updateClientUser(id: string, dto: UpdateClientUserDto, user: JwtPayload): Promise<ClientUser> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException(`User ${id} not found`);

    const client = await this.clientRepo.findOne({ where: { id: snapshot.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    if ((client.environment as string).toUpperCase() === 'PRODUCTION') {
      throw new ForbiddenException({
        code: 'PRODUCTION_MUTATION_BLOCKED',
        message: `Client mutations are strictly blocked for PRODUCTION client '${client.clientCode}'. Only TEST and STAGING clients permit mutations.`,
      });
    }

    const releaseLock = this.acquireMutationLock(client.id, snapshot.username);

    try {
      const allAgents = await this.agentsService.getAllAgents();
      const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
      if (onlineAgents.length === 0) {
        throw new BadRequestException({
          code: 'DESKTOP_AGENT_OFFLINE',
          message: 'Update failed: Automation agent is offline.',
        });
      }

      let credentials: { username: string; password: string } | undefined = undefined;
      const cred = await this.credRepo.findOne({ where: { clientId: client.id, isActive: true } });
      if (cred) {
        const username = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedUsername,
          iv: cred.usernameIv,
          tag: cred.usernameTag,
          keyVersion: cred.keyVersion,
        });
        const password = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedPassword,
          iv: cred.passwordIv,
          tag: cred.passwordTag,
          keyVersion: cred.keyVersion,
        });
        credentials = { username, password };
      }

      const routes = this.resolveClientUserRoutes(client);
      const correlationId = crypto.randomUUID();

      const run = this.runRepo.create({
        clientId: client.id,
        desktopAgentId: onlineAgents[0].id,
        triggeredByUserId: user.sub,
        runType: 'EDIT_CLIENT_USER',
        status: 'PENDING',
        parametersJson: JSON.stringify({
          taskType: 'EDIT_CLIENT_USER',
          userId: user.sub,
          username: snapshot.username,
          clientBaseUrl: client.baseUrl,
          loginRoute: routes.resolvedLoginUrl,
          targetRoute: routes.resolvedUsersUrl,
          credentials,
          payload: {
            username: snapshot.username,
            ...dto,
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      });

      const savedRun = await this.runRepo.save(run);

      // Wait for agent completion and remote verification (up to 20s)
      const startTime = Date.now();
      let completedRun: AutomationRun | null = null;
      while (Date.now() - startTime < 20000) {
        await new Promise((r) => setTimeout(r, 300));
        const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
        if (r && (['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'] as any).includes(r.status)) {
          completedRun = r;
          break;
        }
      }

      if (!completedRun) {
        savedRun.status = 'TIMED_OUT';
        savedRun.errorMessage = 'User update timed out: Automation agent did not respond within 20 seconds.';
        await this.runRepo.save(savedRun).catch(() => {});
        throw new BadRequestException({
          code: 'OPERATION_TIMED_OUT',
          message: 'User update timed out: Automation agent did not respond within 20 seconds.',
        });
      }

      if (completedRun.status === 'FAILED' || completedRun.status === 'TIMED_OUT') {
        let errorCode = 'REMOTE_EDIT_FAILED';
        let errorMsg = completedRun?.errorMessage || 'User edit failed on remote client portal.';
        try {
          const parsed = JSON.parse(completedRun?.resultSummaryJson || '{}');
          if (parsed.errorCode) errorCode = parsed.errorCode;
          if (parsed.errorMessage) errorMsg = parsed.errorMessage;
        } catch {}
        throw new BadRequestException({
          code: errorCode,
          message: errorMsg,
        });
      }

      // Remote verification succeeded -> Trigger automatic pull sync
      await this.syncClientUsers(client.id, user);

      const updatedSnapshot = await this.snapshotRepo.findOne({ where: { id } });
      if (!updatedSnapshot) throw new NotFoundException(`User ${id} not found after sync`);

      await this.auditRepo.save(
        this.auditRepo.create({
          action: 'CLIENT_USER_UPDATED',
          actorUserId: user.sub,
          actorUsername: user.username,
          entityType: 'CLIENT_USER',
          entityId: id,
          result: 'SUCCESS',
          correlationId,
          detailsJson: JSON.stringify({
            clientCode: client.clientCode,
            username: snapshot.username,
            runId: savedRun.id,
          }),
        })
      );

      return this.mapToDto(updatedSnapshot, client);
    } finally {
      releaseLock();
    }
  }

  /**
   * Sets the active/inactive status of a client user on the remote client with verification and automatic pull sync.
   */
  async setUserStatus(id: string, targetStatus: ClientUserStatus, user: JwtPayload): Promise<ClientUser> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException(`User ${id} not found`);

    if (snapshot.isPresentRemotely === false) {
      throw new BadRequestException({
        code: 'REMOTE_USER_NOT_PRESENT',
        message: 'REMOTE_USER_NOT_PRESENT — Refresh the selected client directory.',
      });
    }

    const client = await this.clientRepo.findOne({ where: { id: snapshot.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    if ((client.environment as string).toUpperCase() === 'PRODUCTION') {
      throw new ForbiddenException({
        code: 'PRODUCTION_MUTATION_BLOCKED',
        message: `Client mutations are strictly blocked for PRODUCTION client '${client.clientCode}'. Only TEST and STAGING clients permit mutations.`,
      });
    }

    const releaseLock = this.acquireMutationLock(client.id, snapshot.username);

    try {
      const allAgents = await this.agentsService.getAllAgents();
      const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
      if (onlineAgents.length === 0) {
        throw new BadRequestException({
          code: 'DESKTOP_AGENT_OFFLINE',
          message: 'Status update failed: Automation agent is offline.',
        });
      }

      let credentials: { username: string; password: string } | undefined = undefined;
      const cred = await this.credRepo.findOne({ where: { clientId: client.id, isActive: true } });
      if (cred) {
        const username = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedUsername,
          iv: cred.usernameIv,
          tag: cred.usernameTag,
          keyVersion: cred.keyVersion,
        });
        const password = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedPassword,
          iv: cred.passwordIv,
          tag: cred.passwordTag,
          keyVersion: cred.keyVersion,
        });
        credentials = { username, password };
      }

      const routes = this.resolveClientUserRoutes(client);
      const correlationId = crypto.randomUUID();

      const run = this.runRepo.create({
        clientId: client.id,
        desktopAgentId: onlineAgents[0].id,
        triggeredByUserId: user.sub,
        runType: 'CHANGE_CLIENT_USER_STATUS',
        status: 'PENDING',
        parametersJson: JSON.stringify({
          taskType: 'CHANGE_CLIENT_USER_STATUS',
          userId: user.sub,
          remoteUserId: snapshot.remoteUserId,
          username: snapshot.username,
          currentStatus: snapshot.status,
          targetStatus,
          clientBaseUrl: client.baseUrl,
          loginRoute: routes.resolvedLoginUrl,
          targetRoute: routes.resolvedUsersUrl,
          credentials,
          idempotencyKey: crypto.randomUUID(),
          payload: {
            remoteUserId: snapshot.remoteUserId,
            username: snapshot.username,
            status: targetStatus,
            targetStatus,
          },
        }),
      });

      const savedRun = await this.runRepo.save(run);

      // Wait for agent completion and remote verification (up to 20s)
      const startTime = Date.now();
      let completedRun: AutomationRun | null = null;
      while (Date.now() - startTime < 20000) {
        await new Promise((r) => setTimeout(r, 300));
        const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
        if (r && (['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'] as any).includes(r.status)) {
          completedRun = r;
          break;
        }
      }

      if (!completedRun) {
        savedRun.status = 'TIMED_OUT';
        savedRun.errorMessage = 'Status update timed out: Automation agent did not respond within 20 seconds.';
        await this.runRepo.save(savedRun).catch(() => {});
        throw new BadRequestException({
          code: 'OPERATION_TIMED_OUT',
          message: 'Status update timed out: Automation agent did not respond within 20 seconds.',
        });
      }

      if (completedRun.status === 'FAILED' || completedRun.status === 'TIMED_OUT') {
        let errorCode = 'REMOTE_STATUS_VERIFICATION_FAILED';
        let errorMsg = completedRun?.errorMessage || 'Remote status verification failed on client portal.';
        let actionTaken: string | undefined = undefined;
        let retryStartingPoint: string | undefined = undefined;
        try {
          const parsed = JSON.parse(completedRun?.resultSummaryJson || '{}');
          if (parsed.errorCode) errorCode = parsed.errorCode;
          if (parsed.errorMessage) errorMsg = parsed.errorMessage;
          if (parsed.actionTaken) actionTaken = parsed.actionTaken;
          if (parsed.retryStartingPoint) retryStartingPoint = parsed.retryStartingPoint;
        } catch {}

        if (actionTaken === 'NO_CHANGE_REQUIRED') {
          snapshot.status = targetStatus;
          snapshot.isPresentRemotely = true;
          snapshot.lastSyncedAt = new Date();
          const updatedSnapshot = await this.snapshotRepo.save(snapshot);
          return this.mapToDto(updatedSnapshot, client);
        }

        if (errorCode === 'REMOTE_USER_NOT_FOUND') {
          snapshot.isPresentRemotely = false;
          await this.snapshotRepo.save(snapshot).catch(() => {});
        }

        // Error Mapping per spec:
        // HTTP 401/403 for confirmed auth failures only
        if (errorCode === 'CLIENT_AUTO_LOGIN_FAILED' || errorCode === 'INVALID_CREDENTIALS' || errorCode === 'CLIENT_AUTHENTICATION_FAILED') {
          throw new UnauthorizedException({
            code: 'CLIENT_AUTHENTICATION_FAILED',
            message: errorMsg,
            retryStartingPoint: retryStartingPoint || 'LOGIN',
          });
        }

        if (errorCode === 'CLIENT_AUTHORIZATION_DENIED' || errorCode === 'ACCESS_DENIED') {
          throw new ForbiddenException({
            code: 'CLIENT_AUTHORIZATION_DENIED',
            message: errorMsg,
          });
        }

        // HTTP 409 for verification unknown (mutation submitted, remote status unknown) or precheck unknown
        if (
          errorCode === 'REMOTE_STATUS_VERIFICATION_UNKNOWN' ||
          errorCode === 'MUTATION_SUBMITTED_VERIFICATION_PENDING' ||
          errorCode === 'REMOTE_STATUS_PRECHECK_UNKNOWN'
        ) {
          throw new ConflictException({
            code: errorCode,
            message:
              errorCode === 'REMOTE_STATUS_PRECHECK_UNKNOWN'
                ? (errorMsg || 'Remote status precheck could not determine current status. Use read-only Refresh Current Status before retrying.')
                : 'Status action may have completed, but verification is pending. No automatic second click was performed. Use Refresh Current Status before retrying.',
            retryStartingPoint: retryStartingPoint || (errorCode === 'REMOTE_STATUS_PRECHECK_UNKNOWN' ? 'PRECHECK' : 'STATUS_VERIFICATION'),
            diagnostics: errorMsg,
          });
        }

        // HTTP 502 for pre-mutation indeterminate page/auth state and browser/portal errors
        if (errorCode === 'AUTH_STATE_INDETERMINATE' || errorCode === 'PAGE_CRASH' || errorCode === 'BROWSER_UNAVAILABLE' || errorCode === 'REMOTE_NAVIGATION_FAILED' || errorCode === 'TARGET_ELEMENT_NOT_FOUND') {
          throw new BadGatewayException({
            code: errorCode,
            message: errorMsg,
          });
        }

        throw new BadRequestException({
          code: errorCode,
          message: errorMsg,
          retryStartingPoint,
        });
      }

      // Check if actionTaken was NO_CHANGE_REQUIRED on completed run
      try {
        const parsed = JSON.parse(completedRun?.resultSummaryJson || '{}');
        if (parsed.actionTaken === 'NO_CHANGE_REQUIRED') {
          snapshot.status = targetStatus;
          snapshot.isPresentRemotely = true;
          snapshot.lastSyncedAt = new Date();
          const updatedSnapshot = await this.snapshotRepo.save(snapshot);
          return this.mapToDto(updatedSnapshot, client);
        }
      } catch {}

      // Remote verification succeeded -> Update Central snapshot immediately with verified remote status
      snapshot.status = targetStatus;
      snapshot.isPresentRemotely = true;
      snapshot.lastSyncedAt = new Date();
      const updatedSnapshot = await this.snapshotRepo.save(snapshot);

      // Trigger asynchronous background pull sync to reconcile entire directory
      this.syncClientUsers(client.id, user).catch(() => {});

      await this.auditRepo.save(
        this.auditRepo.create({
          action: 'CLIENT_USER_STATUS_CHANGED',
          actorUserId: user.sub,
          actorUsername: user.username,
          entityType: 'CLIENT_USER',
          entityId: id,
          result: 'SUCCESS',
          correlationId,
          detailsJson: JSON.stringify({
            clientCode: client.clientCode,
            username: snapshot.username,
            previousStatus: snapshot.status,
            finalStatus: targetStatus,
            runId: savedRun.id,
          }),
        })
      );

      return this.mapToDto(updatedSnapshot, client);
    } finally {
      releaseLock();
    }
  }

  /**
   * Resets password on the remote client with verification and delivers via ephemeral credential store.
   */
  async resetUserPassword(
    id: string,
    user: JwtPayload
  ): Promise<{
    success: boolean;
    username?: string;
    credentialDeliveryStatus?: CredentialDeliveryStatus;
    oneTimeCredentialEventId?: string;
    message: string;
  }> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException(`User ${id} not found`);

    const client = await this.clientRepo.findOne({ where: { id: snapshot.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    if ((client.environment as string).toUpperCase() === 'PRODUCTION') {
      throw new ForbiddenException({
        code: 'PRODUCTION_MUTATION_BLOCKED',
        message: `Client mutations are strictly blocked for PRODUCTION client '${client.clientCode}'. Only TEST and STAGING clients permit mutations.`,
      });
    }

    const releaseLock = this.acquireMutationLock(client.id, snapshot.username);

    try {
      const allAgents = await this.agentsService.getAllAgents();
      const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
      if (onlineAgents.length === 0) {
        throw new BadRequestException({
          code: 'DESKTOP_AGENT_OFFLINE',
          message: 'Password reset failed: Automation agent is offline.',
        });
      }

      let credentials: { username: string; password: string } | undefined = undefined;
      const cred = await this.credRepo.findOne({ where: { clientId: client.id, isActive: true } });
      if (cred) {
        const username = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedUsername,
          iv: cred.usernameIv,
          tag: cred.usernameTag,
          keyVersion: cred.keyVersion,
        });
        const password = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedPassword,
          iv: cred.passwordIv,
          tag: cred.passwordTag,
          keyVersion: cred.keyVersion,
        });
        credentials = { username, password };
      }

      const routes = this.resolveClientUserRoutes(client);
      const correlationId = crypto.randomUUID();

      const run = this.runRepo.create({
        clientId: client.id,
        desktopAgentId: onlineAgents[0].id,
        triggeredByUserId: user.sub,
        runType: 'RESET_CLIENT_USER_PASSWORD',
        status: 'PENDING',
        parametersJson: JSON.stringify({
          taskType: 'RESET_CLIENT_USER_PASSWORD',
          userId: user.sub,
          username: snapshot.username,
          remoteUserId: snapshot.remoteUserId,
          clientBaseUrl: client.baseUrl,
          clientAppPath: client.applicationPath,
          loginRoute: routes.resolvedLoginUrl,
          targetRoute: routes.resolvedUsersUrl,
          credentials,
          payload: {
            username: snapshot.username,
            remoteUserId: snapshot.remoteUserId,
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      });

      const savedRun = await this.runRepo.save(run);

      // Wait for agent completion and remote verification (up to 25s)
      const startTime = Date.now();
      let completedRun: AutomationRun | null = null;
      while (Date.now() - startTime < 25000) {
        await new Promise((r) => setTimeout(r, 250));
        const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
        if (r && (['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'] as any).includes(r.status)) {
          completedRun = r;
          break;
        }
      }

      if (!completedRun) {
        savedRun.status = 'TIMED_OUT';
        savedRun.errorMessage = 'Password reset timed out: Automation agent did not respond within 25 seconds.';
        await this.runRepo.save(savedRun).catch(() => {});
        throw new ConflictException({
          code: 'PASSWORD_RESET_VERIFICATION_UNKNOWN',
          message: 'Password reset timed out: Automation agent did not respond within 25 seconds.',
        });
      }

      let parsedResult: any = {};
      try {
        parsedResult = JSON.parse(completedRun.resultSummaryJson || '{}');
      } catch {}

      if (completedRun.status === 'FAILED' || completedRun.status === 'TIMED_OUT') {
        let errorCode = 'PASSWORD_RESET_VERIFICATION_UNKNOWN';
        let errorMsg = completedRun?.errorMessage || 'Password reset failed on remote client portal.';
        if (parsedResult.errorCode) errorCode = parsedResult.errorCode;
        if (parsedResult.errorMessage) errorMsg = parsedResult.errorMessage;
        if (completedRun.status === 'TIMED_OUT') errorCode = 'CLIENT_MUTATION_TIMEOUT';
        if (errorCode === 'PASSWORD_RESET_VERIFICATION_UNKNOWN' || completedRun.status === 'TIMED_OUT') {
          throw new ConflictException({
            code: 'PASSWORD_RESET_VERIFICATION_UNKNOWN',
            message: errorMsg,
          });
        }
        throw new BadRequestException({
          code: errorCode,
          message: errorMsg,
        });
      }

      let tempPassword: string | undefined = undefined;
      let message = `Password for '${snapshot.username}' reset successfully.`;
      if (parsedResult.temporaryPassword || parsedResult.defaultPassword) {
        tempPassword = parsedResult.temporaryPassword || parsedResult.defaultPassword;
      }
      if (parsedResult.message) {
        message = parsedResult.message;
      }

      const deliveryRes = ClientUsersService.storeEphemeralCredential({
        initiatingOperatorId: user.sub,
        clientId: client.id,
        username: snapshot.username,
        fullName: snapshot.fullName,
        password: tempPassword,
        user,
      });

      // Scrub plaintext immediately
      tempPassword = undefined;

      // Record Audit (Zero plaintext password in audit log)
      await this.auditRepo.save(
        this.auditRepo.create({
          action: 'CLIENT_USER_PASSWORD_RESET',
          actorUserId: user.sub,
          actorUsername: user.username,
          entityType: 'CLIENT_USER',
          entityId: id,
          result: 'SUCCESS',
          correlationId,
          detailsJson: JSON.stringify({
            clientCode: client.clientCode,
            username: snapshot.username,
            runId: savedRun.id,
            credentialDeliveryStatus: deliveryRes.credentialDeliveryStatus,
          }),
        })
      );

      // Trigger same-client read-only sync in background without delaying success popup
      this.syncClientUsers(client.id, user).catch((syncErr) => {
        this.logger.warn(`Post-reset background sync failed: ${syncErr.message}`);
      });

      return {
        success: true,
        username: snapshot.username,
        credentialDeliveryStatus: deliveryRes.credentialDeliveryStatus,
        oneTimeCredentialEventId: deliveryRes.oneTimeEventId,
        message,
      };
    } finally {
      releaseLock();
    }
  }

  /**
   * Existing User Role Action:
   * Maps additive roles to an existing client user.
   * Enforces single-flight mutation locking (HTTP 409 if locked),
   * strict additive semantics (existing roles remain checked and protected),
   * exact role matching, and snapshot updates upon verification.
   */
  async mapExistingUserRoles(
    id: string,
    dto: MapExistingUserRolesDto,
    user: JwtPayload
  ): Promise<{
    success: boolean;
    username: string;
    rolesAdded: string[];
    rolesRemoved?: string[];
    existingRoles: string[];
    currentRoles: string[];
    message: string;
  }> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException('Client user not found');

    const client = await this.clientRepo.findOne({ where: { id: snapshot.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(client.id)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    if ((client.environment as string).toUpperCase() === 'PRODUCTION') {
      throw new ForbiddenException({
        code: 'PRODUCTION_MUTATION_BLOCKED',
        message: `Client mutations are strictly blocked for PRODUCTION client '${client.clientCode}'. Only TEST and STAGING clients permit mutations.`,
      });
    }

    const currentRolesList = parseAndValidateRoles(snapshot.role || '').parsedRoles;

    let diff: RoleDiffResult;
    if (dto.rolesToAdd || dto.rolesToRemove) {
      const toNames = (arr: any) =>
        (Array.isArray(arr) ? arr : (arr ? [arr] : [])).map((r: any) =>
          typeof r === 'string' ? r.trim() : (r as ClientUserRoleItem).canonicalRoleName?.trim() || ''
        ).filter(Boolean);

      const parsedAdd = parseAndValidateRoles(toNames(dto.rolesToAdd)).parsedRoles;
      const parsedRemove = parseAndValidateRoles(toNames(dto.rolesToRemove)).parsedRoles;
      const removeSet = new Set(parsedRemove.map((r) => r.toLowerCase()));
      const rolesUnchanged = currentRolesList.filter((r) => !removeSet.has(r.toLowerCase()));
      const resultingRoles = Array.from(new Set([...rolesUnchanged, ...parsedAdd]));

      diff = {
        existingRoles: currentRolesList,
        rolesToAdd: parsedAdd,
        rolesUnchanged,
        rolesRemoved: parsedRemove,
        resultingRoles,
      };
    } else {
      const roleSource = dto.resultingRoles || dto.roles || [];
      const rawRoles = (Array.isArray(roleSource) ? roleSource : [roleSource]).map((r: any) =>
        typeof r === 'string' ? r : (r as ClientUserRoleItem).canonicalRoleName
      );
      const normalizedInputRoles = parseAndValidateRoles(rawRoles).parsedRoles;
      diff = computeBidirectionalRoleDiff(currentRolesList, normalizedInputRoles);
    }

    // Guard 1: Disable submission if no changes were made
    if (diff.rolesToAdd.length === 0 && diff.rolesRemoved.length === 0) {
      return {
        success: true,
        username: snapshot.username,
        rolesAdded: [],
        rolesRemoved: [],
        existingRoles: diff.existingRoles,
        currentRoles: diff.resultingRoles,
        message: 'No changes made to user roles.',
      };
    }

    // Guard 2: Prevent removing all roles from a user
    if (diff.resultingRoles.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_ROLE_SET_BLOCKED',
        message: 'A user must have at least one role assigned. Removing all roles is not permitted.',
      });
    }

    // Guard 3: Prevent administrative self-lockout
    if (snapshot.username.toLowerCase() === user.username.toLowerCase()) {
      const adminRoles = new Set(['super_admin', 'admin', 'administrator']);
      const isRemovingAdmin = diff.rolesRemoved.some((r: string) => adminRoles.has(r.toLowerCase().trim()));
      if (isRemovingAdmin) {
        throw new ForbiddenException({
          code: 'ADMIN_SELF_LOCKOUT_BLOCKED',
          message: 'Self-lockout protection: You cannot remove essential administrative roles from your own account.',
        });
      }
    }

    const releaseLock = this.acquireMutationLock(client.id, snapshot.username);

    try {
      const allAgents = await this.agentsService.getAllAgents();
      const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
      if (onlineAgents.length === 0) {
        throw new BadRequestException({
          code: 'DESKTOP_AGENT_OFFLINE',
          message: 'Role mapping failed: Automation agent is offline.',
        });
      }

      let credentials: { username: string; password: string } | undefined = undefined;
      const cred = await this.credRepo.findOne({ where: { clientId: client.id, isActive: true } });
      if (cred) {
        const username = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedUsername,
          iv: cred.usernameIv,
          tag: cred.usernameTag,
          keyVersion: cred.keyVersion,
        });
        const password = EnvelopeEncryption.decrypt({
          cipherText: cred.encryptedPassword,
          iv: cred.passwordIv,
          tag: cred.passwordTag,
          keyVersion: cred.keyVersion,
        });
        credentials = { username, password };
      }

      const routes = this.resolveClientUserRoutes(client);
      const correlationId = crypto.randomUUID();

      const run = this.runRepo.create({
        clientId: client.id,
        desktopAgentId: onlineAgents[0].id,
        triggeredByUserId: user.sub,
        runType: 'MAP_CLIENT_USER_ROLES' as any,
        status: 'PENDING',
        parametersJson: JSON.stringify({
          taskType: 'MAP_CLIENT_USER_ROLES',
          userId: user.sub,
          username: snapshot.username,
          fullName: snapshot.fullName,
          clientBaseUrl: client.baseUrl,
          clientAppPath: client.applicationPath,
          loginRoute: routes.resolvedLoginUrl,
          targetRoute: routes.resolvedUsersUrl,
          roleUrl: routes.resolvedRoleUrl,
          credentials,
          payload: {
            username: snapshot.username,
            fullName: snapshot.fullName,
            requestedRoles: diff.resultingRoles,
            resultingRoles: diff.resultingRoles,
            rolesToAdd: diff.rolesToAdd,
            rolesToRemove: diff.rolesRemoved,
            existingRoles: diff.existingRoles,
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      });

      const savedRun = await this.runRepo.save(run);

      // Wait for agent completion and remote verification (up to 30s)
      const startTime = Date.now();
      let completedRun: AutomationRun | null = null;
      while (Date.now() - startTime < 30000) {
        await new Promise((r) => setTimeout(r, 250));
        const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
        if (r && (['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'] as any).includes(r.status)) {
          completedRun = r;
          break;
        }
      }

      if (!completedRun) {
        savedRun.status = 'TIMED_OUT';
        savedRun.errorMessage = 'Role mapping timed out: Automation agent did not respond within 30 seconds.';
        await this.runRepo.save(savedRun).catch(() => {});
        throw new ConflictException({
          code: 'ROLE_VERIFICATION_UNKNOWN',
          message: 'Role mapping timed out: Automation agent did not respond within 30 seconds.',
        });
      }

      let parsedResult: any = {};
      try {
        parsedResult = JSON.parse(completedRun.resultSummaryJson || '{}');
      } catch {}

      if (completedRun.status === 'FAILED' || completedRun.status === 'TIMED_OUT') {
        const errorCode = parsedResult.errorCode || 'REMOTE_ROLE_MAPPING_FAILED';
        const errorMsg = parsedResult.errorMessage || completedRun?.errorMessage || 'Role mapping failed on remote client portal.';
        if (errorCode === 'ROLE_VERIFICATION_UNKNOWN' || completedRun.status === 'TIMED_OUT') {
          throw new ConflictException({
            code: 'ROLE_VERIFICATION_UNKNOWN',
            message: errorMsg,
          });
        }
        throw new BadRequestException({
          code: errorCode,
          message: errorMsg,
        });
      }

      // Update local snapshot with resulting roles upon verified success atomically
      const newCanonicalRoles = Array.from(
        new Set((diff.resultingRoles || []).map((r: string) => r.trim()).filter(Boolean))
      ).join(', ');

      const updateTimestamp = new Date();
      await this.snapshotRepo
        .createQueryBuilder()
        .update(ClientUserSnapshot)
        .set({
          role: newCanonicalRoles,
          lastVerifiedAt: updateTimestamp,
          lastSyncedAt: updateTimestamp,
          updatedAt: updateTimestamp,
        })
        .where('id = :id', { id: snapshot.id })
        .execute();

      snapshot.role = newCanonicalRoles;
      snapshot.lastVerifiedAt = updateTimestamp;
      snapshot.lastSyncedAt = updateTimestamp;

      // Record Audit with full delta
      await this.auditRepo.save(
        this.auditRepo.create({
          action: 'CLIENT_USER_ROLES_UPDATED',
          actorUserId: user.sub,
          actorUsername: user.username,
          entityType: 'CLIENT_USER',
          entityId: id,
          result: 'SUCCESS',
          correlationId,
          detailsJson: JSON.stringify({
            clientCode: client.clientCode,
            username: snapshot.username,
            targetUserId: id,
            targetUsername: snapshot.username,
            operator: user.username,
            timestamp: new Date().toISOString(),
            correlationId,
            runId: savedRun.id,
            rolesBefore: diff.existingRoles,
            rolesAdded: diff.rolesToAdd,
            rolesRemoved: diff.rolesRemoved,
            rolesAfter: diff.resultingRoles,
          }),
        })
      );

      return {
        success: true,
        username: snapshot.username,
        rolesAdded: diff.rolesToAdd,
        rolesRemoved: diff.rolesRemoved,
        existingRoles: diff.existingRoles,
        currentRoles: diff.resultingRoles,
        message: `Successfully updated roles for ${snapshot.username}. Added: ${diff.rolesToAdd.length}, Removed: ${diff.rolesRemoved.length}.`,
      };
    } finally {
      releaseLock();
    }
  }

  /**
   * Returns current roles and available client roles for an existing user strictly from central snapshot.
   */
  async getUserRoles(
    id: string,
    user: JwtPayload
  ): Promise<{
    username: string;
    fullName: string;
    currentRoles: ClientUserRoleItem[];
    availableRoles: ClientUserRoleItem[];
    dataSource: 'SNAPSHOT';
    lastSyncedAt: string | null;
    isSnapshotData: true;
  }> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException('Client user not found');

    const client = await this.clientRepo.findOne({ where: { id: snapshot.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(client.id)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    const currentRolesParsed = parseAndValidateRoles(snapshot.role || '').parsedRoles;

    // Get live available roles for this client
    let availableRaw: any[] = [];
    try {
      const formMeta = await this.getLiveFormOptions(client.id, user, false).catch(() => null);
      if (formMeta && Array.isArray(formMeta.roles)) {
        availableRaw = formMeta.roles;
      }
    } catch {}

    const availableRoles = toRoleItems(availableRaw);
    const currentRoles = toRoleItems(currentRolesParsed, availableRoles);

    return {
      username: snapshot.username,
      fullName: snapshot.fullName,
      currentRoles,
      availableRoles,
      dataSource: 'SNAPSHOT',
      lastSyncedAt: snapshot.lastSyncedAt ? new Date(snapshot.lastSyncedAt).toISOString() : null,
      isSnapshotData: true,
    };
  }

  /**
   * Performs read-only remote refresh of roles for an existing user.
   * Protected with RBAC, single-flight locking, browser auto-close, and non-sensitive audit metadata.
   */
  async refreshUserRolesRemote(
    id: string,
    user: JwtPayload
  ): Promise<{
    username: string;
    fullName: string;
    currentRoles: ClientUserRoleItem[];
    availableRoles: ClientUserRoleItem[];
    dataSource: 'REMOTE_LIVE' | 'SNAPSHOT';
    lastSyncedAt: string | null;
    isSnapshotData: boolean;
  }> {
    let snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException('Client user not found');

    const client = await this.clientRepo.findOne({ where: { id: snapshot.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(client.id)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    // Single-flight locking protection: prevents concurrent refresh collisions
    const releaseLock = this.acquireMutationLock(client.id, snapshot.username);

    let remoteRefreshSucceeded = false;
    try {
      const allAgents = await this.agentsService.getAllAgents();
      const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
      if (onlineAgents.length === 0) {
        this.logger.warn(`Role refresh agent offline. Falling back to snapshot for ${snapshot.username}.`);
      } else {
        let credentials: { username: string; password: string } | undefined = undefined;
        const cred = await this.credRepo.findOne({ where: { clientId: client.id, isActive: true } });
        if (cred) {
          const username = EnvelopeEncryption.decrypt({
            cipherText: cred.encryptedUsername,
            iv: cred.usernameIv,
            tag: cred.usernameTag,
            keyVersion: cred.keyVersion,
          });
          const password = EnvelopeEncryption.decrypt({
            cipherText: cred.encryptedPassword,
            iv: cred.passwordIv,
            tag: cred.passwordTag,
            keyVersion: cred.keyVersion,
          });
          credentials = { username, password };
        }

        const routes = this.resolveClientUserRoutes(client);
        const run = this.runRepo.create({
          clientId: client.id,
          desktopAgentId: onlineAgents[0].id,
          triggeredByUserId: user.sub,
          runType: 'REFRESH_CLIENT_USER_ROLES' as any,
          status: 'PENDING',
          parametersJson: JSON.stringify({
            taskType: 'REFRESH_CLIENT_USER_ROLES',
            userId: user.sub,
            clientId: client.id,
            clientBaseUrl: client.baseUrl,
            clientAppPath: client.applicationPath,
            loginRoute: routes.resolvedLoginUrl,
            targetRoute: routes.resolvedUsersUrl,
            userRoleRoute: routes.resolvedRoleUrl,
            credentials,
            payload: {
              username: snapshot.username,
              remoteUserId: snapshot.remoteUserId,
            },
          }),
        });

        const savedRun = await this.runRepo.save(run);

        // Wait for agent completion (up to 30s)
        const startTime = Date.now();
        let completedRun: AutomationRun | null = null;
        while (Date.now() - startTime < 30000) {
          await new Promise((r) => setTimeout(r, 250));
          const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
          if (r && (['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'] as any).includes(r.status)) {
            completedRun = r;
            break;
          }
        }

        if (!completedRun) {
          savedRun.status = 'TIMED_OUT';
          savedRun.errorMessage = 'Role refresh timed out: Automation agent did not respond within 30 seconds.';
          await this.runRepo.save(savedRun).catch(() => {});
          this.logger.warn(`Role refresh timed out for ${snapshot.username}. Falling back to snapshot.`);
        } else {
          let parsedResult: any = {};
          try {
            parsedResult = JSON.parse(completedRun.resultSummaryJson || '{}');
          } catch {}

          if (completedRun.status === 'FAILED' || completedRun.status === 'TIMED_OUT' || !parsedResult.success) {
            const errorCode = parsedResult.errorCode || 'REMOTE_ROLE_REFRESH_FAILED';
            const errorMsg = parsedResult.errorMessage || completedRun?.errorMessage || 'Role refresh failed on remote client portal.';
            this.logger.warn(`Remote role refresh did not succeed for ${snapshot.username} (${errorCode}: ${errorMsg}). Falling back to snapshot roles.`);
          } else {
            remoteRefreshSucceeded = true;
            // Live roles verified: normalize canonical role names and remove exact duplicates
            const rawLiveRoles: string[] = Array.isArray(parsedResult.roles) ? parsedResult.roles : [];
            const normalizedLiveRoles = Array.from(
              new Set(
                rawLiveRoles
                  .map((r) => (typeof r === 'string' ? r.trim() : ''))
                  .filter(Boolean)
              )
            );
            const canonicalRolesString = normalizedLiveRoles.join(', ');

            // Atomic persistence: update snapshot.role, lastVerifiedAt, lastSyncedAt together.
            const updateTimestamp = new Date();
            await this.snapshotRepo
              .createQueryBuilder()
              .update(ClientUserSnapshot)
              .set({
                role: canonicalRolesString,
                lastVerifiedAt: updateTimestamp,
                lastSyncedAt: updateTimestamp,
                updatedAt: updateTimestamp,
              })
              .where('id = :id', { id: snapshot.id })
              .execute();

            snapshot.role = canonicalRolesString;
            snapshot.lastVerifiedAt = updateTimestamp;
            snapshot.lastSyncedAt = updateTimestamp;

            // Record non-sensitive audit metadata
            await this.auditRepo.save(
              this.auditRepo.create({
                action: 'CLIENT_USER_ROLES_REFRESHED',
                actorUserId: user.sub,
                actorUsername: user.username,
                entityType: 'CLIENT_USER',
                entityId: id,
                result: 'SUCCESS',
                detailsJson: JSON.stringify({
                  clientUserId: id,
                  username: snapshot.username,
                  remoteUserId: snapshot.remoteUserId,
                  liveRoles: normalizedLiveRoles,
                  refreshedAt: new Date().toISOString(),
                }),
              })
            ).catch(() => {});
          }
        }
      }
    } finally {
      // Guaranteed lock release on all outcomes
      releaseLock();
    }

    const currentRolesParsed = parseAndValidateRoles(snapshot.role || '').parsedRoles;

    let availableRaw: any[] = [];
    try {
      const formMeta = await this.getLiveFormOptions(client.id, user, true).catch(() => null);
      if (formMeta && Array.isArray(formMeta.roles)) {
        availableRaw = formMeta.roles;
      }
    } catch {}

    const availableRoles = toRoleItems(availableRaw);
    const currentRoles = toRoleItems(currentRolesParsed, availableRoles);

    return {
      username: snapshot.username,
      fullName: snapshot.fullName,
      currentRoles,
      availableRoles,
      dataSource: remoteRefreshSucceeded ? 'REMOTE_LIVE' : 'SNAPSHOT',
      lastSyncedAt: snapshot.lastSyncedAt ? new Date(snapshot.lastSyncedAt).toISOString() : new Date().toISOString(),
      isSnapshotData: !remoteRefreshSucceeded,
    };
  }

  private static formOptionsCache = new Map<string, { timestamp: number; data: ClientCreateFormMetadata }>();
  private static ephemeralCredentialStore = new Map<string, StoredEphemeralCredential>();

  /**
   * Dedicated Ephemeral Credential Store:
   * Holds transient credentials in memory only (never written to database, audit logs, or generic responses).
   * Enforces 5-minute hard TTL and single-claim eviction.
   */
  public static storeEphemeralCredential(payload: {
    initiatingOperatorId: string;
    initiatingSessionId?: string;
    clientId: string;
    jobId?: string;
    rowNumber?: number;
    username: string;
    fullName?: string;
    password?: string | null;
    user: JwtPayload;
  }): { oneTimeEventId: string; oneTimeEventIdHash: string; credentialDeliveryStatus: CredentialDeliveryStatus } {
    // Purge expired entries
    const now = Date.now();
    for (const [id, item] of ClientUsersService.ephemeralCredentialStore.entries()) {
      if (now > item.hardExpiresAt) {
        ClientUsersService.ephemeralCredentialStore.delete(id);
      }
    }

    const hasCredentialViewPermission = Boolean(
      payload.user.isSuperAdmin ||
      (payload.user.permissions && (
        payload.user.permissions.includes('client_user.credential_view') ||
        payload.user.permissions.includes(PERMISSIONS.CLIENT_USER_CREDENTIAL_VIEW as any) ||
        payload.user.permissions.includes('CLIENT_USER_CREDENTIAL_VIEW' as any)
      ))
    );

    const oneTimeEventId = crypto.randomBytes(32).toString('hex');
    assertValidOneTimeEventId(oneTimeEventId);
    const oneTimeEventIdHash = computeOneTimeEventIdHash(oneTimeEventId);

    if (!hasCredentialViewPermission) {
      return {
        oneTimeEventId,
        oneTimeEventIdHash,
        credentialDeliveryStatus: 'RESTRICTED',
      };
    }

    if (!payload.password) {
      return {
        oneTimeEventId,
        oneTimeEventIdHash,
        credentialDeliveryStatus: 'UNAVAILABLE',
      };
    }

    ClientUsersService.ephemeralCredentialStore.set(oneTimeEventId, {
      oneTimeEventId,
      oneTimeEventIdHash,
      initiatingOperatorId: payload.initiatingOperatorId,
      initiatingSessionId: payload.initiatingSessionId || payload.user.sessionId,
      clientId: payload.clientId,
      jobId: payload.jobId,
      rowNumber: payload.rowNumber,
      username: payload.username,
      fullName: payload.fullName,
      password: payload.password,
      createdAt: now,
      hardExpiresAt: now + 300000, // 5 minutes hard expiry
      displayDurationSeconds: 60,
    });

    return {
      oneTimeEventId,
      oneTimeEventIdHash,
      credentialDeliveryStatus: 'DELIVERED',
    };
  }

  public claimEphemeralCredential(
    dto: { oneTimeEventId: string; clientId?: string; jobId?: string; sessionId?: string } | string,
    user: JwtPayload
  ): {
    oneTimeEventId: string;
    oneTimeEventIdHash: string;
    username: string;
    fullName?: string;
    password: string | null;
    hardExpiresAt: string;
    displayDurationSeconds: number;
    credentialDeliveryStatus: CredentialDeliveryStatus;
  } {
    const hasCredentialViewPermission = Boolean(
      user.isSuperAdmin ||
      (user.permissions && (
        user.permissions.includes('client_user.credential_view') ||
        user.permissions.includes(PERMISSIONS.CLIENT_USER_CREDENTIAL_VIEW as any) ||
        user.permissions.includes('CLIENT_USER_CREDENTIAL_VIEW' as any)
      ))
    );

    if (!hasCredentialViewPermission) {
      throw new ForbiddenException({
        code: 'CREDENTIAL_VIEW_FORBIDDEN',
        message: 'Operator lacks CLIENT_USER_CREDENTIAL_VIEW permission.',
      });
    }

    const eventId = typeof dto === 'string' ? dto : dto?.oneTimeEventId;
    if (!eventId || !isValidOneTimeEventId(eventId) || !ClientUsersService.ephemeralCredentialStore.has(eventId)) {
      throw new NotFoundException({
        code: 'CREDENTIAL_NOT_AVAILABLE',
        message: 'Credential is not available.',
      });
    }

    const stored = ClientUsersService.ephemeralCredentialStore.get(eventId)!;

    // Strict Initiating Operator Ownership - Super Admin cross-operator claim is strictly forbidden!
    if (stored.initiatingOperatorId !== user.sub) {
      throw new NotFoundException({
        code: 'CREDENTIAL_NOT_AVAILABLE',
        message: 'Credential is not available.',
      });
    }

    // Session Binding Check
    const effectiveSessionId = user.sessionId || (typeof dto === 'object' ? dto.sessionId : undefined);
    if (stored.initiatingSessionId && effectiveSessionId && stored.initiatingSessionId !== effectiveSessionId) {
      throw new NotFoundException({
        code: 'CREDENTIAL_NOT_AVAILABLE',
        message: 'Credential is not available.',
      });
    }

    // Client Binding Check
    const effectiveClientId = typeof dto === 'object' ? dto.clientId : undefined;
    if (effectiveClientId && stored.clientId && stored.clientId !== effectiveClientId) {
      throw new NotFoundException({
        code: 'CREDENTIAL_NOT_AVAILABLE',
        message: 'Credential is not available.',
      });
    }

    // Job Binding Check
    const effectiveJobId = typeof dto === 'object' ? dto.jobId : undefined;
    if (stored.jobId && effectiveJobId && stored.jobId !== effectiveJobId) {
      throw new NotFoundException({
        code: 'CREDENTIAL_NOT_AVAILABLE',
        message: 'Credential is not available.',
      });
    }

    // Hard TTL Check
    if (Date.now() > stored.hardExpiresAt) {
      ClientUsersService.ephemeralCredentialStore.delete(eventId);
      throw new NotFoundException({
        code: 'CREDENTIAL_NOT_AVAILABLE',
        message: 'Credential is not available.',
      });
    }

    // One-time retrieval: evict immediately
    ClientUsersService.ephemeralCredentialStore.delete(eventId);

    return {
      oneTimeEventId: stored.oneTimeEventId,
      oneTimeEventIdHash: stored.oneTimeEventIdHash,
      username: stored.username,
      fullName: stored.fullName,
      password: stored.password || null,
      hardExpiresAt: new Date(stored.hardExpiresAt).toISOString(),
      displayDurationSeconds: stored.displayDurationSeconds,
      credentialDeliveryStatus: 'DELIVERED',
    };
  }

  public ackEphemeralCredential(
    dto: { oneTimeEventId?: string; oneTimeEventIdHash?: string; status?: string } | string,
    status?: string,
    user?: JwtPayload
  ): { success: boolean; acknowledged: boolean; oneTimeEventIdHash?: string } {
    let eventId: string | undefined;
    let eventIdHash: string | undefined;

    if (typeof dto === 'string') {
      eventId = dto;
    } else if (dto && typeof dto === 'object') {
      eventId = dto.oneTimeEventId;
      eventIdHash = dto.oneTimeEventIdHash;
    }

    if (eventId) {
      if (isValidOneTimeEventId(eventId)) {
        if (ClientUsersService.ephemeralCredentialStore.has(eventId)) {
          const stored = ClientUsersService.ephemeralCredentialStore.get(eventId);
          if (stored) {
            eventIdHash = stored.oneTimeEventIdHash;
          }
          ClientUsersService.ephemeralCredentialStore.delete(eventId);
        } else {
          eventIdHash = computeOneTimeEventIdHash(eventId);
        }
      }
    } else if (eventIdHash) {
      if (typeof eventIdHash === 'string' && eventIdHash.length === 64 && /^[a-f0-9]{64}$/i.test(eventIdHash) && eventIdHash !== SHA256_EMPTY_DIGEST) {
        for (const [id, item] of ClientUsersService.ephemeralCredentialStore.entries()) {
          if (item.oneTimeEventIdHash === eventIdHash) {
            ClientUsersService.ephemeralCredentialStore.delete(id);
            break;
          }
        }
      } else {
        eventIdHash = undefined;
      }
    }

    return {
      success: true,
      acknowledged: true,
      oneTimeEventIdHash: eventIdHash,
    };
  }

  /**
   * Retrieves live form dropdown options directly from the remote client Add User screen scoped by clientId, applicationVersion, and addUsersUrl.
   */
  async getLiveFormOptions(clientId: string, user: JwtPayload, refresh: boolean = false): Promise<ClientCreateFormMetadata> {
    if (!clientId || clientId.trim() === '') {
      throw new BadRequestException({
        code: 'CLIENT_ID_REQUIRED',
        message: 'Target client ID is required.',
      });
    }

    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    const version = client.applicationVersion || 'v9.4';
    const routes = this.resolveClientUserRoutes(client);
    const cacheKey = `${client.id}:${version}:${routes.resolvedAddUsersUrl}`;

    if (!refresh) {
      const cached = ClientUsersService.formOptionsCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 300000) {
        return cached.data;
      }
    }

    // Check online agents
    const allAgents = await this.agentsService.getAllAgents();
    const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
    if (onlineAgents.length === 0) {
      throw new BadRequestException({
        code: 'FORM_OPTIONS_UNAVAILABLE',
        message: 'Automation agent is offline. Unable to synchronize live client options.',
      });
    }

    // Decrypt credentials if stored
    let credentials: { username: string; password: string } | undefined = undefined;
    const cred = await this.credRepo.findOne({ where: { clientId, isActive: true } });
    if (cred) {
      const username = EnvelopeEncryption.decrypt({
        cipherText: cred.encryptedUsername,
        iv: cred.usernameIv,
        tag: cred.usernameTag,
        keyVersion: cred.keyVersion,
      });
      const password = EnvelopeEncryption.decrypt({
        cipherText: cred.encryptedPassword,
        iv: cred.passwordIv,
        tag: cred.passwordTag,
        keyVersion: cred.keyVersion,
      });
      credentials = { username, password };
    }

    const correlationId = crypto.randomUUID();
    const now = new Date();

    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: onlineAgents[0].id,
      triggeredByUserId: user.sub,
      runType: 'INSPECT_CREATE_FORM_METADATA',
      status: 'QUEUED',
      createdAt: now,
      parametersJson: JSON.stringify({
        taskType: 'INSPECT_CREATE_FORM_METADATA',
        userId: user.sub,
        clientBaseUrl: client.baseUrl,
        clientAppPath: client.applicationPath,
        loginRoute: routes.resolvedLoginUrl,
        targetRoute: routes.resolvedUsersUrl,
        addUsersRoute: '/addUsers',
        applicationVersion: version,
        credentials,
        createdEpochMs: Date.now(),
      }),
    });

    const savedRun = await this.runRepo.save(run);

    // Bounded execution wait up to 15s for headless option inspection
    const startTime = Date.now();
    let completedRun: AutomationRun | null = null;

    while (Date.now() - startTime < 15000) {
      await new Promise((r) => setTimeout(r, 200));
      const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
      if (r && ['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT'].includes(r.status)) {
        completedRun = r;
        break;
      }
    }

    if (!completedRun || !['COMPLETED', 'SUCCEEDED'].includes(completedRun.status)) {
      const errorMsg = completedRun?.errorMessage || 'Live form options could not be retrieved from the client portal.';
      throw new BadRequestException({
        code: 'FORM_OPTIONS_UNAVAILABLE',
        message: errorMsg,
      });
    }

    let resultData: any = null;
    try {
      resultData = JSON.parse(completedRun.resultSummaryJson || '{}');
    } catch {}

    if (!resultData || (!resultData.nationalities?.length && !resultData.roles?.length)) {
      throw new BadRequestException({
        code: 'FORM_OPTIONS_UNAVAILABLE',
        message: 'No live dropdown options were discovered on the client Add User form.',
      });
    }

    const metadata: ClientCreateFormMetadata = {
      clientId: client.id,
      applicationVersion: version,
      addUsersUrl: routes.resolvedAddUsersUrl,
      nationalities: resultData.nationalities || [],
      roles: resultData.roles || [],
      profileRoles: resultData.profileRoles || [],
      fieldMappings: resultData.fieldMappings,
    };

    ClientUsersService.formOptionsCache.set(cacheKey, { timestamp: Date.now(), data: metadata });

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'CLIENT_FORM_OPTIONS_SYNCHRONIZED',
        actorUserId: user.sub,
        actorUsername: user.username,
        entityType: 'CLIENT',
        entityId: clientId,
        result: 'SUCCESS',
        correlationId,
        detailsJson: JSON.stringify({
          clientCode: client.clientCode,
          nationalitiesCount: metadata.nationalities.length,
          rolesCount: metadata.roles.length,
          profileRolesCount: metadata.profileRoles.length,
          resolvedAddUsersUrl: routes.resolvedAddUsersUrl,
        }),
      })
    );

    return metadata;
  }

  /**
   * Formula injection defense: escapes values starting with =, +, -, @
   */
  private sanitizeCellValue(val: any): string {
    if (val === null || val === undefined) return '';
    const str = String(val).trim();
    if (str.startsWith('=') || str.startsWith('+') || str.startsWith('-') || str.startsWith('@')) {
      return `'${str}`;
    }
    return str;
  }

  /**
   * Generates Excel workbook (.xlsx) containing latest synced users and metadata for the selected client only.
   * Supports ALL_USERS (both ACTIVE and INACTIVE) or ACTIVE_ONLY modes.
   * Enforces count invariants and exports multi-sheet workbook with comprehensive Export Metadata.
   */
  async exportExcel(
    clientId: string,
    mode: 'ALL_USERS' | 'ACTIVE_ONLY' = 'ALL_USERS',
    user: JwtPayload
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (!clientId) throw new BadRequestException('Client ID is required for export');
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Not authorized to export data for this client');
    }

    // Query latest verified synced snapshot for this client
    const latestSyncRecord = await this.snapshotRepo
      .createQueryBuilder('u')
      .select('u.syncRunId', 'syncRunId')
      .addSelect('u.lastSyncedAt', 'lastSyncedAt')
      .where('u.clientId = :clientId AND u.isPresentRemotely = :isPresent AND u.syncRunId IS NOT NULL', {
        clientId,
        isPresent: true,
      })
      .orderBy('u.lastSyncedAt', 'DESC')
      .getRawOne();

    const latestSyncRunId = latestSyncRecord?.syncRunId;

    const baseQb = this.snapshotRepo
      .createQueryBuilder('u')
      .where('u.clientId = :clientId AND u.isPresentRemotely = :isPresent', { clientId, isPresent: true });

    if (latestSyncRunId) {
      baseQb.andWhere('u.syncRunId = :latestSyncRunId', { latestSyncRunId });
    }

    let allAvailableUsers = await baseQb.orderBy('u.fullName', 'ASC').getMany();

    // Fallback: If no users found with isPresentRemotely: true, query all records for this clientId
    if (allAvailableUsers.length === 0) {
      allAvailableUsers = await this.snapshotRepo.find({
        where: { clientId },
        order: { fullName: 'ASC' },
      });
    }

    const totalAvailable = allAvailableUsers.length;
    const availableActive = allAvailableUsers.filter((u) => u.status === 'ACTIVE').length;
    const availableInactive = allAvailableUsers.filter((u) => u.status === 'INACTIVE').length;

    // Filter exported users based on mode
    let exportedUsers: ClientUserSnapshot[];
    if (mode === 'ACTIVE_ONLY') {
      exportedUsers = allAvailableUsers.filter((u) => u.status === 'ACTIVE');
      // Invariant check: exportedRecordCount = activeUsers, and every row status = ACTIVE
      if (exportedUsers.length !== availableActive) {
        throw new BadRequestException({
          code: 'EXPORT_COUNT_MISMATCH',
          message: `Active export count mismatch: exported (${exportedUsers.length}) != active available (${availableActive})`,
        });
      }
      if (exportedUsers.some((u) => u.status !== 'ACTIVE')) {
        throw new BadRequestException({
          code: 'EXPORT_INTEGRITY_VIOLATION',
          message: 'Active Users Only export contains non-active records.',
        });
      }
    } else {
      exportedUsers = allAvailableUsers;
      // Invariant check: totalUsers = activeUsers + inactiveUsers
      if (exportedUsers.length !== availableActive + availableInactive) {
        throw new BadRequestException({
          code: 'EXPORT_COUNT_MISMATCH',
          message: `All users export count mismatch: total (${exportedUsers.length}) != active (${availableActive}) + inactive (${availableInactive})`,
        });
      }
    }

    const userRows = exportedUsers.map((u, idx) => ({
      'S.No': idx + 1,
      'Full Name': this.sanitizeCellValue(u.fullName),
      'Username': this.sanitizeCellValue(u.username),
      'Mobile Number': this.sanitizeCellValue(u.mobileNumber || ''),
      'Email': this.sanitizeCellValue(u.email || ''),
      'Nationality': this.sanitizeCellValue(u.nationality || ''),
      'Role': this.sanitizeCellValue(u.role || ''),
      'Profile Role': this.sanitizeCellValue(u.profileRole || ''),
      'Status': u.status,
      'Created Date/Time': u.remoteCreatedAt || 'N/A',
      'Updated Date/Time': u.remoteUpdatedAt || 'N/A',
      'Last Synced': u.lastSyncedAt?.toISOString() || new Date().toISOString(),
    }));

    const routes = this.resolveClientUserRoutes(client);
    const now = new Date();
    const snapshotTimestamp = allAvailableUsers[0]?.lastSyncedAt?.toISOString() || now.toISOString();

    const metadataRows = [
      { Property: 'Selected Client Code and Name', Value: `${client.clientCode} — ${client.clientName}` },
      { Property: 'Application Version', Value: client.applicationVersion || 'v9.4' },
      { Property: 'Export Mode', Value: mode },
      { Property: 'Total Available Users', Value: totalAvailable },
      { Property: 'Available Active Users', Value: availableActive },
      { Property: 'Available Inactive Users', Value: availableInactive },
      { Property: 'Exported Record Count', Value: exportedUsers.length },
      { Property: 'Snapshot Timestamp', Value: snapshotTimestamp },
      { Property: 'Export Timestamp', Value: now.toISOString() },
      { Property: 'Operator ID', Value: user.sub || user.username || 'OPERATOR' },
      { Property: 'Environment', Value: client.environment },
      { Property: 'Resolved Users Route', Value: routes.resolvedUsersUrl },
      {
        Property: 'Count Invariant Verification',
        Value:
          mode === 'ACTIVE_ONLY'
            ? `Exported (${exportedUsers.length}) = Active Available (${availableActive}) [All Status = ACTIVE]`
            : `Exported (${exportedUsers.length}) = Active (${availableActive}) + Inactive (${availableInactive})`,
      },
    ];

    const wb = XLSX.utils.book_new();
    const wsUsers = XLSX.utils.json_to_sheet(userRows);
    const wsMeta = XLSX.utils.json_to_sheet(metadataRows);

    XLSX.utils.book_append_sheet(wb, wsUsers, 'Users');
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Export Metadata');

    const timestamp = Date.now();
    const filename =
      mode === 'ACTIVE_ONLY'
        ? `${client.clientCode}_Active_Users_${timestamp}.xlsx`
        : `${client.clientCode}_All_Users_${timestamp}.xlsx`;

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'CLIENT_USERS_EXPORTED',
        actorUserId: user.sub,
        actorUsername: user.username,
        entityType: 'CLIENT',
        entityId: clientId,
        detailsJson: JSON.stringify({
          clientCode: client.clientCode,
          mode,
          filename,
          totalAvailable,
          availableActive,
          availableInactive,
          exportedCount: exportedUsers.length,
        }),
      })
    );

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return { buffer, filename };
  }

  /**
   * Generates a dynamic client-scoped Excel import template (.xlsx) using live form options.
   * Exactly 2 sheets: 'Users' (with 1 SAMPLE row, header formatting, and cell comments) and 'Dropdown Options'.
   */
  async getImportTemplate(clientId: string, user: JwtPayload): Promise<{ buffer: Buffer; filename: string }> {
    if (!clientId) {
      throw new BadRequestException({
        code: 'CLIENT_ID_REQUIRED',
        message: 'Client ID is required to generate import template.',
      });
    }

    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    let formMeta: ClientCreateFormMetadata;
    try {
      formMeta = await this.getLiveFormOptions(clientId, user, false);
    } catch (err: any) {
      throw new BadRequestException({
        code: 'FORM_OPTIONS_UNAVAILABLE',
        message: 'Live form options could not be retrieved from the client portal. Cannot generate template without live client options.',
      });
    }

    if (!formMeta || (!formMeta.nationalities?.length && !formMeta.roles?.length)) {
      throw new BadRequestException({
        code: 'FORM_OPTIONS_UNAVAILABLE',
        message: 'No live form dropdown options are available for this client.',
      });
    }

    const toLabel = (item: any) => (typeof item === 'string' ? item : item?.label || item?.value || '');
    const natList = (formMeta.nationalities || []).map(toLabel).filter(Boolean);
    const roleList = (formMeta.roles || []).map(toLabel).filter(Boolean);
    const profList = (formMeta.profileRoles || []).map(toLabel).filter(Boolean);

    const sampleNat = natList[0] || 'Saudi ( SAU )';
    const sampleRole1 = roleList.includes('Admin') ? 'Admin' : (roleList[0] || 'Admin');
    const multiCandidates = ['Admin', 'PHARMACY', 'Appointment'].filter(r => roleList.includes(r));
    const sampleMultiRole = multiCandidates.length >= 2 ? multiCandidates.join(',') : (roleList.slice(0, 3).join(',') || 'Admin,Appointment');

    // 1. Sheet 1: User Import (Headers in exact order: 9 columns, 2 SAMPLE rows, clean header formatting)
    const headers = [
      'S.No',
      'User Name',
      'First Name',
      'Middle Name',
      'Last Name',
      'Email',
      'Mobile No',
      'Nationality',
      'Role',
    ];

    const templateRows = [
      {
        'S.No': 'SAMPLE-1',
        'User Name': 'john.doe',
        'First Name': 'John',
        'Middle Name': 'A',
        'Last Name': 'Doe',
        'Email': 'john.doe@example.com',
        'Mobile No': '0501234567',
        'Nationality': sampleNat,
        'Role': sampleRole1,
      },
      {
        'S.No': 'SAMPLE-2',
        'User Name': 'jane.smith',
        'First Name': 'Jane',
        'Middle Name': 'B',
        'Last Name': 'Smith',
        'Email': 'jane.smith@example.com',
        'Mobile No': '0509876543',
        'Nationality': sampleNat,
        'Role': sampleMultiRole,
      },
    ];

    const wsUserImport = XLSX.utils.json_to_sheet(templateRows, { header: headers });

    // Set column widths
    wsUserImport['!cols'] = [
      { wch: 12 }, // S.No
      { wch: 22 }, // User Name
      { wch: 20 }, // First Name
      { wch: 16 }, // Middle Name
      { wch: 20 }, // Last Name
      { wch: 30 }, // Email
      { wch: 20 }, // Mobile No
      { wch: 28 }, // Nationality
      { wch: 35 }, // Role
    ];

    // Freeze top row
    wsUserImport['!views'] = [{ state: 'frozen', ySplit: 1 }];

    // Auto-filter
    wsUserImport['!autofilter'] = { ref: 'A1:I3' };

    const routes = this.resolveClientUserRoutes(client);

    // 2. Sheet 2: Instructions
    const instructionsData = [
      {
        'Topic / Field': 'User Name',
        'Requirement': 'Mandatory',
        'Rules & Guidelines': 'Alphanumeric characters, dot (.), dash (-), and underscore (_) only ([a-zA-Z0-9._-]). Maximum 50 characters. Must be unique per client. Mandatory field displayed in RED in template header.',
      },
      {
        'Topic / Field': 'First Name',
        'Requirement': 'Mandatory',
        'Rules & Guidelines': "User's given first name. Maximum 50 characters. Mandatory field displayed in RED in template header.",
      },
      {
        'Topic / Field': 'Middle Name',
        'Requirement': 'Optional',
        'Rules & Guidelines': "User's middle name or middle initial. Optional field displayed in normal dark font in template header.",
      },
      {
        'Topic / Field': 'Last Name',
        'Requirement': 'Mandatory',
        'Rules & Guidelines': "User's family or last name. Maximum 50 characters. Mandatory field displayed in RED in template header.",
      },
      {
        'Topic / Field': 'Email',
        'Requirement': 'Optional',
        'Rules & Guidelines': 'Valid RFC 5322 email address (e.g., user@domain.com). Optional field displayed in normal dark font in template header.',
      },
      {
        'Topic / Field': 'Mobile No',
        'Requirement': 'Mandatory',
        'Rules & Guidelines': 'Valid mobile phone number with digits and standard formatting. Mandatory field displayed in RED in template header.',
      },
      {
        'Topic / Field': 'Nationality',
        'Requirement': 'Mandatory',
        'Rules & Guidelines': "Must match an active nationality listed in the 'Nationalities' sheet. Matching is case-insensitive. Mandatory field displayed in RED in template header.",
      },
      {
        'Topic / Field': 'Role',
        'Requirement': 'Optional',
        'Rules & Guidelines': "Single role or comma-separated list of roles listed in the 'Roles' sheet. Optional field displayed in normal dark font in template header.",
      },
      {
        'Topic / Field': 'Single-Role Syntax',
        'Requirement': 'Usage Guide',
        'Rules & Guidelines': `Enter exactly one role name matching the 'Roles' sheet (e.g., "${sampleRole1}").`,
      },
      {
        'Topic / Field': 'Multi-Role Syntax',
        'Requirement': 'Usage Guide',
        'Rules & Guidelines': `Separate multiple roles using commas (e.g., "${sampleMultiRole}").`,
      },
      {
        'Topic / Field': 'Space Trimming',
        'Requirement': 'Engine Rule',
        'Rules & Guidelines': 'Leading and trailing spaces around role names, usernames, and values are automatically trimmed by the engine.',
      },
      {
        'Topic / Field': 'Case-Insensitive Validation',
        'Requirement': 'Engine Rule',
        'Rules & Guidelines': 'Role names and nationalities are matched case-insensitively against active client master records.',
      },
      {
        'Topic / Field': 'Duplicate Role Removal',
        'Requirement': 'Engine Rule',
        'Rules & Guidelines': 'Duplicate role entries within a comma-separated list are automatically deduplicated prior to provisioning.',
      },
      {
        'Topic / Field': 'Invalid Role Behavior',
        'Requirement': 'Error Policy',
        'Rules & Guidelines': 'Rows referencing invalid or unrecognized roles are rejected with INVALID_ROLE error in the validation preview.',
      },
      {
        'Topic / Field': 'Invalid Nationality Behavior',
        'Requirement': 'Error Policy',
        'Rules & Guidelines': 'Rows referencing invalid nationalities are rejected with INVALID_NATIONALITY error in the validation preview.',
      },
      {
        'Topic / Field': 'Sample-Row Behavior',
        'Requirement': 'Import Rule',
        'Rules & Guidelines': 'Sample rows (SAMPLE-1, SAMPLE-2) are provided for structural guidance only and are automatically excluded from import provisioning.',
      },
      {
        'Topic / Field': 'Client Mismatch Protection',
        'Requirement': 'Security Policy',
        'Rules & Guidelines': `This workbook is strictly scoped to Client ID ${client.id}. Uploading to any other client triggers CLIENT_MISMATCH rejection.`,
      },
      {
        'Topic / Field': 'Password Safety Invariant',
        'Requirement': 'Security Policy',
        'Rules & Guidelines': 'Passwords are NEVER stored in or imported via spreadsheet files. User credentials are created securely via central reset workflow.',
      },
      {
        'Topic / Field': 'No Blank Rows',
        'Requirement': 'Formatting Rule',
        'Rules & Guidelines': 'Do not include blank or empty rows between user records in the User Import sheet.',
      },
      {
        'Topic / Field': 'Do Not Rename Headers',
        'Requirement': 'Formatting Rule',
        'Rules & Guidelines': "Do not rename, remove, reorder, or modify column headers in row 1 of the 'User Import' sheet.",
      },
    ];

    const wsInstructions = XLSX.utils.json_to_sheet(instructionsData, {
      header: ['Topic / Field', 'Requirement', 'Rules & Guidelines'],
    });
    wsInstructions['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 85 }];
    wsInstructions['!views'] = [{ state: 'frozen', ySplit: 1 }];

    // 3. Sheet 3: Nationalities
    const nationalities = Array.from(
      new Set(
        (formMeta.nationalities || [])
          .map((n: any) => (typeof n === 'string' ? n : n?.label || n?.value || '').trim())
          .filter((n) => n && !n.toLowerCase().includes('select'))
      )
    );

    const nationalitiesRows = nationalities.map((n) => {
      const orig = (formMeta.nationalities || []).find((raw: any) => (typeof raw === 'string' ? raw : raw?.label || raw?.value || '') === n);
      return {
        'Nationality': n,
        'Code': (typeof orig === 'object' && orig?.value) ? orig.value : '',
        'Status': 'ACTIVE',
      };
    });

    const wsNationalities = XLSX.utils.json_to_sheet(nationalitiesRows.length > 0 ? nationalitiesRows : [{ 'Nationality': 'Saudi ( SAU )', 'Code': 'SAU', 'Status': 'ACTIVE' }], {
      header: ['Nationality', 'Code', 'Status'],
    });
    wsNationalities['!cols'] = [{ wch: 35 }, { wch: 15 }, { wch: 15 }];
    wsNationalities['!views'] = [{ state: 'frozen', ySplit: 1 }];
    wsNationalities['!autofilter'] = { ref: `A1:C${Math.max(2, nationalitiesRows.length + 1)}` };

    // 4. Sheet 4: Roles (Selected client-specific roles extracted from Role Master / live options)
    const roles = Array.from(
      new Set(
        (formMeta.roles || [])
          .map((r: any) => (typeof r === 'string' ? r : r?.label || r?.value || '').trim())
          .filter((r) => r && !r.toLowerCase().includes('select'))
      )
    );

    const clientRolesRows = roles.map((r) => {
      const orig: any = (formMeta.roles || []).find((raw: any) => (typeof raw === 'string' ? raw : raw?.label || raw?.value || '') === r);
      return {
        'Role Name': r,
        'Role ID': orig?.roleId || orig?.value || '',
        'Description': orig?.description || '',
        'Status': 'ACTIVE',
      };
    });

    const wsRoles = XLSX.utils.json_to_sheet(clientRolesRows.length > 0 ? clientRolesRows : [{ 'Role Name': 'Standard User', 'Role ID': '', 'Description': '', 'Status': 'ACTIVE' }], {
      header: ['Role Name', 'Role ID', 'Description', 'Status'],
    });
    wsRoles['!cols'] = [{ wch: 40 }, { wch: 20 }, { wch: 45 }, { wch: 15 }];
    wsRoles['!views'] = [{ state: 'frozen', ySplit: 1 }];
    wsRoles['!autofilter'] = { ref: `A1:D${Math.max(2, clientRolesRows.length + 1)}` };

    // 5. Sheet 5: Template Info (Client identification metadata without credentials)
    const templateInfoRows = [
      ['Property', 'Value'],
      ['Client ID', client.id],
      ['Client Code', client.clientCode],
      ['Client Name', client.clientName],
      ['Base URL', client.baseUrl],
      ['Resolved Role Master URL', routes.resolvedRoleUrl],
      ['Resolved Add Users URL', routes.resolvedAddUsersUrl || ''],
      ['Selector Profile Version', (client as any).selectorProfileVersion || client.applicationVersion || 'v9.3'],
      ['Template Generation Timestamp', new Date().toISOString()],
      ['Extracted Roles Count', String(roles.length)],
      ['Extracted Nationalities Count', String(nationalities.length)],
      ['Security Notice', `This template is strictly scoped to Client ID ${client.id}. No secrets, credentials, tokens, or passwords are stored in this workbook. Cross-client import is prohibited.`],
    ];
    const wsTemplateInfo = XLSX.utils.aoa_to_sheet(templateInfoRows);
    wsTemplateInfo['!cols'] = [{ wch: 30 }, { wch: 90 }];
    wsTemplateInfo['!views'] = [{ state: 'frozen', ySplit: 1 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsUserImport, 'User Import');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');
    XLSX.utils.book_append_sheet(wb, wsNationalities, 'Nationalities');
    XLSX.utils.book_append_sheet(wb, wsRoles, 'Roles');
    XLSX.utils.book_append_sheet(wb, wsTemplateInfo, 'Template Info');

    wb.Props = {
      Title: 'HMC User Import Template',
      Subject: client.id,
      Company: client.clientName,
      Author: 'Central Console User Management',
    };

    const rawBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const buffer = this.applyHeaderStylesToXlsx(rawBuffer);
    const filename = `${client.clientCode}_User_Import_Template_${Date.now()}.xlsx`;

    return { buffer, filename };
  }

  /**
   * Applies red font (#C00000) to mandatory column headers and dark bold font (#1E293B) to optional headers
   * with a consistent neutral background fill (#F1F5F9) for all columns in the User Import sheet.
   */
  private applyHeaderStylesToXlsx(xlsxBuf: Buffer): Buffer {
    try {
      const entries: Record<string, any> = {};
      let offset = 0;
      while (offset < xlsxBuf.length - 4) {
        const sig = xlsxBuf.readUInt32LE(offset);
        if (sig === 0x04034b50) {
          const method = xlsxBuf.readUInt16LE(offset + 8);
          const modTime = xlsxBuf.readUInt16LE(offset + 10);
          const modDate = xlsxBuf.readUInt16LE(offset + 12);
          const compSize = xlsxBuf.readUInt32LE(offset + 18);
          const nameLen = xlsxBuf.readUInt16LE(offset + 26);
          const extraLen = xlsxBuf.readUInt16LE(offset + 28);
          const name = xlsxBuf.toString('utf8', offset + 30, offset + 30 + nameLen);
          const dataStart = offset + 30 + nameLen + extraLen;
          const compData = xlsxBuf.subarray(dataStart, dataStart + compSize);
          let data: Buffer;
          if (method === 8) {
            data = zlib.inflateRawSync(compData);
          } else if (method === 0) {
            data = compData;
          } else {
            return xlsxBuf;
          }
          entries[name] = { name, data, modTime, modDate };
          offset = dataStart + compSize;
        } else if (sig === 0x02014b50 || sig === 0x06054b50) {
          break;
        } else {
          offset++;
        }
      }

      if (!entries['xl/styles.xml'] || !entries['xl/worksheets/sheet1.xml']) return xlsxBuf;

      // 1. Add red (#C00000) and dark (#1E293B) fonts + neutral fill (#F1F5F9) + style XFs to styles.xml
      let stylesXml = entries['xl/styles.xml'].data.toString('utf8');
      stylesXml = stylesXml.replace(
        /<fonts count="[^"]*">[\s\S]*?<\/fonts>/,
        '<fonts count="3"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="11"/><color rgb="FF1E293B"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>'
      );
      stylesXml = stylesXml.replace(
        /<fills count="[^"]*">[\s\S]*?<\/fills>/,
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill></fills>'
      );
      stylesXml = stylesXml.replace(
        /<cellXfs count="[^"]*">[\s\S]*?<\/cellXfs>/,
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
      );
      entries['xl/styles.xml'].data = Buffer.from(stylesXml, 'utf8');

      // 2. Style row 1 of Sheet 1: Mandatory headers get s="1" (Red + Neutral Fill), optional headers get s="2" (Dark + Neutral Fill)
      const mandatoryHeaders = ['user name', 'first name', 'last name', 'mobile no', 'nationality'];
      let sheetXml = entries['xl/worksheets/sheet1.xml'].data.toString('utf8');
      sheetXml = sheetXml.replace(/<row r="1">([\s\S]*?)<\/row>/, (match: string, cellsXml: string) => {
        const styledCells = cellsXml.replace(/<c r="([A-Z]+1)"([^>]*)>(<v>([^<]*)<\/v>)<\/c>/g, (cellMatch: string, ref: string, attrs: string, valTag: string, text: string) => {
          const norm = text.toLowerCase().replace(/\*/g, '').trim();
          const isMandatory = mandatoryHeaders.includes(norm);
          const styleId = isMandatory ? '1' : '2';
          return `<c r="${ref}" s="${styleId}" t="str">${valTag}</c>`;
        });
        return `<row r="1">${styledCells}</row>`;
      });
      entries['xl/worksheets/sheet1.xml'].data = Buffer.from(sheetXml, 'utf8');

      // CRC32 table
      const crcTable: number[] = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        crcTable[n] = c;
      }

      const fileHeaders: Buffer[] = [];
      const centralHeaders: Buffer[] = [];
      let zipOffset = 0;

      for (const name of Object.keys(entries)) {
        const entry = entries[name];
        const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
        const compData = zlib.deflateRawSync(dataBuf);
        const nameBuf = Buffer.from(name, 'utf8');

        let crc = 0 ^ (-1);
        for (let i = 0; i < dataBuf.length; i++) {
          crc = (crc >>> 8) ^ crcTable[(crc ^ dataBuf[i]) & 0xFF];
        }
        crc = (crc ^ (-1)) >>> 0;

        const local = Buffer.alloc(30 + nameBuf.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(8, 8);
        local.writeUInt16LE(entry.modTime || 0, 10);
        local.writeUInt16LE(entry.modDate || 0, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compData.length, 18);
        local.writeUInt32LE(dataBuf.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        nameBuf.copy(local, 30);

        fileHeaders.push(local, compData);

        const central = Buffer.alloc(46 + nameBuf.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(entry.modTime || 0, 12);
        central.writeUInt16LE(entry.modDate || 0, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compData.length, 20);
        central.writeUInt32LE(dataBuf.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(zipOffset, 42);
        nameBuf.copy(central, 46);

        centralHeaders.push(central);
        zipOffset += local.length + compData.length;
      }

      const centralOffset = zipOffset;
      const centralBuf = Buffer.concat(centralHeaders);
      const centralSize = centralBuf.length;

      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(0, 4);
      eocd.writeUInt16LE(0, 6);
      eocd.writeUInt16LE(Object.keys(entries).length, 8);
      eocd.writeUInt16LE(Object.keys(entries).length, 10);
      eocd.writeUInt32LE(centralSize, 12);
      eocd.writeUInt32LE(centralOffset, 16);
      eocd.writeUInt16LE(0, 20);

      return Buffer.concat([...fileHeaders, centralBuf, eocd]);
    } catch {
      return xlsxBuf;
    }
  }

  /**
   * Dry-run preview of Excel user import with live client option validation, S.No duplicate checks, and ALREADY_EXISTS detection.
   */
  async importPreview(clientId: string, fileBuffer: Buffer, user: JwtPayload): Promise<ExcelUserImportPreviewResult> {
    if (!clientId) throw new BadRequestException('Client ID is required');
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(fileBuffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException({
        code: 'INVALID_EXCEL_FORMAT',
        message: 'Uploaded file is not a valid Excel (.xlsx) workbook.',
      });
    }

    // Client mismatch verification
    let fileClientId: string | undefined;
    const metaSheetName = wb.SheetNames.find((s) => ['template info', 'metadata', 'info'].includes(s.toLowerCase()));
    if (metaSheetName) {
      const infoRows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[metaSheetName], { header: 1 });
      for (const row of infoRows) {
        if (Array.isArray(row)) {
          const key = String(row[0] || '').trim().toLowerCase();
          const val = String(row[1] || '').trim();
          if (['client id', 'client_id', 'clientid'].includes(key) && val) {
            fileClientId = val;
            break;
          }
        }
      }
    }
    if (!fileClientId && wb.Props && (wb.Props as any).Subject) {
      fileClientId = (wb.Props as any).Subject;
    }

    if (fileClientId && fileClientId !== clientId) {
      throw new BadRequestException({
        code: 'CLIENT_MISMATCH',
        status: 'CLIENT_MISMATCH',
        message: 'The Excel template was generated for a different client.',
        details: {
          fileClientId,
          expectedClientId: clientId,
        },
      });
    }

    const sheetName = wb.SheetNames.find((s) => ['user import', 'users'].includes(s.toLowerCase())) || wb.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException({
        code: 'INVALID_EXCEL_FORMAT',
        message: 'Excel workbook contains no sheets.',
      });
    }

    const rawRows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
    if (rawRows.length === 0) {
      throw new BadRequestException({
        code: 'INVALID_EXCEL_FORMAT',
        message: 'Excel Users sheet contains no data rows.',
      });
    }

    // Fetch existing client snapshot users for duplicate / already exists checks
    const existingUsers = await this.snapshotRepo.find({ where: { clientId } });
    const existingUsernamesMap = new Map<string, ClientUserSnapshot>();
    const existingNamesMap = new Map<string, ClientUserSnapshot>();
    for (const u of existingUsers) {
      existingUsernamesMap.set(u.username.toLowerCase().trim(), u);
      const key = `${(u.firstName || '').toLowerCase().trim()}_${(u.lastName || '').toLowerCase().trim()}`;
      existingNamesMap.set(key, u);
    }

    // Fetch live options for dropdown validation
    let liveOptions = { nationalities: [] as string[], roles: [] as string[], profileRoles: [] as string[] };
    let rawProfileRoles: any[] = [];
    try {
      const meta = await this.getLiveFormOptions(clientId, user, false);
      const toLabel = (item: any) => (typeof item === 'string' ? item : item?.label || item?.value || '');
      rawProfileRoles = meta.profileRoles || [];
      liveOptions = {
        nationalities: (meta.nationalities || []).map(toLabel).filter(Boolean),
        roles: (meta.roles || []).map(toLabel).filter(Boolean),
        profileRoles: (meta.profileRoles || []).map(toLabel).filter(Boolean),
      };
    } catch {}

    const normNatSet = new Set(liveOptions.nationalities.map((n) => n.toLowerCase().trim()));
    const normRoleSet = new Set(liveOptions.roles.map((r) => r.toLowerCase().trim()));
    const normProfSet = new Set(liveOptions.profileRoles.map((p) => p.toLowerCase().trim()));

    const seenUsernamesInFile = new Set<string>();
    const seenSerialNumbersInFile = new Set<string>();
    const previewRows: ExcelUserImportRow[] = [];

    let readyCount = 0;
    let warningCount = 0;
    let alreadyExistingCount = 0;
    let errorCount = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 2; // Excel row index (header is row 1)

      const rawSNo = row['S.No'] ?? row['S.no'] ?? row['s.no'] ?? row['SNo'] ?? row['sno'] ?? row['Serial Number'] ?? row['SI.No'];

      // Extract and sanitize cells (formula injection defense)
      const action: UserImportAction = (row['Action'] || row['action'] || 'CREATE').toString().toUpperCase().trim() as any;
      const rawUser = (row['User Name *'] || row['User Name'] || row['UserName'] || row['username'] || '').toString().trim();
      const rawFirst = (row['First Name *'] || row['First Name'] || row['FirstName'] || row['firstName'] || '').toString().trim();
      const rawMiddle = (row['Middle Name'] || row['MiddleName'] || row['middleName'] || '').toString().trim();
      const rawLast = (row['Last Name *'] || row['Last Name'] || row['LastName'] || row['lastName'] || '').toString().trim();
      const rawNick = (row['Nick Name'] || row['NickName'] || row['nickName'] || '').toString().trim();
      const rawEmail = (row['Email *'] || row['Email'] || row['email'] || '').toString().trim();
      const rawMobile = (row['Mobile No *'] || row['Mobile No'] || row['Mobile Number'] || row['Mobile'] || row['mobileNumber'] || '').toString().trim();
      const rawNat = (row['Nationality *'] || row['Nationality'] || row['nationality'] || '').toString().trim();
      const rawRole = (row['Role(s) *'] || row['Role(s)'] || row['Roles *'] || row['Roles'] || row['Role *'] || row['Role'] || row['role'] || '').toString().trim();
      const rawProfile = (row['Profile Role'] || row['ProfileRole'] || row['profileRole'] || '').toString().trim();
      const rawBarcode = (row['Barcode No'] || row['Barcode Number'] || row['barcodeNumber'] || '').toString().trim();
      const rawStatus = (row['Status'] || row['Requested Status'] || 'ACTIVE').toString().toUpperCase().trim() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

      // Ignore unchanged SAMPLE rows (e.g. SAMPLE, SAMPLE-1, SAMPLE-2)
      const upperSNo = String(rawSNo ?? '').toUpperCase().trim();
      const isSampleSNo = upperSNo.startsWith('SAMPLE');
      const lowerUser = rawUser.toLowerCase();
      const isSampleUser = ['sample.user', 'sample_user', 'john.doe', 'jane.smith'].includes(lowerUser);
      if (isSampleSNo || (isSampleUser && ['sample', 'john', 'jane'].includes(rawFirst.toLowerCase()))) {
        continue;
      }

      // Skip ONLY if completely empty row (no S.No and no user/name fields)
      if (rawSNo === undefined && !rawUser && !rawFirst && !rawLast && !rawMobile && !rawNat) {
        continue;
      }

      const parsedSNo = rawSNo !== undefined && rawSNo !== '' ? rawSNo : i + 1;
      const username = this.sanitizeCellValue(rawUser);
      const firstName = this.sanitizeCellValue(rawFirst);
      const middleName = rawMiddle ? this.sanitizeCellValue(rawMiddle) : undefined;
      const lastName = this.sanitizeCellValue(rawLast);
      const nickName = rawNick ? this.sanitizeCellValue(rawNick) : undefined;
      const email = rawEmail ? this.sanitizeCellValue(rawEmail) : undefined;
      const mobileNumber = rawMobile ? this.sanitizeCellValue(rawMobile) : undefined;
      const nationality = rawNat ? this.sanitizeCellValue(rawNat) : undefined;
      const role = rawRole ? this.sanitizeCellValue(rawRole) : undefined;
      const profileRole = rawProfile ? this.sanitizeCellValue(rawProfile) : undefined;
      const barcodeNumber = rawBarcode ? this.sanitizeCellValue(rawBarcode) : undefined;

      const validationErrors: string[] = [];
      let classification: UserImportClassification = 'READY';
      let errorCode: string | undefined = undefined;
      let potentialDuplicateOf: any = undefined;
      let existingStatus: ClientUserStatus | undefined = undefined;

      // Duplicate S.No check
      if (rawSNo !== undefined && rawSNo !== '') {
        const normSNo = String(rawSNo).trim();
        if (seenSerialNumbersInFile.has(normSNo)) {
          validationErrors.push(`Duplicate S.No '${normSNo}' appears multiple times in the file`);
          classification = 'INVALID';
          errorCode = 'DUPLICATE_SERIAL_NUMBER';
        } else {
          seenSerialNumbersInFile.add(normSNo);
        }
      }

      const normUser = username.toLowerCase().trim();

      // Required field validation
      if (!username) {
        validationErrors.push('User Name is required');
        classification = 'INVALID';
        errorCode = errorCode || 'REQUIRED_FIELD_MISSING';
      }
      if (!firstName) {
        validationErrors.push('First Name is required');
        classification = 'INVALID';
        errorCode = errorCode || 'REQUIRED_FIELD_MISSING';
      }
      if (!lastName) {
        validationErrors.push('Last Name is required');
        classification = 'INVALID';
        errorCode = errorCode || 'REQUIRED_FIELD_MISSING';
      }
      if (!mobileNumber) {
        validationErrors.push('Mobile No is required');
        classification = 'INVALID';
        errorCode = errorCode || 'REQUIRED_FIELD_MISSING';
      }
      if (!nationality) {
        validationErrors.push('Nationality is required');
        classification = 'INVALID';
        errorCode = errorCode || 'REQUIRED_FIELD_MISSING';
      }

      // Username character validation
      if (username && !/^[a-zA-Z0-9._-]+$/.test(username)) {
        validationErrors.push('Username contains invalid characters (alphanumeric, ., _, - only)');
        classification = 'INVALID';
        errorCode = errorCode || 'INVALID_FIELD_FORMAT';
      }

      // Email format validation
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        validationErrors.push('Invalid email format');
        classification = 'INVALID';
        errorCode = errorCode || 'INVALID_FIELD_FORMAT';
      }

      // Dropdown option validation against live options
      if (nationality && normNatSet.size > 0 && !normNatSet.has(nationality.toLowerCase())) {
        validationErrors.push(`Nationality '${nationality}' is not in the client's live options`);
        classification = 'INVALID';
        errorCode = errorCode || 'REMOTE_DROPDOWN_OPTION_NOT_FOUND';
      }

      // Parse and validate roles (supporting single roles, comma-separated multiple roles, quotes, whitespace, canonical casing)
      const parsedRoleResult = parseAndValidateRoles(rawRole, liveOptions.roles);
      const canonicalRoleStr = parsedRoleResult.canonicalRoleString || (role ? role : undefined);
      const rolesArray = parsedRoleResult.validRoles.length > 0
        ? parsedRoleResult.validRoles
        : (parsedRoleResult.parsedRoles.length > 0 ? parsedRoleResult.parsedRoles : (role ? [role] : []));

      if (!parsedRoleResult.isValid && parsedRoleResult.invalidRoles.length > 0) {
        for (const invalidRole of parsedRoleResult.invalidRoles) {
          validationErrors.push(`Role '${invalidRole}' is not in the client's live options`);
        }
        classification = 'INVALID';
        errorCode = errorCode || 'REMOTE_DROPDOWN_OPTION_NOT_FOUND';
      }

      // Check if role genuinely requires profile role
      if (rolesArray.length > 0 && rawProfileRoles.length > 0) {
        const hasDependent = rolesArray.some((r) => {
          const dependentProfileRoles = rawProfileRoles.filter((pr: any) => {
            const parent = typeof pr === 'object' && pr?.roleDependency ? pr.roleDependency : '';
            return parent && parent.toLowerCase().trim() === r.toLowerCase().trim();
          });
          return dependentProfileRoles.length > 0;
        });
        if (hasDependent && !profileRole) {
          validationErrors.push('REMOTE_REQUIRED_FIELD_UNSUPPORTED — Selected Role requires Profile Role.');
          classification = 'INVALID';
          errorCode = errorCode || 'REMOTE_REQUIRED_FIELD_UNSUPPORTED';
        }
      }

      if (profileRole && normProfSet.size > 0 && !normProfSet.has(profileRole.toLowerCase())) {
        validationErrors.push(`Profile Role '${profileRole}' is not in the client's live options`);
        classification = 'INVALID';
        errorCode = errorCode || 'REMOTE_DROPDOWN_OPTION_NOT_FOUND';
      }

      // Duplicate username in file check
      if (normUser && seenUsernamesInFile.has(normUser)) {
        validationErrors.push(`Duplicate username '${username}' appears multiple times in the file`);
        classification = 'DUPLICATE';
        errorCode = errorCode || 'DUPLICATE_USERNAME_IN_FILE';
      }
      if (normUser) seenUsernamesInFile.add(normUser);

      // Existing client snapshot username check -> ALREADY_EXISTS classification
      const existingSnapshot = normUser ? existingUsernamesMap.get(normUser) : undefined;
      if (existingSnapshot) {
        existingStatus = existingSnapshot.status;
        validationErrors.push(`User '${username}' already exists in client portal (${existingStatus})`);
        classification = 'ALREADY_EXISTS';
        errorCode = 'ALREADY_EXISTS';
      }

      // Potential duplicate full name warning check (only if not already an error or already existing)
      if (firstName && lastName && classification === 'READY') {
        const nameKey = `${firstName.toLowerCase()}_${lastName.toLowerCase()}`;
        const match = existingNamesMap.get(nameKey);
        if (match) {
          validationErrors.push(`Potential duplicate name: matches existing user '${match.fullName}' (${match.username})`);
          classification = 'WARNING_REQUIRES_CONFIRMATION';
          errorCode = 'POTENTIAL_DUPLICATE_NAME';
          potentialDuplicateOf = {
            username: match.username,
            fullName: match.fullName,
            mobileNumber: match.mobileNumber || undefined,
            status: match.status,
          };
        }
      }

      if (classification === 'READY') {
        readyCount++;
      } else if (classification === 'WARNING_REQUIRES_CONFIRMATION') {
        warningCount++;
      } else if (classification === 'ALREADY_EXISTS') {
        alreadyExistingCount++;
      } else {
        errorCount++;
      }

      previewRows.push({
        sNo: parsedSNo,
        rowNumber: rowNum,
        action,
        username,
        firstName,
        middleName,
        lastName,
        nickName,
        email,
        mobileNumber,
        nationality,
        role: canonicalRoleStr,
        roles: rolesArray,
        parsedRoles: parsedRoleResult.parsedRoles,
        validRoles: parsedRoleResult.validRoles,
        invalidRoles: parsedRoleResult.invalidRoles,
        profileRole,
        barcodeNumber,
        requestedStatus: rawStatus as ClientUserStatus,
        existingStatus,
        classification,
        validationErrors,
        errorCode,
        message: validationErrors.join('; ') || 'Row passed validation checks',
        isApproved: classification === 'READY' || classification === 'WARNING_REQUIRES_CONFIRMATION',
        potentialDuplicateOf,
      });
    }

    return {
      totalRows: previewRows.length,
      readyRows: readyCount,
      warningRows: warningCount,
      alreadyExistingRows: alreadyExistingCount,
      errorRows: errorCount,
      rows: previewRows,
      liveClientOptions: {
        nationalities: liveOptions.nationalities,
        roles: liveOptions.roles,
        profileRoles: liveOptions.profileRoles,
      },
    };
  }

  /**
   * Maps roles for a client user on /addUserRole screen.
   */
  async mapUserRoles(
    dto: {
      clientId: string;
      username: string;
      fullName?: string;
      firstName?: string;
      remoteUserId?: string;
      roles: string[];
    },
    user: JwtPayload
  ): Promise<any> {
    const client = await this.clientRepo.findOne({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException(`Client ${dto.clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(dto.clientId)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    if ((client.environment as string).toUpperCase() === 'PRODUCTION') {
      throw new ForbiddenException({
        code: 'PRODUCTION_MUTATION_BLOCKED',
        message: `Role mapping is strictly blocked for PRODUCTION client '${client.clientCode}'.`,
      });
    }

    const onlineAgents = (await this.agentsService.getAllAgents()).filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
    if (onlineAgents.length === 0) {
      throw new BadRequestException('Role mapping failed: Automation agent is offline.');
    }

    let credentials: { username: string; password: string } | undefined = undefined;
    const cred = await this.credRepo.findOne({ where: { clientId: dto.clientId, isActive: true } });
    if (cred) {
      const username = EnvelopeEncryption.decrypt({
        cipherText: cred.encryptedUsername,
        iv: cred.usernameIv,
        tag: cred.usernameTag,
        keyVersion: cred.keyVersion,
      });
      const password = EnvelopeEncryption.decrypt({
        cipherText: cred.encryptedPassword,
        iv: cred.passwordIv,
        tag: cred.passwordTag,
        keyVersion: cred.keyVersion,
      });
      credentials = { username, password };
    }

    const routes = this.resolveClientUserRoutes(client);
    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: onlineAgents[0].id,
      triggeredByUserId: user.sub,
      runType: 'MAP_USER_ROLES',
      status: 'PENDING',
      parametersJson: JSON.stringify({
        taskType: 'MAP_USER_ROLES',
        userId: user.sub,
        clientId: client.id,
        clientBaseUrl: client.baseUrl,
        clientAppPath: client.applicationPath,
        loginRoute: routes.resolvedLoginUrl,
        targetRoute: routes.resolvedUsersUrl,
        userRoleRoute: routes.resolvedRoleUrl,
        credentials,
        payload: {
          username: dto.username,
          fullName: dto.fullName,
          firstName: dto.firstName,
          remoteUserId: dto.remoteUserId,
          roles: dto.roles,
        },
      }),
    });

    const savedRun = await this.runRepo.save(run);

    const startTime = Date.now();
    let completedRun: AutomationRun | null = null;
    while (Date.now() - startTime < 30000) {
      await new Promise((r) => setTimeout(r, 300));
      const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
      if (r && (['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'] as any).includes(r.status)) {
        completedRun = r;
        break;
      }
    }

    if (!completedRun) {
      savedRun.status = 'TIMED_OUT';
      savedRun.errorMessage = 'Role mapping timed out: Automation agent did not respond within 30 seconds.';
      await this.runRepo.save(savedRun).catch(() => {});
      return {
        success: false,
        username: dto.username,
        errorCode: 'OPERATION_TIMED_OUT',
        errorMessage: 'Role mapping timed out: Automation agent did not respond within 30 seconds.',
        failureReason: 'Role mapping timed out',
        retryStartingPoint: 'ROLE_STATE_INSPECTION',
      };
    }

    let parsedResult: any = {};
    try {
      parsedResult = JSON.parse(completedRun.resultSummaryJson || '{}');
    } catch {}

    if (completedRun.status === 'COMPLETED' || completedRun.status === 'SUCCEEDED') {
      return {
        success: true,
        ...parsedResult,
      };
    }

    return {
      success: false,
      username: dto.username,
      errorCode: parsedResult.errorCode || 'ROLE_UPDATE_FAILED',
      errorMessage: parsedResult.errorMessage || completedRun.errorMessage || 'Role mapping failed on client portal.',
      failureReason: parsedResult.failureReason || parsedResult.errorMessage || completedRun.errorMessage || 'Role mapping failed',
      userSearchState: parsedResult.userSearchState,
      roleSelectionState: parsedResult.roleSelectionState,
      roleUpdateState: parsedResult.roleUpdateState,
      roleVerificationState: parsedResult.roleVerificationState,
      requestedRoles: parsedResult.requestedRoles || dto.roles,
      mappedRoles: parsedResult.mappedRoles || [],
      missingRoles: parsedResult.missingRoles || dto.roles,
      roleSelectionProgress: parsedResult.roleSelectionProgress,
      retryStartingPoint: 'ROLE_STATE_INSPECTION',
    };
  }

  /**
   * Executes approved import rows sequentially with safe single-flight mutations.
   * Continues to next user on row failure; pauses batch on system infrastructure errors.
   * Enforces: Total = Completed + FailedBeforeCreation + UserCreatedRolePending + AlreadyExisting + Invalid + Skipped + RemainingUnprocessed.
   */
  async importExecute(clientId: string, rows: ExcelUserImportRow[], user: JwtPayload): Promise<ExcelUserImportExecutionSummary> {
    if (!clientId) throw new BadRequestException('Client ID is required');
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    // Production mutation safeguard
    if (client.environment?.toUpperCase() === 'PRODUCTION') {
      throw new BadRequestException({
        code: 'PRODUCTION_MUTATION_BLOCKED',
        message: 'Bulk user mutations on PRODUCTION clients are strictly prohibited.',
      });
    }

    const jobId = `usr_imp_${Date.now()}`;
    const results: ExcelUserImportExecutionRowResult[] = [];
    const ephemeralCredentialsList: UserEphemeralCredentialEvent[] = [];

    const hasCredentialViewPermission = Boolean(
      user.isSuperAdmin ||
      (user.permissions && (
        user.permissions.includes('client_user.credential_view') ||
        user.permissions.includes(PERMISSIONS.CLIENT_USER_CREDENTIAL_VIEW as any) ||
        user.permissions.includes('CLIENT_USER_CREDENTIAL_VIEW' as any)
      ))
    );

    let completedCount = 0;
    let failedBeforeCreationCount = 0;
    let userCreatedRolePendingCount = 0;
    let alreadyExistingCount = 0;
    let invalidCount = 0;
    let cancelledCount = 0;
    let notProcessedCount = 0;
    let remainingUnprocessedCount = 0;

    let systemPaused = false;
    let systemPauseReason: string | undefined = undefined;
    let lastSuccessfulUser: string | undefined = undefined;
    let currentFailedUser: string | undefined = undefined;
    let consecutiveInfrastructureFailures = 0;
    const MAX_CONSECUTIVE_INFRASTRUCTURE_FAILURES = 3;

    // Load existing snapshot users to look up status for already existing rows
    const existingUsers = await this.snapshotRepo.find({ where: { clientId } });
    const existingUserMap = new Map<string, ClientUserSnapshot>();
    for (const u of existingUsers) {
      existingUserMap.set(u.username.toLowerCase().trim(), u);
    }

    let liveOptions: ClientCreateFormMetadata | null = null;
    try {
      liveOptions = await this.getLiveFormOptions(clientId, user, false);
    } catch {}

    const liveRoleNames = (liveOptions?.roles || []).map((r: any) => (typeof r === 'string' ? r : r.label || r.value || ''));

    const pendingReconciliationRows: { row: ExcelUserImportRow; resultIndex: number }[] = [];

    for (const row of rows) {
      const rowCorrelationId = crypto.randomUUID();
      const fullName = `${row.firstName || ''} ${row.lastName || ''}`.trim();
      const sNo = row.sNo !== undefined ? row.sNo : row.rowNumber - 1;

      // If batch was paused due to system error, mark remaining rows as NOT_PROCESSED
      if (systemPaused) {
        remainingUnprocessedCount++;
        results.push({
          sNo,
          rowNumber: row.rowNumber,
          action: row.action,
          username: row.username,
          fullName,
          result: 'NOT_PROCESSED',
          overallStatus: 'NOT_PROCESSED',
          errorCode: 'BATCH_PAUSED_SYSTEM_ERROR',
          message: systemPauseReason || 'Batch paused due to system infrastructure failure.',
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
          retryStartingPoint: row.retryStartingPoint || 'USER_CREATION',
          nextAction: 'Batch paused',
        });
        continue;
      }

      // Check ALREADY_EXISTS first
      if (row.classification === 'ALREADY_EXISTS' || row.errorCode === 'ALREADY_EXISTS') {
        const snap = existingUserMap.get((row.username || '').toLowerCase().trim());
        const currentStatus = row.existingStatus || snap?.status || 'ACTIVE';
        alreadyExistingCount++;
        results.push({
          sNo,
          rowNumber: row.rowNumber,
          action: row.action,
          username: row.username,
          fullName,
          result: 'ALREADY_EXISTS',
          overallStatus: 'COMPLETED',
          errorCode: 'ALREADY_EXISTS',
          existingStatus: currentStatus,
          remoteStatus: currentStatus,
          message: `User '${row.username}' already exists in client portal with status ${currentStatus}.`,
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
          retryStartingPoint: 'NONE',
          nextAction: 'Skipped already existing user',
        });
        continue;
      }

      // Check INVALID / Validation failures
      if (
        row.classification === 'INVALID' ||
        row.errorCode === 'DUPLICATE_SERIAL_NUMBER' ||
        row.errorCode === 'REQUIRED_FIELD_MISSING' ||
        row.errorCode === 'INVALID_FIELD_FORMAT' ||
        row.errorCode === 'REMOTE_DROPDOWN_OPTION_NOT_FOUND' ||
        row.errorCode === 'REMOTE_REQUIRED_FIELD_UNSUPPORTED' ||
        row.errorCode === 'DUPLICATE_USERNAME_IN_FILE'
      ) {
        invalidCount++;
        const valMsg = (row.validationErrors && row.validationErrors.length > 0)
          ? row.validationErrors.join('; ')
          : row.message || 'Row failed dry-run validation';
        results.push({
          sNo,
          rowNumber: row.rowNumber,
          action: row.action,
          username: row.username,
          fullName,
          result: 'INVALID',
          overallStatus: 'FAILED',
          validationState: 'FAILED',
          creationState: 'NOT_STARTED',
          userSearchState: 'NOT_STARTED',
          roleSelectionState: 'NOT_STARTED',
          roleUpdateState: 'NOT_STARTED',
          roleVerificationState: 'NOT_STARTED',
          errorCode: row.errorCode || 'REQUIRED_FIELD_MISSING',
          message: valMsg,
          failureReason: valMsg,
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
          retryStartingPoint: 'USER_CREATION',
          nextAction: 'Correct invalid fields in Excel before retrying',
        });
        continue;
      }

      // Check CANCELLED
      if (row.classification === 'CANCELLED') {
        cancelledCount++;
        results.push({
          sNo,
          rowNumber: row.rowNumber,
          action: row.action,
          username: row.username,
          fullName,
          result: 'CANCELLED',
          overallStatus: 'CANCELLED',
          errorCode: 'OPERATION_CANCELLED',
          message: row.message || 'Row import was cancelled.',
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
          retryStartingPoint: 'NONE',
        });
        continue;
      }

      // Check if row is eligible and approved
      const isEligible =
        (row.classification === 'READY' ||
          row.classification === 'READY_CREATE' ||
          row.classification === 'WARNING_REQUIRES_CONFIRMATION') &&
        row.isApproved !== false;

      if (!isEligible) {
        notProcessedCount++;
        results.push({
          sNo,
          rowNumber: row.rowNumber,
          action: row.action,
          username: row.username,
          fullName,
          result: 'NOT_PROCESSED',
          overallStatus: 'NOT_PROCESSED',
          errorCode: 'NOT_PROCESSED',
          message: row.message || 'Row was not approved by operator for creation.',
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
          retryStartingPoint: 'NONE',
        });
        continue;
      }

      // Parse role(s) to map
      const rawRoleString = row.role || (row.roles ? row.roles.join(',') : '');
      const parsedRoleResult = parseAndValidateRoles(rawRoleString, liveRoleNames);
      const rolesToMap = parsedRoleResult.validRoles.length > 0
        ? parsedRoleResult.validRoles
        : (row.roles && row.roles.length > 0 ? row.roles : (row.role ? [row.role] : []));

      const isRetryFromRoleMapping = row.retryStartingPoint === 'ROLE_STATE_INSPECTION' || (row.action as any) === 'MAP_ROLE';

      // Execute eligible row
      if (row.action === 'CREATE' || isRetryFromRoleMapping) {
        let userCreatedSuccessfully = isRetryFromRoleMapping;
        let userCreatedResult: (ClientUser & { credentialDeliveryStatus?: CredentialDeliveryStatus; oneTimeCredentialEventId?: string }) | null = null;

        // 1. Create User if not already created
        if (!userCreatedSuccessfully) {
          try {
            userCreatedResult = await this.createClientUser(
              {
                clientId,
                username: row.username,
                firstName: row.firstName,
                middleName: row.middleName,
                lastName: row.lastName,
                nickName: row.nickName,
                email: row.email,
                mobileNumber: row.mobileNumber || '0500000000',
                nationality: row.nationality || 'Saudi Arabia',
                role: rolesToMap[0] || row.role,
                roles: rolesToMap,
                profileRole: row.profileRole,
                barcodeNumber: row.barcodeNumber,
                status: row.requestedStatus || 'ACTIVE',
                overrideDuplicateName: true,
              },
              user,
              { skipPostSync: true }
            );
            userCreatedSuccessfully = true;
          } catch (err: any) {
            const errorCode = err.response?.code || err.code || 'REMOTE_ERROR';
            const errorMsg = (err.response?.message || err.message || 'User creation failed on client portal.').replace(/<[^>]*>?/gm, '');

            const isSystemError = isSystemCircuitBreakerError(errorCode, errorMsg);

            const isDuplicateUser =
              errorCode === 'DUPLICATE_USERNAME' ||
              errorMsg.toLowerCase().includes('already exists') ||
              errorMsg.toLowerCase().includes('already registered') ||
              errorMsg.toLowerCase().includes('duplicate username');

            if (isDuplicateUser && rolesToMap.length > 0) {
              userCreatedSuccessfully = true;
              // Advance to Step 2 (Role Mapping)
            } else if (isDuplicateUser) {
              alreadyExistingCount++;
              results.push({
                sNo,
                rowNumber: row.rowNumber,
                action: row.action,
                username: row.username,
                fullName,
                result: 'ALREADY_EXISTS',
                overallStatus: 'COMPLETED',
                errorCode: 'ALREADY_EXISTS',
                remoteStatus: 'ACTIVE',
                message: `User '${row.username}' already exists in client portal.`,
                executedAt: new Date().toISOString(),
                correlationId: rowCorrelationId,
                retryStartingPoint: 'NONE',
                nextAction: 'Skipped already existing user',
              });
              continue;
            } else if (isSystemError) {
              systemPaused = true;
              systemPauseReason = `Batch paused due to system error: ${errorMsg}`;
              failedBeforeCreationCount++;
              currentFailedUser = row.username;
              results.push({
                sNo,
                rowNumber: row.rowNumber,
                action: row.action,
                username: row.username,
                fullName,
                result: 'FAILED',
                overallStatus: 'FAILED',
                validationState: 'PASSED',
                creationState: 'FAILED',
                userSearchState: 'NOT_STARTED',
                roleSelectionState: 'NOT_STARTED',
                roleUpdateState: 'NOT_STARTED',
                roleVerificationState: 'NOT_STARTED',
                errorCode,
                message: errorMsg,
                failureReason: errorMsg,
                executedAt: new Date().toISOString(),
                correlationId: rowCorrelationId,
                retryStartingPoint: 'USER_CREATION',
                nextAction: 'Batch paused due to infrastructure error',
              });
              continue;
            } else if (
              errorCode === 'REMOTE_CREATE_VERIFICATION_FAILED' ||
              errorCode === 'OPERATION_TIMED_OUT' ||
              errorMsg.toLowerCase().includes('could not be verified') ||
              errorMsg.toLowerCase().includes('timed out')
            ) {
              consecutiveInfrastructureFailures++;
              if (consecutiveInfrastructureFailures >= MAX_CONSECUTIVE_INFRASTRUCTURE_FAILURES) {
                systemPaused = true;
                systemPauseReason = 'Batch paused due to repeated consecutive infrastructure failures across rows.';
              }
              const resIdx = results.length;
              results.push({
                sNo,
                rowNumber: row.rowNumber,
                action: row.action,
                username: row.username,
                fullName,
                result: 'FAILED',
                overallStatus: 'FAILED',
                validationState: 'PASSED',
                creationState: 'FAILED',
                userSearchState: 'NOT_STARTED',
                roleSelectionState: 'NOT_STARTED',
                roleUpdateState: 'NOT_STARTED',
                roleVerificationState: 'NOT_STARTED',
                errorCode: 'REMOTE_CREATE_VERIFICATION_FAILED',
                message: errorMsg,
                failureReason: errorMsg,
                executedAt: new Date().toISOString(),
                correlationId: rowCorrelationId,
                retryStartingPoint: 'USER_CREATION',
                nextAction: systemPaused ? 'Batch paused due to infrastructure error' : 'Continuing to next user',
              });
              failedBeforeCreationCount++;
              currentFailedUser = row.username;
              pendingReconciliationRows.push({ row, resultIndex: resIdx });
              continue;
            } else {
              // Normal row-level rejection
              consecutiveInfrastructureFailures = 0;
              failedBeforeCreationCount++;
              currentFailedUser = row.username;
              results.push({
                sNo,
                rowNumber: row.rowNumber,
                action: row.action,
                username: row.username,
                fullName,
                result: 'FAILED',
                overallStatus: 'FAILED',
                validationState: 'PASSED',
                creationState: 'FAILED',
                userSearchState: 'NOT_STARTED',
                roleSelectionState: 'NOT_STARTED',
                roleUpdateState: 'NOT_STARTED',
                roleVerificationState: 'NOT_STARTED',
                errorCode,
                message: errorMsg,
                failureReason: errorMsg,
                executedAt: new Date().toISOString(),
                correlationId: rowCorrelationId,
                retryStartingPoint: 'USER_CREATION',
                nextAction: 'Continuing to next user',
              });
              continue;
            }
          }
        }

        // Reset consecutive failures on successful user creation
        consecutiveInfrastructureFailures = 0;

        // Ephemeral Credential Capture & Event Emission via Dedicated Store
        let rowCredentialDeliveryStatus: CredentialDeliveryStatus = userCreatedResult?.credentialDeliveryStatus || 'UNAVAILABLE';
        let rowOneTimeCredentialEventId: string | undefined = userCreatedResult?.oneTimeCredentialEventId;

        if (userCreatedResult && rowOneTimeCredentialEventId) {
          const oneTimeEventIdHash = crypto.createHash('sha256').update(rowOneTimeCredentialEventId).digest('hex');
          ephemeralCredentialsList.push({
            eventType: 'USER_EPHEMERAL_CREDENTIAL_READY',
            oneTimeEventId: rowOneTimeCredentialEventId,
            oneTimeEventIdHash,
            jobId,
            clientId,
            rowNumber: row.rowNumber,
            username: row.username,
            fullName,
            credentialDeliveryStatus: rowCredentialDeliveryStatus,
            createdAt: new Date().toISOString(),
            hardExpiresAt: new Date(Date.now() + 300000).toISOString(),
            displayDurationSeconds: 60,
          });
        }

        // 2. Role Mapping Step on /addUserRole
        if (rolesToMap.length === 0) {
          // No roles requested -> Completed
          completedCount++;
          lastSuccessfulUser = row.username;
          results.push({
            sNo,
            rowNumber: row.rowNumber,
            action: row.action,
            username: row.username,
            fullName,
            result: 'CREATED',
            overallStatus: 'COMPLETED',
            validationState: 'PASSED',
            creationState: 'COMPLETED',
            userSearchState: 'SKIPPED',
            roleSelectionState: 'SKIPPED',
            roleUpdateState: 'SKIPPED',
            roleVerificationState: 'SKIPPED',
            remoteStatus: 'ACTIVE',
            message: `User '${row.username}' created and verified on client.`,
            credentialDeliveryStatus: rowCredentialDeliveryStatus,
            executedAt: new Date().toISOString(),
            correlationId: rowCorrelationId,
            retryStartingPoint: 'NONE',
            nextAction: 'Completed',
          });

          // Enforce 10-item unacknowledged queue capacity limit
          if (ephemeralCredentialsList.length >= 10) {
            systemPaused = true;
            systemPauseReason = CREDENTIAL_QUEUE_REQUIRES_OPERATOR_ATTENTION;
          }
          continue;
        }

        // Execute role mapping
        try {
          const roleMappingRes = await this.mapUserRoles(
            {
              clientId,
              username: row.username,
              fullName,
              firstName: row.firstName,
              roles: rolesToMap,
            },
            user
          );

          if (roleMappingRes.success) {
            consecutiveInfrastructureFailures = 0;
            completedCount++;
            lastSuccessfulUser = row.username;
            results.push({
              sNo,
              rowNumber: row.rowNumber,
              action: row.action,
              username: row.username,
              fullName,
              result: 'CREATED',
              overallStatus: 'COMPLETED',
              validationState: 'PASSED',
              creationState: 'COMPLETED',
              userSearchState: 'EXACT_MATCH_FOUND',
              roleSelectionState: 'SELECTED',
              roleUpdateState: 'COMPLETED',
              roleVerificationState: 'PASSED',
              requestedRoles: rolesToMap,
              mappedRoles: roleMappingRes.mappedRoles || rolesToMap,
              missingRoles: [],
              roleSelectionProgress: roleMappingRes.roleSelectionProgress || `${rolesToMap.length} of ${rolesToMap.length} selected`,
              remoteStatus: 'ACTIVE',
              message: `User '${row.username}' created and roles [${rolesToMap.join(', ')}] mapped and verified.`,
              credentialDeliveryStatus: rowCredentialDeliveryStatus,
              executedAt: new Date().toISOString(),
              correlationId: rowCorrelationId,
              retryStartingPoint: 'NONE',
              nextAction: 'Completed',
            });
          } else {
            // Role mapping failed, but user was created
            const isSystemError = isSystemCircuitBreakerError(roleMappingRes.errorCode, roleMappingRes.errorMessage);

            if (isSystemError) {
              systemPaused = true;
              systemPauseReason = `Batch paused due to system error: ${roleMappingRes.errorMessage}`;
            }

            userCreatedRolePendingCount++;
            currentFailedUser = row.username;
            results.push({
              sNo,
              rowNumber: row.rowNumber,
              action: row.action,
              username: row.username,
              fullName,
              result: 'PARTIAL_FAILED',
              overallStatus: 'PARTIAL_FAILED',
              validationState: 'PASSED',
              creationState: 'COMPLETED',
              userSearchState: roleMappingRes.userSearchState || 'FAILED',
              roleSelectionState: roleMappingRes.roleSelectionState || 'NOT_STARTED',
              roleUpdateState: roleMappingRes.roleUpdateState || 'NOT_STARTED',
              roleVerificationState: roleMappingRes.roleVerificationState || 'NOT_STARTED',
              requestedRoles: rolesToMap,
              mappedRoles: roleMappingRes.mappedRoles || [],
              missingRoles: roleMappingRes.missingRoles || rolesToMap,
              roleSelectionProgress: roleMappingRes.roleSelectionProgress || `0 of ${rolesToMap.length} selected`,
              errorCode: roleMappingRes.errorCode || 'ROLE_UPDATE_FAILED',
              message: `User created successfully — role mapping failed/pending: ${roleMappingRes.failureReason || roleMappingRes.errorMessage || 'Role mapping failed'}.`,
              failureReason: roleMappingRes.failureReason || roleMappingRes.errorMessage || 'Role mapping failed',
              remoteStatus: 'ACTIVE',
              credentialDeliveryStatus: rowCredentialDeliveryStatus,
              executedAt: new Date().toISOString(),
              correlationId: rowCorrelationId,
              retryStartingPoint: 'ROLE_STATE_INSPECTION',
              nextAction: systemPaused ? 'Batch paused due to infrastructure error' : 'Continuing to next user',
            });
          }
        } catch (roleErr: any) {
          const roleErrMsg = (roleErr.message || 'Role mapping failed').replace(/<[^>]*>?/gm, '');
          const isSystemError = isSystemCircuitBreakerError(roleErr.code || roleErr.response?.code, roleErrMsg);

          if (isSystemError) {
            systemPaused = true;
            systemPauseReason = `Batch paused due to system error: ${roleErrMsg}`;
          }

          userCreatedRolePendingCount++;
          currentFailedUser = row.username;
          results.push({
            sNo,
            rowNumber: row.rowNumber,
            action: row.action,
            username: row.username,
            fullName,
            result: 'PARTIAL_FAILED',
            overallStatus: 'PARTIAL_FAILED',
            validationState: 'PASSED',
            creationState: 'COMPLETED',
            userSearchState: 'FAILED',
            roleSelectionState: 'NOT_STARTED',
            roleUpdateState: 'NOT_STARTED',
            roleVerificationState: 'NOT_STARTED',
            requestedRoles: rolesToMap,
            mappedRoles: [],
            missingRoles: rolesToMap,
            roleSelectionProgress: `0 of ${rolesToMap.length} selected`,
            errorCode: 'ROLE_UPDATE_FAILED',
            message: `User created successfully — role mapping failed/pending: ${roleErrMsg}.`,
            failureReason: roleErrMsg,
            remoteStatus: 'ACTIVE',
            credentialDeliveryStatus: rowCredentialDeliveryStatus,
            executedAt: new Date().toISOString(),
            correlationId: rowCorrelationId,
            retryStartingPoint: 'ROLE_STATE_INSPECTION',
            nextAction: systemPaused ? 'Batch paused due to infrastructure error' : 'Continuing to next user',
          });
        }

        // Enforce 10-item unacknowledged queue capacity limit
        if (ephemeralCredentialsList.length >= 10) {
          systemPaused = true;
          systemPauseReason = CREDENTIAL_QUEUE_REQUIRES_OPERATOR_ATTENTION;
        }
        continue;
      }

      if (row.action === 'ACTIVATE' || row.action === 'DEACTIVATE') {
        const snap = await this.snapshotRepo.findOne({ where: { clientId, username: row.username } });
        if (snap) {
          await this.setUserStatus(snap.id, row.action === 'ACTIVATE' ? 'ACTIVE' : 'INACTIVE', user);
          results.push({
            sNo,
            rowNumber: row.rowNumber,
            action: row.action,
            username: row.username,
            fullName,
            result: 'SUCCESS',
            overallStatus: 'COMPLETED',
            message: `Status updated to ${row.action === 'ACTIVATE' ? 'ACTIVE' : 'INACTIVE'}.`,
            remoteStatus: row.action === 'ACTIVATE' ? 'ACTIVE' : 'INACTIVE',
            executedAt: new Date().toISOString(),
            correlationId: rowCorrelationId,
            retryStartingPoint: 'NONE',
            nextAction: 'Completed',
          });
          completedCount++;
        } else {
          results.push({
            sNo,
            rowNumber: row.rowNumber,
            action: row.action,
            username: row.username,
            fullName,
            result: 'REMOTE_ERROR',
            overallStatus: 'FAILED',
            errorCode: 'REMOTE_USER_NOT_FOUND',
            message: `User '${row.username}' not found in client snapshot.`,
            failureReason: `User '${row.username}' not found in client snapshot.`,
            executedAt: new Date().toISOString(),
            correlationId: rowCorrelationId,
            retryStartingPoint: 'USER_CREATION',
            nextAction: 'Continuing to next user',
          });
          failedBeforeCreationCount++;
        }
      }
    }

    // Always perform exactly ONE batch-level authoritative pull sync
    try {
      await this.syncClientUsers(clientId, user);
    } catch (err: any) {
      this.logger.warn(`Post-import batch pull sync warning: ${err.message}`);
    }

    // Reconcile pending verification rows against the fresh synchronized snapshot
    if (pendingReconciliationRows.length > 0) {
      const freshSnapshots = await this.snapshotRepo.find({
        where: { clientId, isPresentRemotely: true },
      });
      const snapshotMapByUsername = new Map<string, ClientUserSnapshot>();
      const snapshotMapByName = new Map<string, ClientUserSnapshot>();
      for (const s of freshSnapshots) {
        if (s.username) snapshotMapByUsername.set(s.username.toLowerCase().trim(), s);
        if (s.fullName) snapshotMapByName.set(s.fullName.toLowerCase().trim(), s);
        const firstLast = `${(s.firstName || '').toLowerCase().trim()} ${(s.lastName || '').toLowerCase().trim()}`.trim();
        if (firstLast) snapshotMapByName.set(firstLast, s);
      }

      for (const pending of pendingReconciliationRows) {
        const uNorm = (pending.row.username || '').toLowerCase().trim();
        const nameNorm = `${(pending.row.firstName || '').toLowerCase().trim()} ${(pending.row.lastName || '').toLowerCase().trim()}`.trim();
        const matched = snapshotMapByUsername.get(uNorm) || snapshotMapByName.get(nameNorm) || snapshotMapByName.get(uNorm);

        const targetResult = results[pending.resultIndex];
        if (matched) {
          // Reconcile row from FAILED to CREATED
          if (targetResult) {
            targetResult.result = 'CREATED';
            targetResult.overallStatus = 'COMPLETED';
            targetResult.creationState = 'COMPLETED';
            targetResult.remoteStatus = matched.status || 'ACTIVE';
            targetResult.errorCode = undefined;
            targetResult.failureReason = undefined;
            targetResult.message = `User '${pending.row.username}' created and verified on client via batch reconciliation.`;
            targetResult.retryStartingPoint = 'NONE';
            targetResult.nextAction = 'Completed';
            completedCount++;
            failedBeforeCreationCount = Math.max(0, failedBeforeCreationCount - 1);
          }
        } else {
          // Truly absent remotely -> mark REMOTE_CREATE_UNCONFIRMED for explicit review
          if (targetResult) {
            targetResult.result = 'FAILED';
            targetResult.overallStatus = 'FAILED';
            targetResult.errorCode = 'REMOTE_CREATE_UNCONFIRMED';
            targetResult.message = `REMOTE_CREATE_UNCONFIRMED — User '${pending.row.username}' could not be confirmed in client users directory after batch synchronization. Requires operator review before retry.`;
            targetResult.failureReason = `REMOTE_CREATE_UNCONFIRMED — User '${pending.row.username}' could not be confirmed in client users directory.`;
          }
        }
      }
    }

    // Determine batch status
    let batchStatus: BatchFinalStatus = 'COMPLETED';
    if (systemPaused) {
      batchStatus = 'PAUSED_SYSTEM_ERROR';
    } else if (failedBeforeCreationCount === 0 && userCreatedRolePendingCount === 0) {
      batchStatus = 'COMPLETED';
    } else if (completedCount > 0) {
      batchStatus = 'COMPLETED_WITH_ROW_ERRORS';
    } else {
      batchStatus = 'FAILED_NO_ROWS_PROCESSED';
    }

    const totalProcessed = rows.length;
    const skippedSum = alreadyExistingCount + notProcessedCount + cancelledCount;
    const computedSum = completedCount + failedBeforeCreationCount + userCreatedRolePendingCount + alreadyExistingCount + invalidCount + cancelledCount + notProcessedCount + remainingUnprocessedCount;

    if (totalProcessed !== computedSum) {
      this.logger.warn(`Discrepancy in row breakdown: total=${totalProcessed}, computedSum=${computedSum}`);
    }

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'CLIENT_USERS_BULK_IMPORTED',
        actorUserId: user.sub,
        actorUsername: user.username,
        entityType: 'CLIENT',
        entityId: clientId,
        detailsJson: JSON.stringify({
          clientCode: client.clientCode,
          jobId,
          totalRows: totalProcessed,
          completedRows: completedCount,
          failedBeforeCreationRows: failedBeforeCreationCount,
          userCreatedRolePendingRows: userCreatedRolePendingCount,
          alreadyExistingRows: alreadyExistingCount,
          invalidRows: invalidCount,
          cancelledRows: cancelledCount,
          notProcessedRows: notProcessedCount,
          skippedRows: skippedSum,
          remainingUnprocessedRows: remainingUnprocessedCount,
          batchStatus,
          systemPaused,
        }),
      })
    );

    return {
      jobId,
      totalRows: totalProcessed,
      completedRows: completedCount,
      failedBeforeCreationRows: failedBeforeCreationCount,
      userCreatedRolePendingRows: userCreatedRolePendingCount,
      alreadyExistingRows: alreadyExistingCount,
      invalidRows: invalidCount,
      cancelledRows: cancelledCount,
      notProcessedRows: notProcessedCount,
      skippedRows: skippedSum,
      remainingUnprocessedRows: remainingUnprocessedCount,
      createdRows: completedCount + userCreatedRolePendingCount,
      failedRows: failedBeforeCreationCount + userCreatedRolePendingCount,
      succeededRows: completedCount,
      batchStatus,
      systemPaused,
      systemPauseReason,
      lastSuccessfulUser,
      currentFailedUser,
      results,
      ephemeralCredentials: ephemeralCredentialsList,
    };
  }

  /**
   * Generates Excel workbook (.xlsx) containing import execution results with S.No, actual Excel row, and full status reconciliation.
   */
  async exportImportResults(clientId: string, summary: ExcelUserImportExecutionSummary, user: JwtPayload): Promise<Buffer> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    const clientCode = client ? client.clientCode : 'N/A';

    const resultRows = (summary.results || []).map((r, idx) => ({
      'S.No': r.sNo !== undefined ? r.sNo : idx + 1,
      'Excel Row Number': r.rowNumber,
      'Username': this.sanitizeCellValue(r.username),
      'Full Name': this.sanitizeCellValue(r.fullName),
      'Result Status': r.result,
      'Current Status': r.existingStatus || r.remoteStatus || 'N/A',
      'Safe Error Code': r.errorCode || 'NONE',
      'Reason / Message': this.sanitizeCellValue(r.message),
      'Processed Timestamp': r.executedAt,
    }));

    const created = summary.createdRows ?? summary.succeededRows ?? 0;
    const existing = summary.alreadyExistingRows ?? 0;
    const invalid = summary.invalidRows ?? 0;
    const failed = summary.failedRows ?? 0;
    const cancelled = summary.cancelledRows ?? 0;
    const notProcessed = summary.notProcessedRows ?? 0;

    const summaryRows = [
      { Property: 'Import Job ID', Value: summary.jobId },
      { Property: 'Selected Client', Value: clientCode },
      { Property: 'Total Rows', Value: summary.totalRows },
      { Property: 'Created Rows', Value: created },
      { Property: 'Already Existing Rows', Value: existing },
      { Property: 'Invalid Rows', Value: invalid },
      { Property: 'Failed Rows', Value: failed },
      { Property: 'Cancelled Rows', Value: cancelled },
      { Property: 'Not Processed Rows', Value: notProcessed },
      { Property: 'Sum Check Verification', Value: `Total (${summary.totalRows}) = Created (${created}) + Already Existing (${existing}) + Invalid (${invalid}) + Failed (${failed}) + Cancelled (${cancelled}) + Not Processed (${notProcessed})` },
      { Property: 'Export Timestamp (UTC)', Value: new Date().toISOString() },
    ];

    const wb = XLSX.utils.book_new();
    const wsResults = XLSX.utils.json_to_sheet(resultRows);
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);

    XLSX.utils.book_append_sheet(wb, wsResults, 'Import Results');
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  private mapToDto(u: ClientUserSnapshot, client: Client): ClientUser {
    return {
      id: u.id,
      clientId: u.clientId,
      clientCode: client.clientCode,
      clientName: client.clientName,
      environment: client.environment,
      remoteUserId: u.remoteUserId,
      username: u.username,
      firstName: u.firstName,
      middleName: u.middleName,
      lastName: u.lastName,
      fullName: u.fullName,
      nickName: u.nickName,
      email: u.email,
      mobileNumber: u.mobileNumber,
      nationality: u.nationality,
      role: u.role,
      profileRole: u.profileRole,
      status: u.status,
      barcodeNumber: u.barcodeNumber,
      hasSignature: u.hasSignature,
      signatureUrl: u.signatureDataUrl,
      hasStamp: u.hasStamp,
      stampUrl: u.stampDataUrl,
      hasProfileImage: u.hasProfileImage,
      profileImageUrl: u.profileImageDataUrl,
      remoteCreatedAt: u.remoteCreatedAt,
      remoteUpdatedAt: u.remoteUpdatedAt,
      lastSyncedAt: u.lastSyncedAt.toISOString(),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  }
}
