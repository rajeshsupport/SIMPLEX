import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import {
  ClientUserSnapshot,
  Client,
  AutomationRun,
  DesktopAgent,
} from '@hmc/database';
import {
  SyncUserBatchDto,
  SyncUserBatchResponse,
  ScrapedUserBatchItem,
  ClientUserSyncSummary,
} from '@hmc/shared';

interface RunBatchBuffer {
  runId: string;
  clientId: string;
  batchId: string;
  totalBatches: number;
  batches: Map<number, ScrapedUserBatchItem[]>;
  batchHashes: Map<number, string>;
  cumulativeRecords: number;
  cumulativeBytes: number;
  createdAt: number;
  isFinalizing?: boolean;
}

@Injectable()
export class ClientDirectoryReconciliationService {
  private readonly logger = new Logger(ClientDirectoryReconciliationService.name);

  // In-memory staging buffer for chunked headless user directory reconciliation
  public static syncBatchBuffers = new Map<string, RunBatchBuffer>();

  constructor(
    @InjectRepository(ClientUserSnapshot)
    private snapshotRepo: Repository<ClientUserSnapshot>,
    @InjectRepository(Client)
    private clientRepo: Repository<Client>,
    @InjectRepository(AutomationRun)
    private runRepo: Repository<AutomationRun>,
    @InjectRepository(DesktopAgent)
    private agentRepo: Repository<DesktopAgent>
  ) {}

  /**
   * Prunes buffers that have exceeded the 15-minute time-to-live threshold.
   */
  public pruneExpiredBuffers(): void {
    const now = Date.now();
    const ttlMs = 15 * 60 * 1000;
    for (const [runId, buffer] of ClientDirectoryReconciliationService.syncBatchBuffers.entries()) {
      if (now - buffer.createdAt > ttlMs) {
        this.logger.warn(`Pruning expired sync batch buffer for runId: ${runId}`);
        ClientDirectoryReconciliationService.syncBatchBuffers.delete(runId);
      }
    }
  }

  /**
   * Discards the staging buffer for a given runId (e.g. on run cancellation or terminal failure).
   */
  public discardBuffer(runId: string): void {
    ClientDirectoryReconciliationService.syncBatchBuffers.delete(runId);
  }

  /**
   * Ingests a single chunk of scraped client users from an authenticated desktop agent.
   */
  async ingestSyncBatch(
    runId: string,
    dto: SyncUserBatchDto,
    auth: { agentId?: string; agentToken?: string }
  ): Promise<SyncUserBatchResponse> {
    if (!dto) throw new BadRequestException('Request body is required');

    // 1. Authenticate Desktop Agent identity
    if (!auth.agentId) {
      throw new UnauthorizedException({
        code: 'AGENT_UNAUTHENTICATED',
        message: 'Missing x-agent-id authentication header.',
      });
    }

    const agent = await this.agentRepo.findOne({ where: { id: auth.agentId } });
    if (!agent) {
      throw new UnauthorizedException({
        code: 'AGENT_NOT_FOUND',
        message: `Desktop Agent '${auth.agentId}' not found.`,
      });
    }

    if (!auth.agentToken) {
      throw new UnauthorizedException({
        code: 'AGENT_TOKEN_REQUIRED',
        message: 'Missing x-agent-token authentication header.',
      });
    }

    if (!agent.authTokenHash) {
      throw new UnauthorizedException({
        code: 'AGENT_NOT_PAIRED',
        message: 'Desktop agent has no active token hash.',
      });
    }

    const isValid = await argon2.verify(agent.authTokenHash, auth.agentToken).catch(() => false);
    if (!isValid) {
      throw new UnauthorizedException({
        code: 'INVALID_AGENT_TOKEN',
        message: 'Invalid agent authentication token.',
      });
    }

    // 2. Validate Automation Run ownership and state
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) {
      throw new BadRequestException({
        code: 'INVALID_RUN_ID',
        message: `Automation run '${runId}' not found.`,
      });
    }

    if (run.desktopAgentId && run.desktopAgentId !== auth.agentId) {
      throw new ForbiddenException({
        code: 'AGENT_RUN_MISMATCH',
        message: 'This automation run belongs to a different desktop agent.',
      });
    }

    if (run.runType !== 'SYNC_CLIENT_USERS_HEADLESS' && run.runType !== 'SYNC_CLIENT_USERS') {
      throw new BadRequestException({
        code: 'INVALID_RUN_TYPE',
        message: `Run task type '${run.runType}' does not accept directory sync batches.`,
      });
    }

    if (run.clientId !== dto.clientId) {
      throw new BadRequestException({
        code: 'CLIENT_MISMATCH',
        message: 'Batch clientId does not match automation run clientId.',
      });
    }

    if (['SUCCEEDED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(run.status)) {
      throw new BadRequestException({
        code: 'RUN_TERMINAL',
        message: `Run '${runId}' is in terminal status '${run.status}' and cannot accept batches.`,
      });
    }

    // 3. Validate record limits and field lengths
    if (!dto.users || !Array.isArray(dto.users)) {
      throw new BadRequestException('users array is required');
    }

    if (dto.users.length > 100) {
      throw new BadRequestException({
        code: 'BATCH_SIZE_EXCEEDED',
        message: `Batch record count ${dto.users.length} exceeds maximum allowed of 100 users per batch.`,
      });
    }

    if (dto.totalBatches < 1 || dto.totalBatches > 50) {
      throw new BadRequestException({
        code: 'INVALID_TOTAL_BATCHES',
        message: `totalBatches ${dto.totalBatches} must be between 1 and 50.`,
      });
    }

    if (dto.sequenceNumber < 1 || dto.sequenceNumber > dto.totalBatches) {
      throw new BadRequestException({
        code: 'INVALID_BATCH_SEQUENCE',
        message: `sequenceNumber ${dto.sequenceNumber} must be between 1 and totalBatches ${dto.totalBatches}.`,
      });
    }

    for (let userIdx = 0; userIdx < dto.users.length; userIdx++) {
      const u = dto.users[userIdx];
      if (!u.username || typeof u.username !== 'string' || u.username.length > 100) {
        throw new BadRequestException({
          code: 'INVALID_FIELD_LENGTH',
          message: `Row ${userIdx + 1} (${u.username || 'unknown'}): Username is required and must be <= 100 characters.`,
        });
      }
      if (!/^[a-zA-Z0-9._@:-]{1,100}$/.test(u.username)) {
        throw new BadRequestException({
          code: 'INVALID_FIELD_VALUE',
          message: `Row ${userIdx + 1} (${u.username}): Username contains invalid characters; must match [a-zA-Z0-9._@:-].`,
        });
      }

      // Reject non-printable ASCII control characters and lone surrogates across user fields
      const textFields: [string, any][] = [
        ['username', u.username],
        ['fullName', u.fullName],
        ['role', u.role],
        ['email', u.email],
        ['mobileNumber', u.mobileNumber],
        ['status', u.status],
        ['remoteUserId', u.remoteUserId],
      ];
      for (const [fieldName, fieldVal] of textFields) {
        if (typeof fieldVal === 'string') {
          if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(fieldVal)) {
            throw new BadRequestException({
              code: 'INVALID_PAYLOAD_CHARACTERS',
              message: `Row ${userIdx + 1} (${u.username}): Prohibited control characters in field '${fieldName}'.`,
            });
          }
          if (/(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(fieldVal)) {
            throw new BadRequestException({
              code: 'INVALID_PAYLOAD_CHARACTERS',
              message: `Row ${userIdx + 1} (${u.username}): Lone surrogates are disallowed in field '${fieldName}'.`,
            });
          }
        }
      }

      // fullName: nvarchar(250) in entity
      if (u.fullName !== undefined && u.fullName !== null) {
        if (typeof u.fullName !== 'string') {
          throw new BadRequestException({
            code: 'INVALID_FIELD_VALUE',
            message: `Row ${userIdx + 1} (${u.username}): fullName must be a string.`,
          });
        }
        if (u.fullName.length > 250) {
          throw new BadRequestException({
            code: 'INVALID_FIELD_LENGTH',
            message: `Row ${userIdx + 1} (${u.username}): fullName length (${u.fullName.length}) exceeds maximum allowed of 250 characters.`,
          });
        }
      }

      // role: nvarchar(MAX) in entity, bounded in batch DTO to 4000
      if (u.role !== undefined && u.role !== null) {
        if (typeof u.role !== 'string') {
          throw new BadRequestException({
            code: 'INVALID_FIELD_VALUE',
            message: `Row ${userIdx + 1} (${u.username}): role must be a string.`,
          });
        }
        if (u.role.length > 4000) {
          throw new BadRequestException({
            code: 'INVALID_FIELD_LENGTH',
            message: `Row ${userIdx + 1} (${u.username}): role length (${u.role.length}) exceeds maximum allowed of 4000 characters.`,
          });
        }
      }

      // email: nvarchar(255) nullable/optional - validate type and database length, preserve exact observational value without restrictive modern regex
      if (u.email !== undefined && u.email !== null && u.email !== '') {
        if (typeof u.email !== 'string') {
          throw new BadRequestException({
            code: 'INVALID_FIELD_VALUE',
            message: `Row ${userIdx + 1} (${u.username}): email must be a string.`,
          });
        }
        if (u.email.length > 255) {
          throw new BadRequestException({
            code: 'INVALID_FIELD_LENGTH',
            message: `Row ${userIdx + 1} (${u.username}): email length (${u.email.length}) exceeds maximum allowed of 255 characters.`,
          });
        }
      }

      // mobileNumber: nvarchar(50) nullable/optional - validate type and database length, preserve exact observational value without restrictive modern regex
      if (u.mobileNumber !== undefined && u.mobileNumber !== null && u.mobileNumber !== '') {
        if (typeof u.mobileNumber !== 'string') {
          throw new BadRequestException({
            code: 'INVALID_FIELD_VALUE',
            message: `Row ${userIdx + 1} (${u.username}): mobileNumber must be a string.`,
          });
        }
        if (u.mobileNumber.length > 50) {
          throw new BadRequestException({
            code: 'INVALID_FIELD_LENGTH',
            message: `Row ${userIdx + 1} (${u.username}): mobileNumber length (${u.mobileNumber.length}) exceeds maximum allowed of 50 characters.`,
          });
        }
      }

      // status: nvarchar(50) in entity. Accept only positively observed ACTIVE or INACTIVE; never default missing to ACTIVE.
      if (!u.status || typeof u.status !== 'string' || !['ACTIVE', 'INACTIVE'].includes(u.status)) {
        throw new BadRequestException({
          code: 'INVALID_STATUS_VALUE',
          message: `Row ${userIdx + 1} (${u.username}): status '${u.status || ''}' is invalid or missing; must be positively observed ACTIVE or INACTIVE.`,
        });
      }

      // remoteUserId: nvarchar(100) nullable/optional. Supports alphanumeric, dots, underscores, hyphens, colons, and @
      if (u.remoteUserId !== undefined && u.remoteUserId !== null && u.remoteUserId.trim() !== '') {
        if (typeof u.remoteUserId !== 'string') {
          throw new BadRequestException({
            code: 'INVALID_FIELD_VALUE',
            message: `Row ${userIdx + 1} (${u.username}): remoteUserId must be a string.`,
          });
        }
        if (u.remoteUserId.length > 100) {
          throw new BadRequestException({
            code: 'INVALID_FIELD_LENGTH',
            message: `Row ${userIdx + 1} (${u.username}): remoteUserId length (${u.remoteUserId.length}) exceeds maximum allowed of 100 characters.`,
          });
        }
        if (!/^[a-zA-Z0-9._@:-]{1,100}$/.test(u.remoteUserId)) {
          throw new BadRequestException({
            code: 'INVALID_FIELD_VALUE',
            message: `Row ${userIdx + 1} (${u.username}): remoteUserId format is invalid; must match [a-zA-Z0-9._@:-].`,
          });
        }
      }
    }

    // 4. Staging Buffer Assembly & Idempotency
    this.pruneExpiredBuffers();

    let buffer = ClientDirectoryReconciliationService.syncBatchBuffers.get(runId);
    if (!buffer) {
      if (dto.sequenceNumber > 1) {
        // API restart or buffer lost
        throw new BadRequestException({
          code: 'BATCH_BUFFER_NOT_FOUND',
          message: `Batch buffer not found for run '${runId}'. API may have restarted; please re-initiate directory sync.`,
        });
      }
      buffer = {
        runId,
        clientId: run.clientId,
        batchId: dto.batchId,
        totalBatches: dto.totalBatches,
        batches: new Map(),
        batchHashes: new Map(),
        cumulativeRecords: 0,
        cumulativeBytes: 0,
        createdAt: Date.now(),
        isFinalizing: false,
      };
      ClientDirectoryReconciliationService.syncBatchBuffers.set(runId, buffer);
    } else {
      if (buffer.batchId !== dto.batchId) {
        throw new BadRequestException({
          code: 'BATCH_ID_MISMATCH',
          message: 'batchId cannot change within the same run buffer.',
        });
      }
      if (buffer.clientId !== run.clientId) {
        throw new BadRequestException({
          code: 'CLIENT_MISMATCH',
          message: 'Batch clientId does not match existing run buffer.',
        });
      }
      if (buffer.totalBatches !== dto.totalBatches) {
        throw new BadRequestException({
          code: 'TOTAL_BATCHES_MISMATCH',
          message: `totalBatches ${dto.totalBatches} does not match initial batch config ${buffer.totalBatches}.`,
        });
      }
    }

    const chunkContentJson = JSON.stringify(dto.users);
    const chunkHash = crypto.createHash('sha256').update(chunkContentJson).digest('hex');

    // Duplicate chunk check:
    if (buffer.batches.has(dto.sequenceNumber)) {
      const existingHash = buffer.batchHashes.get(dto.sequenceNumber);
      if (existingHash === chunkHash) {
        return {
          success: true,
          batchId: dto.batchId,
          sequenceNumber: dto.sequenceNumber,
          totalBatches: dto.totalBatches,
          isFinalBatch: dto.isFinalBatch,
          isDuplicate: true,
          receivedCount: dto.users.length,
        };
      } else {
        throw new ConflictException({
          code: 'BATCH_CONTENT_MISMATCH',
          message: `Batch sequence ${dto.sequenceNumber} content hash mismatch with previously received batch.`,
        });
      }
    }

    // Reject out-of-order sequences
    if (dto.sequenceNumber > 1 && !buffer.batches.has(dto.sequenceNumber - 1)) {
      throw new BadRequestException({
        code: 'OUT_OF_ORDER_SEQUENCE',
        message: `Batch sequence ${dto.sequenceNumber} received out of order; expected ${buffer.batches.size + 1}.`,
      });
    }

    // Cumulative bounds check
    const newCumulativeRecords = buffer.cumulativeRecords + dto.users.length;
    if (newCumulativeRecords > 5000) {
      throw new BadRequestException({
        code: 'CUMULATIVE_RECORDS_EXCEEDED',
        message: `Cumulative records across batches (${newCumulativeRecords}) exceeds maximum allowed of 5000.`,
      });
    }

    const chunkBytes = Buffer.byteLength(JSON.stringify(dto), 'utf8');
    const newCumulativeBytes = buffer.cumulativeBytes + chunkBytes;
    if (newCumulativeBytes > 5 * 1024 * 1024) {
      throw new BadRequestException({
        code: 'CUMULATIVE_BYTES_EXCEEDED',
        message: `Cumulative batch bytes (${newCumulativeBytes}) exceeds maximum allowed limit of 5MB.`,
      });
    }

    buffer.batches.set(dto.sequenceNumber, dto.users);
    buffer.batchHashes.set(dto.sequenceNumber, chunkHash);
    buffer.cumulativeRecords = newCumulativeRecords;
    buffer.cumulativeBytes = newCumulativeBytes;

    // 5. Finalization check
    if (dto.isFinalBatch) {
      for (let s = 1; s <= dto.totalBatches; s++) {
        if (!buffer.batches.has(s)) {
          throw new BadRequestException({
            code: 'MISSING_BATCH_SEQUENCE',
            message: `Cannot finalize: batch sequence ${s} of ${dto.totalBatches} is missing.`,
          });
        }
      }

      if (buffer.isFinalizing) {
        throw new ConflictException({
          code: 'FINALIZATION_IN_PROGRESS',
          message: 'Reconciliation finalization is already in progress for this run.',
        });
      }
      buffer.isFinalizing = true;

      const allUsers: ScrapedUserBatchItem[] = [];
      for (let s = 1; s <= dto.totalBatches; s++) {
        allUsers.push(...buffer.batches.get(s)!);
      }

      let persistedCount = 0;
      try {
        const summary = await this.persistScrapedUsers(run.clientId, allUsers, {
          remoteRowsRead: allUsers.length,
          remotePagesRead: 1,
          remoteDuplicatesRemoved: 0,
          remoteUniqueUsers: allUsers.length,
          syncRunId: run.id,
        });
        persistedCount = summary.centralRowsPersisted;
      } finally {
        ClientDirectoryReconciliationService.syncBatchBuffers.delete(runId);
      }

      return {
        success: true,
        batchId: dto.batchId,
        sequenceNumber: dto.sequenceNumber,
        totalBatches: dto.totalBatches,
        isFinalBatch: true,
        receivedCount: dto.users.length,
        finalized: true,
        persistedCount,
      };
    }

    return {
      success: true,
      batchId: dto.batchId,
      sequenceNumber: dto.sequenceNumber,
      totalBatches: dto.totalBatches,
      isFinalBatch: false,
      receivedCount: dto.users.length,
    };
  }

  private static completionLocks = new Map<string, Promise<void>>();

  /**
   * Persists verified Central snapshot for single user creation / multi-role completion.
   * Invoked strictly via authenticated automation telemetry/completion command path.
   * Fully idempotent with single-flight concurrency mutex and conflict detection.
   */
  async persistCreationCompletionSnapshot(run: AutomationRun, resultData?: any): Promise<void> {
    if (!run || !run.clientId) return;

    let params: any = {};
    try {
      params = JSON.parse(run.parametersJson || '{}');
    } catch {}

    const dto = params.payload || params;
    const targetUsername = (dto.username || params.username || '').trim();
    if (!targetUsername) return;

    const normUsername = targetUsername.toLowerCase();
    const lockKey = `${run.clientId}:${normUsername}`;

    while (ClientDirectoryReconciliationService.completionLocks.has(lockKey)) {
      await ClientDirectoryReconciliationService.completionLocks.get(lockKey);
    }
    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    ClientDirectoryReconciliationService.completionLocks.set(lockKey, lockPromise);

    try {
      const client = await this.clientRepo.findOne({ where: { id: run.clientId } });

      let snapshot = await this.snapshotRepo
        .createQueryBuilder('u')
        .where('u.clientId = :clientId', { clientId: run.clientId })
        .andWhere('LOWER(u.username) = :normUsername', { normUsername })
        .getOne();

      // Conflicting terminal telemetry check: if snapshot already verified with distinct remoteUserId
      if (snapshot && snapshot.remoteUserId && resultData?.remoteUserId && snapshot.remoteUserId !== resultData.remoteUserId) {
        this.logger.warn(
          `Conflicting terminal telemetry for user '${targetUsername}': existing remoteUserId '${snapshot.remoteUserId}' vs incoming '${resultData.remoteUserId}'. Telemetry conflict audit logged; verified snapshot preserved.`
        );
        return;
      }

      const fullName = `${dto.firstName || ''} ${dto.lastName || ''}`.trim() || targetUsername;
      const now = new Date();

      if (!snapshot) {
        snapshot = this.snapshotRepo.create({
          clientId: run.clientId,
          clientCode: client?.clientCode,
          username: targetUsername,
          firstName: (dto.firstName || '').trim(),
          middleName: (dto.middleName || '').trim() || null,
          lastName: (dto.lastName || '').trim(),
          fullName,
          nickName: (dto.nickName || '').trim() || null,
          email: (dto.email || '').trim() || null,
          mobileNumber: (dto.mobileNumber || '').trim(),
          nationality: dto.nationality,
          role: dto.role || (dto.roles ? dto.roles.join(', ') : null),
          profileRole: dto.profileRole || null,
          status: dto.status || 'ACTIVE',
          barcodeNumber: dto.barcodeNumber || null,
          hasSignature: Boolean(dto.signatureBase64),
          hasStamp: Boolean(dto.stampBase64),
          hasProfileImage: Boolean(dto.profileBase64),
          remoteUserId: resultData?.remoteUserId || `remote_${targetUsername}`,
          isPresentRemotely: true,
          syncRunId: run.id,
          lastSyncedAt: now,
          lastVerifiedAt: now,
        });
      } else {
        snapshot.firstName = (dto.firstName || snapshot.firstName || '').trim();
        snapshot.lastName = (dto.lastName || snapshot.lastName || '').trim();
        snapshot.fullName = fullName;
        snapshot.email = (dto.email || snapshot.email || '').trim() || null;
        snapshot.mobileNumber = (dto.mobileNumber || snapshot.mobileNumber || '').trim();
        if (dto.role || dto.roles) {
          snapshot.role = dto.role || (dto.roles ? dto.roles.join(', ') : snapshot.role);
        }
        snapshot.status = dto.status || snapshot.status || 'ACTIVE';
        snapshot.isPresentRemotely = true;
        snapshot.syncRunId = run.id;
        snapshot.lastSyncedAt = now;
        snapshot.lastVerifiedAt = now;
      }

      await this.snapshotRepo.save(snapshot);
      this.logger.log(`Persisted verified Central snapshot for '${targetUsername}' (run: ${run.id})`);
    } finally {
      ClientDirectoryReconciliationService.completionLocks.delete(lockKey);
      releaseLock();
    }
  }

  /**
   * Deduplicates and atomically commits scraped user directory snapshots to Central DB.
   */
  public async persistScrapedUsers(
    clientId: string,
    scrapedUsers: any[],
    meta?: {
      remoteRowsRead?: number;
      remotePagesRead?: number;
      remoteDuplicatesRemoved?: number;
      remoteUniqueUsers?: number;
      syncRunId?: string;
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

    // Deduplicate within client
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

    const syncRunId = meta?.syncRunId || crypto.randomUUID();
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
          username: su.username,
          remoteUserId: su.remoteUserId || null,
          firstName: su.firstName,
          middleName: su.middleName,
          lastName: su.lastName,
          fullName: su.fullName !== undefined && su.fullName !== null ? su.fullName : (su.firstName || su.lastName ? `${su.firstName || ''} ${su.lastName || ''}`.trim() : su.username),
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
          lastVerifiedAt: now,
        });
      } else {
        if (su.remoteUserId !== undefined) {
          snapshot.remoteUserId = su.remoteUserId || null;
        }
        snapshot.firstName = su.firstName;
        snapshot.middleName = su.middleName;
        snapshot.lastName = su.lastName;
        if (su.fullName !== undefined && su.fullName !== null) {
          snapshot.fullName = su.fullName;
        }
        snapshot.email = su.email;
        snapshot.mobileNumber = su.mobileNumber;
        if (su.role && su.role.trim().toUpperCase() !== 'USER') {
          snapshot.role = su.role;
        } else if (!snapshot.role) {
          snapshot.role = su.role;
        }
        if (su.status) {
          snapshot.status = su.status;
        }
        snapshot.hasSignature = su.hasSignature || false;
        snapshot.hasStamp = su.hasStamp || false;
        snapshot.hasProfileImage = su.hasProfileImage || false;
        snapshot.isPresentRemotely = true;
        snapshot.syncRunId = syncRunId;
        snapshot.lastSyncedAt = now;
        snapshot.lastVerifiedAt = now;
      }
      await this.snapshotRepo.save(snapshot);
      centralRowsPersisted++;
    }

    // Mark previous snapshots not in remote scrape as isPresentRemotely = false
    const existingSnapshots = await this.snapshotRepo.find({ where: { clientId } });
    let staleRowsExcluded = 0;
    for (const existing of existingSnapshots) {
      if (!activeUsernames.has(existing.username.toLowerCase())) {
        existing.isPresentRemotely = false;
        await this.snapshotRepo.save(existing);
        staleRowsExcluded++;
      }
    }

    return {
      remoteRowsRead: rawRowsRead,
      remotePagesRead: pagesRead,
      remoteDuplicatesRemoved: duplicatesRemoved,
      remoteUniqueUsers,
      centralRowsPersisted,
      centralRowsDisplayed: centralRowsPersisted,
      staleRowsExcluded,
      crossClientRowsExcluded: 0,
      syncRunId,
    };
  }
}
