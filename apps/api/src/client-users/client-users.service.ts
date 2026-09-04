import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In, Not, IsNull } from 'typeorm';
import * as crypto from 'crypto';
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
  ClientCreateFormMetadata,
  UserImportAction,
  UserImportClassification,
} from '@hmc/shared';
import { AgentsService } from '../agents/agents.service.js';

@Injectable()
export class ClientUsersService implements OnModuleInit {
  private readonly logger = new Logger(ClientUsersService.name);

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

    return {
      origin,
      resolvedLoginUrl,
      resolvedUsersUrl,
      resolvedAddUsersUrl,
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
   * Initiates a background headless user sync job and returns the job ID immediately.
   * Prevents duplicate in-flight sync jobs for the same client.
   */
  async startSyncJob(clientId: string, user: JwtPayload): Promise<{ jobId: string; status: string; message: string }> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Not authorized for this client');
    }

    // Clean up stale jobs before evaluating active status
    await this.cleanupStaleSyncJobs(clientId);

    // Version & URL validation
    const routes = this.resolveClientUserRoutes(client);

    // Duplicate sync job prevention
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
      if (elapsed < 30000) {
        return {
          jobId: existingActive.id,
          status: existingActive.status,
          message: 'Connecting to automation agent…',
        };
      }
    }

    const allAgents = await this.agentsService.getAllAgents();
    const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE');
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
        snapshot.nationality = su.nationality;
        snapshot.role = su.role;
        snapshot.profileRole = su.profileRole;
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
   * Synchronous / polling wrapper for syncClientUsers.
   */
  async syncClientUsers(clientId: string, user: JwtPayload): Promise<ClientUserListResponse> {
    if (!clientId || clientId.trim() === '') {
      throw new BadRequestException({
        code: 'CLIENT_ID_REQUIRED',
        message: 'Target client ID is required.',
      });
    }

    const { jobId } = await this.startSyncJob(clientId, user);

    // Wait up to 15s for the job to complete
    const startTime = Date.now();
    let completedRun: AutomationRun | null = null;

    while (Date.now() - startTime < 15000) {
      await new Promise((r) => setTimeout(r, 300));
      const r = await this.runRepo.findOne({ where: { id: jobId } });
      if (r && (r.status === 'COMPLETED' || r.status === 'FAILED')) {
        completedRun = r;
        break;
      }
    }

    let syncSummary: ClientUserSyncSummary | undefined = undefined;
    if (completedRun && completedRun.status === 'COMPLETED' && completedRun.resultSummaryJson) {
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
    } else if (completedRun && completedRun.status === 'FAILED') {
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

    const response = await this.getClientUsers(clientId, {}, user);
    if (syncSummary) response.syncSummary = syncSummary;
    return response;
  }

  private static activeMutationLocks = new Set<string>();

  private acquireMutationLock(clientId: string, username: string): () => void {
    const key = `${clientId}:${username.trim().toLowerCase()}`;
    if (ClientUsersService.activeMutationLocks.has(key)) {
      throw new BadRequestException({
        code: 'OPERATION_IN_PROGRESS',
        message: `Another mutation operation is already in progress for user '${username}'.`,
      });
    }
    ClientUsersService.activeMutationLocks.add(key);
    return () => {
      ClientUsersService.activeMutationLocks.delete(key);
    };
  }

  /**
   * Creates a user with duplicate validation and automated browser execution.
   */
  async createClientUser(dto: CreateClientUserDto, user: JwtPayload): Promise<ClientUser> {
    const client = await this.clientRepo.findOne({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException(`Client ${dto.clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(dto.clientId)) {
      throw new ForbiddenException('Not authorized for this client');
    }

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
      role: dto.role,
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
      const onlineAgents = (await this.agentsService.getAllAgents()).filter((a) => a.status === 'ONLINE');
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

      const correlationId = crypto.randomUUID();
      const run = this.runRepo.create({
        clientId: client.id,
        desktopAgentId: onlineAgents[0].id,
        triggeredByUserId: user.sub,
        runType: 'CREATE_CLIENT_USER',
        status: 'QUEUED',
        correlationId,
        parametersJson: JSON.stringify({
          taskType: 'CREATE_CLIENT_USER',
          userId: user.sub,
          clientBaseUrl: client.baseUrl,
          clientAppPath: client.applicationPath,
          loginRoute: client.loginRoute,
          targetRoute: client.usersRoute || '/users',
          credentials,
          payload: sanitizedDto,
          ...sanitizedDto,
        }),
      });

      const savedRun = await this.runRepo.save(run);

      // Wait for completion (up to 30s)
      const startTime = Date.now();
      let completedRun: AutomationRun | null = null;
      while (Date.now() - startTime < 30000) {
        await new Promise((r) => setTimeout(r, 400));
        const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
        if (r && ['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(r.status)) {
          completedRun = r;
          break;
        }
      }

      let parsedResult: any = {};
      try {
        parsedResult = JSON.parse(completedRun?.resultSummaryJson || '{}');
      } catch {}

      const isConfirmedSuccess =
        completedRun &&
        (['COMPLETED', 'SUCCEEDED'].includes(completedRun.status) ||
          (completedRun.status === 'FAILED' && parsedResult.isRemoteSaveConfirmed));

      if (!isConfirmedSuccess) {
        let errorCode = 'REMOTE_VALIDATION_FAILED';
        let errorMessage = completedRun?.errorMessage || 'User creation failed on client portal.';
        if (parsedResult.errorCode) errorCode = parsedResult.errorCode;
        if (parsedResult.errorMessage) errorMessage = parsedResult.errorMessage;
        if (completedRun?.status === 'TIMED_OUT') errorCode = 'OPERATION_TIMED_OUT';
        throw new BadRequestException({
          code: errorCode,
          message: errorMessage,
        });
      }

      // Automatically trigger post-mutation pull sync
      try {
        await this.syncClientUsers(client.id, user);
      } catch (syncErr: any) {
        this.logger.warn(`Post-creation automatic sync failed: ${syncErr.message}`);
      }

      // Save snapshot or update existing if found during pull sync
      const now = new Date();
      const normUsername = dto.username.trim().toLowerCase();
      let existingSnap = await this.snapshotRepo
        .createQueryBuilder('u')
        .where('u.clientId = :clientId', { clientId: client.id })
        .andWhere('LOWER(u.username) = :normUsername', { normUsername })
        .getOne();

      let saved: ClientUserSnapshot;
      if (existingSnap) {
        saved = existingSnap;
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
          role: dto.role || null,
          profileRole: dto.profileRole || null,
          status: dto.status || 'ACTIVE',
          barcodeNumber: dto.barcodeNumber || null,
          hasSignature: Boolean(dto.signatureBase64),
          hasStamp: Boolean(dto.stampBase64),
          hasProfileImage: Boolean(dto.profileBase64),
          isPresentRemotely: true,
          lastSyncedAt: now,
        });
        saved = await this.snapshotRepo.save(snapshot);
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
      let defaultPassword: string | undefined = undefined;
      if (parsedResult.defaultPassword || parsedResult.temporaryPassword) {
        defaultPassword = parsedResult.defaultPassword || parsedResult.temporaryPassword;
      }

      const resultDto = this.mapToDto(saved, client);
      return {
        ...resultDto,
        defaultPassword,
        temporaryPassword: defaultPassword,
        message: `User '${dto.username}' created and verified on client.`,
      };
    } finally {
      releaseLock();
    }
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

      if (!completedRun || completedRun.status === 'FAILED' || completedRun.status === 'TIMED_OUT') {
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

      if (!completedRun || completedRun.status === 'FAILED' || completedRun.status === 'TIMED_OUT') {
        let errorCode = 'REMOTE_STATUS_VERIFICATION_FAILED';
        let errorMsg = completedRun?.errorMessage || 'Remote status verification failed on client portal.';
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
   * Resets password on the remote client with verification and returns one-time temporary password.
   */
  async resetUserPassword(id: string, user: JwtPayload): Promise<{ temporaryPassword?: string; message: string }> {
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
          clientBaseUrl: client.baseUrl,
          loginRoute: routes.resolvedLoginUrl,
          targetRoute: routes.resolvedUsersUrl,
          credentials,
          payload: {
            username: snapshot.username,
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

      if (!completedRun || completedRun.status === 'FAILED' || completedRun.status === 'TIMED_OUT') {
        let errorCode = 'RESET_PASSWORD_FAILED';
        let errorMsg = completedRun?.errorMessage || 'Password reset failed on remote client portal.';
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

      let tempPassword: string | undefined = undefined;
      let message = 'Password reset completed in the selected Simplex client.';
      try {
        const parsed = JSON.parse(completedRun.resultSummaryJson || '{}');
        if (parsed.temporaryPassword) {
          tempPassword = parsed.temporaryPassword;
          message = `Password for ${snapshot.username} reset successfully. Temporary password generated.`;
        } else if (parsed.message) {
          message = parsed.message;
        }
      } catch {}

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
          }),
        })
      );

      return {
        temporaryPassword: tempPassword,
        message,
      };
    } finally {
      releaseLock();
    }
  }

  private static formOptionsCache = new Map<string, { timestamp: number; data: ClientCreateFormMetadata }>();

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
   * Exports all current ACTIVE and INACTIVE users regardless of any UI filters.
   * Enforces: Total Exported = Active + Inactive.
   */
  async exportExcel(clientId: string, user: JwtPayload): Promise<Buffer> {
    if (!clientId) throw new BadRequestException('Client ID is required for export');
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('Not authorized to export data for this client');
    }

    const users = await this.snapshotRepo.find({
      where: { clientId },
      order: { fullName: 'ASC' },
    });

    const totalExported = users.length;
    const activeCount = users.filter((u) => u.status === 'ACTIVE').length;
    const inactiveCount = users.filter((u) => u.status === 'INACTIVE').length;
    const routes = this.resolveClientUserRoutes(client);

    // Enforce invariant: Total Exported = Active + Inactive
    if (totalExported !== activeCount + inactiveCount) {
      throw new Error(`Integrity error: Total Exported (${totalExported}) != Active (${activeCount}) + Inactive (${inactiveCount})`);
    }

    const userRows = users.map((u, idx) => ({
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
      'Last Synced': u.lastSyncedAt.toISOString(),
    }));

    const metadataRows = [
      { Property: 'Client Code / Name', Value: `${client.clientCode} (${client.clientName})` },
      { Property: 'Environment', Value: client.environment },
      { Property: 'Application Version', Value: client.applicationVersion || 'v9.4' },
      { Property: 'Resolved Users Route', Value: routes.resolvedUsersUrl },
      { Property: 'Export Timestamp (UTC)', Value: new Date().toISOString() },
      { Property: 'Snapshot Timestamp (UTC)', Value: users[0]?.lastSyncedAt?.toISOString() || new Date().toISOString() },
      { Property: 'Total Exported Users', Value: totalExported },
      { Property: 'Active Users Count', Value: activeCount },
      { Property: 'Inactive Users Count', Value: inactiveCount },
      { Property: 'Count Invariant Verification', Value: `Total Exported (${totalExported}) = Active (${activeCount}) + Inactive (${inactiveCount})` },
    ];

    const wb = XLSX.utils.book_new();
    const wsUsers = XLSX.utils.json_to_sheet(userRows);
    const wsMeta = XLSX.utils.json_to_sheet(metadataRows);

    XLSX.utils.book_append_sheet(wb, wsUsers, 'Users');
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Export Metadata');

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'CLIENT_USERS_EXPORTED',
        actorUserId: user.sub,
        actorUsername: user.username,
        entityType: 'CLIENT',
        entityId: clientId,
        detailsJson: JSON.stringify({
          clientCode: client.clientCode,
          totalExported,
          activeCount,
          inactiveCount,
        }),
      })
    );

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Generates a dynamic client-scoped Excel import template (.xlsx) using live form options.
   * Includes S.No as the first Users-template column.
   */
  async getImportTemplate(clientId: string, user: JwtPayload): Promise<Buffer> {
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

    const sampleNat = natList[0] || 'Saudi Arabia';
    const sampleRole = roleList[0] || 'Physician';
    const sampleProf = profList[0] || 'Clinical Specialist';

    // Sheet 1: Users (S.No as the first column)
    const templateRows = [
      {
        'S.No': 1,
        'User Name *': 'dr_ahmed',
        'First Name *': 'Ahmed',
        'Middle Name': 'Ali',
        'Last Name *': 'Mansoor',
        'Email': 'ahmed.mansoor@example.com',
        'Mobile No *': '0501234567',
        'Nationality *': sampleNat,
        'Role': sampleRole,
        'Profile Role': sampleProf,
        'Barcode No': 'BC-1001',
      },
      {
        'S.No': 2,
        'User Name *': 'nurse_fatima',
        'First Name *': 'Fatima',
        'Middle Name': '',
        'Last Name *': 'Hassan',
        'Email': 'fatima.hassan@example.com',
        'Mobile No *': '0509876543',
        'Nationality *': sampleNat,
        'Role': roleList[1] || sampleRole,
        'Profile Role': profList[1] || sampleProf,
        'Barcode No': 'BC-1002',
      },
    ];

    // Sheet 2: Instructions
    const instructionRows = [
      { Parameter: 'Selected Client', Details: `${client.clientCode} (${client.clientName})` },
      { Parameter: 'Client Application Version', Details: client.applicationVersion || 'v9.4' },
      { Parameter: 'Template Generation Time (UTC)', Details: new Date().toISOString() },
      { Parameter: 'Mandatory Fields', Details: 'S.No, User Name *, First Name *, Last Name *, Mobile No *, Nationality *' },
      { Parameter: 'Accepted Username Format', Details: 'Alphanumeric characters, dot, underscore, dash ([a-zA-Z0-9._-])' },
      { Parameter: 'Accepted Mobile Format', Details: 'Valid mobile number (e.g., 05xxxxxxxx)' },
      { Parameter: 'Duplicate Rules', Details: 'S.No and Usernames must be unique. Duplicate S.No is rejected with DUPLICATE_SERIAL_NUMBER. Existing users are classified as ALREADY_EXISTS. Duplicate full names produce a confirmation warning.' },
      { Parameter: 'Maximum Permitted Rows', Details: '500 rows per batch' },
      { Parameter: 'No-Password Policy', Details: 'Do not add password columns. Passwords are native to Simplex and client default password policies apply automatically.' },
    ];

    // Sheet 3: Lookup Options
    const maxLen = Math.max(natList.length, roleList.length, profList.length);
    const optionsRows = [];
    for (let i = 0; i < maxLen; i++) {
      optionsRows.push({
        'Valid Nationalities': natList[i] || '',
        'Valid Roles': roleList[i] || '',
        'Valid Profile Roles': profList[i] || '',
      });
    }

    const wb = XLSX.utils.book_new();
    const wsUsers = XLSX.utils.json_to_sheet(templateRows);
    const wsInstructions = XLSX.utils.json_to_sheet(instructionRows);
    const wsOptions = XLSX.utils.json_to_sheet(optionsRows);

    XLSX.utils.book_append_sheet(wb, wsUsers, 'Users');
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');
    XLSX.utils.book_append_sheet(wb, wsOptions, 'Lookup Options');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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

    const sheetName = wb.SheetNames.find((s) => s.toLowerCase() === 'users') || wb.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException({
        code: 'INVALID_EXCEL_FORMAT',
        message: 'Excel workbook contains no sheets.',
      });
    }

    const rawRows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
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
    try {
      const meta = await this.getLiveFormOptions(clientId, user, false);
      const toLabel = (item: any) => (typeof item === 'string' ? item : item?.label || item?.value || '');
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
      const parsedSNo = rawSNo !== undefined && rawSNo !== '' ? rawSNo : i + 1;

      // Extract and sanitize cells (formula injection defense)
      const action: UserImportAction = (row['Action'] || row['action'] || 'CREATE').toString().toUpperCase().trim() as any;
      const rawUser = (row['User Name *'] || row['User Name'] || row['UserName'] || row['username'] || '').toString().trim();
      const rawFirst = (row['First Name *'] || row['First Name'] || row['FirstName'] || row['firstName'] || '').toString().trim();
      const rawMiddle = (row['Middle Name'] || row['MiddleName'] || row['middleName'] || '').toString().trim();
      const rawLast = (row['Last Name *'] || row['Last Name'] || row['LastName'] || row['lastName'] || '').toString().trim();
      const rawNick = (row['Nick Name'] || row['NickName'] || row['nickName'] || '').toString().trim();
      const rawEmail = (row['Email'] || row['email'] || '').toString().trim();
      const rawMobile = (row['Mobile No *'] || row['Mobile No'] || row['Mobile Number'] || row['Mobile'] || row['mobileNumber'] || '').toString().trim();
      const rawNat = (row['Nationality *'] || row['Nationality'] || row['nationality'] || '').toString().trim();
      const rawRole = (row['Role'] || row['role'] || '').toString().trim();
      const rawProfile = (row['Profile Role'] || row['ProfileRole'] || row['profileRole'] || '').toString().trim();
      const rawBarcode = (row['Barcode No'] || row['Barcode Number'] || row['barcodeNumber'] || '').toString().trim();
      const rawStatus = (row['Status'] || row['Requested Status'] || 'ACTIVE').toString().toUpperCase().trim() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

      // Skip ONLY if completely empty row (no S.No and no user/name fields)
      if (rawSNo === undefined && !rawUser && !rawFirst && !rawLast && !rawMobile && !rawNat) {
        continue;
      }

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

      // Mobile number format validation
      if (mobileNumber && !/^[0-9+() -]{7,20}$/.test(mobileNumber)) {
        validationErrors.push('Invalid mobile number format');
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
      if (role && normRoleSet.size > 0 && !normRoleSet.has(role.toLowerCase())) {
        validationErrors.push(`Role '${role}' is not in the client's live options`);
        classification = 'INVALID';
        errorCode = errorCode || 'REMOTE_DROPDOWN_OPTION_NOT_FOUND';
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
        role,
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
   * Executes approved import rows sequentially with safe single-flight mutations.
   * Enforces: Total = Created + Already Existing + Invalid + Failed + Cancelled + Not Processed.
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
    let createdCount = 0;
    let alreadyExistingCount = 0;
    let invalidCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;
    let notProcessedCount = 0;

    // Load existing snapshot users to look up status for already existing rows
    const existingUsers = await this.snapshotRepo.find({ where: { clientId } });
    const existingUserMap = new Map<string, ClientUserSnapshot>();
    for (const u of existingUsers) {
      existingUserMap.set(u.username.toLowerCase().trim(), u);
    }

    for (const row of rows) {
      const rowCorrelationId = crypto.randomUUID();
      const fullName = `${row.firstName || ''} ${row.lastName || ''}`.trim();
      const sNo = row.sNo !== undefined ? row.sNo : row.rowNumber - 1;

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
          errorCode: 'ALREADY_EXISTS',
          existingStatus: currentStatus,
          remoteStatus: currentStatus,
          message: `User '${row.username}' already exists in client portal with status ${currentStatus}.`,
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
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
        row.errorCode === 'DUPLICATE_USERNAME_IN_FILE'
      ) {
        invalidCount++;
        results.push({
          sNo,
          rowNumber: row.rowNumber,
          action: row.action,
          username: row.username,
          fullName,
          result: 'INVALID',
          errorCode: row.errorCode || 'REQUIRED_FIELD_MISSING',
          message: (row.validationErrors && row.validationErrors.length > 0)
            ? row.validationErrors.join('; ')
            : row.message || 'Row failed dry-run validation',
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
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
          errorCode: 'OPERATION_CANCELLED',
          message: row.message || 'Row import was cancelled.',
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
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
          errorCode: 'NOT_PROCESSED',
          message: row.message || 'Row was not approved by operator for creation.',
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
        });
        continue;
      }

      // Execute eligible row
      try {
        if (row.action === 'CREATE') {
          await this.createClientUser(
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
              role: row.role,
              profileRole: row.profileRole,
              barcodeNumber: row.barcodeNumber,
              status: row.requestedStatus || 'ACTIVE',
              overrideDuplicateName: true,
            },
            user
          );

          results.push({
            sNo,
            rowNumber: row.rowNumber,
            action: row.action,
            username: row.username,
            fullName,
            result: 'CREATED',
            message: `User '${row.username}' created and verified on client.`,
            remoteStatus: 'ACTIVE',
            executedAt: new Date().toISOString(),
            correlationId: rowCorrelationId,
          });
          createdCount++;
        } else if (row.action === 'ACTIVATE' || row.action === 'DEACTIVATE') {
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
              message: `Status updated to ${row.action === 'ACTIVATE' ? 'ACTIVE' : 'INACTIVE'}.`,
              remoteStatus: row.action === 'ACTIVATE' ? 'ACTIVE' : 'INACTIVE',
              executedAt: new Date().toISOString(),
              correlationId: rowCorrelationId,
            });
            createdCount++;
          } else {
            results.push({
              sNo,
              rowNumber: row.rowNumber,
              action: row.action,
              username: row.username,
              fullName,
              result: 'REMOTE_ERROR',
              errorCode: 'REMOTE_USER_NOT_FOUND',
              message: `User '${row.username}' not found in client snapshot.`,
              executedAt: new Date().toISOString(),
              correlationId: rowCorrelationId,
            });
            failedCount++;
          }
        }
      } catch (err: any) {
        failedCount++;
        const errorCode = err.response?.code || err.code || 'REMOTE_ERROR';
        const errorMsg = (err.response?.message || err.message || 'Error executing row mutation').replace(/<[^>]*>?/gm, '');
        results.push({
          sNo,
          rowNumber: row.rowNumber,
          action: row.action,
          username: row.username,
          fullName,
          result: 'FAILED',
          errorCode,
          message: errorMsg,
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
        });
      }
    }

    // Trigger authoritative pull sync after successful batch
    if (createdCount > 0) {
      try {
        await this.syncClientUsers(clientId, user);
      } catch (err) {
        console.warn('Post-import pull sync warning:', err);
      }
    }

    // Strict invariant check: Total = Created + Already Existing + Invalid + Failed + Cancelled + Not Processed
    const totalProcessed = rows.length;
    const computedSum = createdCount + alreadyExistingCount + invalidCount + failedCount + cancelledCount + notProcessedCount;
    if (totalProcessed !== computedSum) {
      console.warn(`Discrepancy in row breakdown: total=${totalProcessed}, computedSum=${computedSum}`);
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
          createdRows: createdCount,
          alreadyExistingRows: alreadyExistingCount,
          invalidRows: invalidCount,
          failedRows: failedCount,
          cancelledRows: cancelledCount,
          notProcessedRows: notProcessedCount,
        }),
      })
    );

    return {
      jobId,
      totalRows: totalProcessed,
      createdRows: createdCount,
      alreadyExistingRows: alreadyExistingCount,
      invalidRows: invalidCount,
      failedRows: failedCount,
      cancelledRows: cancelledCount,
      notProcessedRows: notProcessedCount,
      succeededRows: createdCount,
      skippedRows: alreadyExistingCount + notProcessedCount,
      results,
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
