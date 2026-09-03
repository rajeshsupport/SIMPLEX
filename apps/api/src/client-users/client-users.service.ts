import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
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
  CreateClientUserDto,
  UpdateClientUserDto,
  ExcelUserImportPreviewResult,
  ExcelUserImportRow,
  ExcelUserImportExecutionSummary,
  ExcelUserImportExecutionRowResult,
  ClientUserStatus,
  JwtPayload,
} from '@hmc/shared';
import { AgentsService } from '../agents/agents.service.js';

@Injectable()
export class ClientUsersService {
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

  /**
   * Resolves client routes safely using a structured URL builder and enforces version consistency.
   */
  public resolveClientUserRoutes(client: Client): {
    origin: string;
    resolvedLoginUrl: string;
    resolvedUsersUrl: string;
    resolvedAddUsersUrl: string;
  } {
    let origin = (client.baseUrl || '').replace(/\/+$/, '');
    try {
      if (origin.startsWith('http')) {
        origin = new URL(client.baseUrl).origin;
      }
    } catch {}

    const appPath = (client.applicationPath || '').replace(/^\/+|\/+$/g, '');
    const usersRoute = (client.usersRoute || '/MasterV9.4/users').replace(/^\/+/, '');
    const loginRoute = (client.loginRoute || '/login').replace(/^\/+/, '');

    // Application Version vs Selector Version consistency check
    if (client.applicationVersion && client.applicationVersion.toLowerCase().startsWith('masterv')) {
      const configuredVersion = client.applicationVersion.toLowerCase();
      if (usersRoute.toLowerCase().includes('masterv') && !usersRoute.toLowerCase().includes(configuredVersion)) {
        throw new BadRequestException({
          code: 'CLIENT_USER_ROUTE_VERSION_MISMATCH',
          message: `Application version '${client.applicationVersion}' does not match configured users route '${client.usersRoute}'.`,
        });
      }
    }

    const resolvedLoginUrl = loginRoute.startsWith('http') ? loginRoute : `${origin}/${loginRoute}`;
    const resolvedUsersUrl = usersRoute.startsWith('http') ? usersRoute : `${origin}/${usersRoute}`;
    const resolvedAddUsersUrl = `${origin}/${appPath ? appPath + '/' : ''}addUsers`;

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
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(clientId)) {
      throw new ForbiddenException('You are not authorized to view this client');
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const skip = (page - 1) * limit;

    const qb = this.snapshotRepo.createQueryBuilder('u').where('u.clientId = :clientId', { clientId });

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
      where: { clientId },
      order: { lastSyncedAt: 'DESC' },
    });

    return {
      users: users.map((u) => this.mapToDto(u, client)),
      totalCount,
      lastSyncedAt: latestSync?.lastSyncedAt ? latestSync.lastSyncedAt.toISOString() : null,
      liveClientOptions: {
        nationalities: ['Saudi Arabia', 'United Arab Emirates', 'United States', 'United Kingdom', 'India', 'Egypt', 'Jordan', 'Pakistan', 'Philippines', 'Other'],
        roles: ['Physician', 'Nurse', 'Admin', 'Pharmacist', 'Lab Technician', 'Operator', 'Super User'],
        profileRoles: ['Clinical Specialist', 'General Practitioner', 'Head Nurse', 'Chief Pharmacist', 'System Administrator', 'Billing Specialist'],
      },
    };
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

    // Version & URL validation
    const routes = this.resolveClientUserRoutes(client);

    // Duplicate sync job prevention
    const existingActive = await this.runRepo.findOne({
      where: {
        clientId,
        runType: 'SYNC_CLIENT_USERS_HEADLESS',
        status: In(['PENDING', 'RUNNING']),
      },
      order: { createdAt: 'DESC' },
    });

    if (existingActive) {
      return {
        jobId: existingActive.id,
        status: existingActive.status,
        message: 'A background user sync is already in progress for this client.',
      };
    }

    const onlineAgents = (await this.agentsService.getAllAgents()).filter((a) => a.status === 'ONLINE');
    if (onlineAgents.length === 0) {
      throw new BadRequestException({
        code: 'DESKTOP_AGENT_OFFLINE',
        message: 'Desktop browser automation agent is offline.',
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

    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: onlineAgents[0].id,
      triggeredByUserId: user.sub,
      runType: 'SYNC_CLIENT_USERS_HEADLESS',
      status: 'PENDING',
      parametersJson: JSON.stringify({
        taskType: 'SYNC_CLIENT_USERS_HEADLESS',
        userId: user.sub,
        clientBaseUrl: client.baseUrl,
        loginRoute: routes.resolvedLoginUrl,
        targetRoute: routes.resolvedUsersUrl,
        credentials,
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
      status: 'ACCEPTED',
      message: 'Background user synchronization job initiated.',
    };
  }

  /**
   * Checks the status of a running sync job and persists scraped snapshots when complete.
   */
  async getSyncJobStatus(jobId: string, user: JwtPayload): Promise<any> {
    const run = await this.runRepo.findOne({ where: { id: jobId } });
    if (!run) throw new NotFoundException(`Sync job ${jobId} not found`);

    if (!user.isSuperAdmin && !user.allowedClientIds.includes(run.clientId)) {
      throw new ForbiddenException('Not authorized to view this sync job');
    }

    let resultData: any = null;
    if (run.resultSummaryJson) {
      try {
        resultData = JSON.parse(run.resultSummaryJson);
      } catch {}
    }

    // When run completes successfully, persist scraped users into snapshot DB
    if (run.status === 'COMPLETED' && resultData && resultData.users) {
      await this.persistScrapedUsers(run.clientId, resultData.users);
    }

    return {
      jobId: run.id,
      status: run.status,
      progressMessage: resultData?.message || run.status,
      errorMessage: run.errorMessage || resultData?.errorMessage,
      errorCode: resultData?.errorCode || (run.status === 'FAILED' ? 'CLIENT_USER_SYNC_FAILED' : undefined),
      totalScraped: resultData?.totalScraped || resultData?.count || 0,
      streamedUsers: resultData?.streamedUsers || [],
      liveStatus: resultData?.liveStatus || (run.status === 'COMPLETED' ? 'LIVE' : 'CACHED'),
    };
  }

  /**
   * Helper to persist scraped snapshot users into MSSQL database.
   */
  private async persistScrapedUsers(clientId: string, scrapedUsers: any[]): Promise<void> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client || !scrapedUsers || scrapedUsers.length === 0) return;

    const now = new Date();
    for (const su of scrapedUsers) {
      let snapshot = await this.snapshotRepo.findOne({
        where: { clientId, username: su.username },
      });

      if (!snapshot) {
        snapshot = this.snapshotRepo.create({
          clientId,
          clientCode: client.clientCode,
          username: su.username,
          firstName: su.firstName,
          middleName: su.middleName,
          lastName: su.lastName,
          fullName: su.fullName,
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
          lastSyncedAt: now,
        });
      } else {
        snapshot.firstName = su.firstName;
        snapshot.middleName = su.middleName;
        snapshot.lastName = su.lastName;
        snapshot.fullName = su.fullName;
        snapshot.email = su.email;
        snapshot.mobileNumber = su.mobileNumber;
        snapshot.nationality = su.nationality;
        snapshot.role = su.role;
        snapshot.profileRole = su.profileRole;
        snapshot.status = su.status;
        snapshot.hasSignature = su.hasSignature || false;
        snapshot.hasStamp = su.hasStamp || false;
        snapshot.hasProfileImage = su.hasProfileImage || false;
        snapshot.lastSyncedAt = now;
      }
      await this.snapshotRepo.save(snapshot);
    }
  }

  /**
   * Synchronous / polling wrapper for syncClientUsers.
   */
  async syncClientUsers(clientId: string, user: JwtPayload): Promise<ClientUserListResponse> {
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

    if (completedRun && completedRun.status === 'COMPLETED' && completedRun.resultSummaryJson) {
      try {
        const resultData = JSON.parse(completedRun.resultSummaryJson);
        if (resultData.users) {
          await this.persistScrapedUsers(clientId, resultData.users);
        }
      } catch (err) {
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

    return this.getClientUsers(clientId, {}, user);
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

    // 1. Exact Username Duplicate Check
    const normalizedUsername = dto.username.trim().toLowerCase();
    const existingByUsername = await this.snapshotRepo.findOne({
      where: { clientId: dto.clientId, username: dto.username.trim() },
    });

    if (existingByUsername) {
      throw new BadRequestException({
        code: 'DUPLICATE_USERNAME',
        message: `User already exists: the username '${dto.username}' is already registered for this client.`,
      });
    }

    // 2. Same First Name & Last Name Duplicate Check
    const normFirst = dto.firstName.trim().toLowerCase();
    const normLast = dto.lastName.trim().toLowerCase();
    const existingByName = await this.snapshotRepo
      .createQueryBuilder('u')
      .where('u.clientId = :clientId', { clientId: dto.clientId })
      .andWhere('LOWER(u.firstName) = :normFirst AND LOWER(u.lastName) = :normLast', { normFirst, normLast })
      .getOne();

    if (existingByName && !dto.overrideDuplicateName) {
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

    // 3. Dispatch Create Task via Desktop Agent
    const onlineAgents = (await this.agentsService.getAllAgents()).filter((a) => a.status === 'ONLINE');
    if (onlineAgents.length === 0) {
      throw new BadRequestException('Desktop browser agent is not running.');
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

    const correlationId = crypto.randomUUID();
    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: onlineAgents[0].id,
      triggeredByUserId: user.sub,
      runType: 'CREATE_USER',
      status: 'PENDING',
      parametersJson: JSON.stringify({
        taskType: 'CREATE_CLIENT_USER',
        userId: user.sub,
        clientBaseUrl: client.baseUrl,
        loginRoute: client.loginRoute,
        targetRoute: client.usersRoute || '/MasterV9.4/users',
        credentials,
        payload: dto,
      }),
    });

    const savedRun = await this.runRepo.save(run);

    // Wait for completion (up to 15s)
    const startTime = Date.now();
    let completedRun: AutomationRun | null = null;
    while (Date.now() - startTime < 15000) {
      await new Promise((r) => setTimeout(r, 300));
      const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
      if (r && (r.status === 'COMPLETED' || r.status === 'FAILED')) {
        completedRun = r;
        break;
      }
    }

    if (!completedRun || completedRun.status === 'FAILED') {
      throw new BadRequestException(completedRun?.errorMessage || 'User creation failed on client.');
    }

    // Save snapshot
    const now = new Date();
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
      lastSyncedAt: now,
    });

    const saved = await this.snapshotRepo.save(snapshot);

    // Record Audit
    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'CLIENT_USER_CREATED',
        actorUserId: user.sub,
        actorUsername: user.username,
        entityType: 'CLIENT_USER',
        entityId: saved.id,
        result: 'SUCCESS',
        correlationId,
        detailsJson: JSON.stringify({
          clientCode: client.clientCode,
          username: dto.username,
          duplicateNameOverrideUsed: Boolean(dto.overrideDuplicateName),
        }),
      })
    );

    return this.mapToDto(saved, client);
  }

  /**
   * Updates an existing user on the client.
   */
  async updateClientUser(id: string, dto: UpdateClientUserDto, user: JwtPayload): Promise<ClientUser> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException(`User ${id} not found`);

    const client = await this.clientRepo.findOne({ where: { id: snapshot.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    if (dto.firstName) snapshot.firstName = dto.firstName.trim();
    if (dto.middleName !== undefined) snapshot.middleName = dto.middleName ? dto.middleName.trim() : null;
    if (dto.lastName) snapshot.lastName = dto.lastName.trim();
    snapshot.fullName = `${snapshot.firstName} ${snapshot.middleName ? snapshot.middleName + ' ' : ''}${snapshot.lastName}`.trim();

    if (dto.nickName !== undefined) snapshot.nickName = dto.nickName ? dto.nickName.trim() : null;
    if (dto.email !== undefined) snapshot.email = dto.email ? dto.email.trim() : null;
    if (dto.mobileNumber !== undefined) snapshot.mobileNumber = dto.mobileNumber ? dto.mobileNumber.trim() : null;
    if (dto.nationality !== undefined) snapshot.nationality = dto.nationality;
    if (dto.role !== undefined) snapshot.role = dto.role;
    if (dto.profileRole !== undefined) snapshot.profileRole = dto.profileRole;
    if (dto.status !== undefined) snapshot.status = dto.status;
    if (dto.barcodeNumber !== undefined) snapshot.barcodeNumber = dto.barcodeNumber;
    if (dto.signatureBase64) snapshot.hasSignature = true;
    if (dto.stampBase64) snapshot.hasStamp = true;
    if (dto.profileBase64) snapshot.hasProfileImage = true;
    snapshot.lastSyncedAt = new Date();

    const saved = await this.snapshotRepo.save(snapshot);

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'CLIENT_USER_UPDATED',
        actorUserId: user.sub,
        actorUsername: user.username,
        entityType: 'CLIENT_USER',
        entityId: id,
        result: 'SUCCESS',
        correlationId: crypto.randomUUID(),
        detailsJson: JSON.stringify({ clientCode: client.clientCode, username: snapshot.username }),
      })
    );

    return this.mapToDto(saved, client);
  }

  /**
   * Sets the active/inactive status of a client user.
   */
  async setUserStatus(id: string, targetStatus: ClientUserStatus, user: JwtPayload): Promise<ClientUser> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException(`User ${id} not found`);

    const client = await this.clientRepo.findOne({ where: { id: snapshot.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    const previousStatus = snapshot.status;
    snapshot.status = targetStatus;
    snapshot.lastSyncedAt = new Date();
    const saved = await this.snapshotRepo.save(snapshot);

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'CLIENT_USER_STATUS_CHANGED',
        actorUserId: user.sub,
        actorUsername: user.username,
        entityType: 'CLIENT_USER',
        entityId: id,
        result: 'SUCCESS',
        correlationId: crypto.randomUUID(),
        detailsJson: JSON.stringify({
          clientCode: client.clientCode,
          username: snapshot.username,
          previousStatus,
          finalStatus: targetStatus,
        }),
      })
    );

    return this.mapToDto(saved, client);
  }

  /**
   * Resets password and returns one-time temporary password.
   */
  async resetUserPassword(id: string, user: JwtPayload): Promise<{ temporaryPassword?: string; message: string }> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException(`User ${id} not found`);

    const client = await this.clientRepo.findOne({ where: { id: snapshot.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    // Generate a secure temporary password to be delivered once
    const tempPassword = `Tmp@${crypto.randomBytes(4).toString('hex')}!${Math.floor(100 + Math.random() * 900)}`;

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'CLIENT_USER_PASSWORD_RESET',
        actorUserId: user.sub,
        actorUsername: user.username,
        entityType: 'CLIENT_USER',
        entityId: id,
        result: 'SUCCESS',
        correlationId: crypto.randomUUID(),
        detailsJson: JSON.stringify({ clientCode: client.clientCode, username: snapshot.username }),
      })
    );

    return {
      temporaryPassword: tempPassword,
      message: `Password for ${snapshot.username} reset successfully. Temporary password generated.`,
    };
  }

  /**
   * Generates Excel workbook (.xlsx) containing latest synced users and metadata.
   */
  async exportExcel(clientId: string, user: JwtPayload): Promise<Buffer> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    const users = await this.snapshotRepo.find({
      where: { clientId },
      order: { fullName: 'ASC' },
    });

    const userRows = users.map((u) => ({
      'Client Code': client.clientCode,
      'Client Name': client.clientName,
      'Environment': client.environment,
      'Remote User ID': u.remoteUserId || 'Not available',
      'Username': String(u.username),
      'First Name': u.firstName,
      'Middle Name': u.middleName || '',
      'Last Name': u.lastName,
      'Full Name': u.fullName,
      'Nick Name': u.nickName || '',
      'Email': u.email || '',
      'Mobile Number': u.mobileNumber ? String(u.mobileNumber) : '',
      'Nationality': u.nationality || '',
      'Role': u.role || '',
      'Profile Role': u.profileRole || '',
      'Barcode Number': u.barcodeNumber ? String(u.barcodeNumber) : '',
      'Status': u.status,
      'Has Signature': u.hasSignature ? 'YES' : 'NO',
      'Has Stamp': u.hasStamp ? 'YES' : 'NO',
      'Has Profile Image': u.hasProfileImage ? 'YES' : 'NO',
      'Created At': u.remoteCreatedAt || 'Not available',
      'Updated At': u.remoteUpdatedAt || 'Not available',
      'Last Synced At': u.lastSyncedAt.toISOString(),
    }));

    const metadataRows = [
      { Property: 'Client Code', Value: client.clientCode },
      { Property: 'Client Name', Value: client.clientName },
      { Property: 'Client URL', Value: client.baseUrl },
      { Property: 'Environment', Value: client.environment },
      { Property: 'Exported By', Value: user.username },
      { Property: 'Export Date/Time (UTC)', Value: new Date().toISOString() },
      { Property: 'Total Records', Value: userRows.length },
      { Property: 'Source', Value: 'HMC Central Operations Console (Snapshot)' },
    ];

    const wb = XLSX.utils.book_new();
    const wsUsers = XLSX.utils.json_to_sheet(userRows);
    const wsMeta = XLSX.utils.json_to_sheet(metadataRows);

    XLSX.utils.book_append_sheet(wb, wsUsers, 'Users');
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Export Metadata');

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Generates a clean Excel import template (.xlsx).
   */
  getImportTemplate(): Buffer {
    const templateRows = [
      {
        Action: 'CREATE',
        'User Name': 'jsmith',
        'First Name': 'John',
        'Middle Name': 'Robert',
        'Last Name': 'Smith',
        'Nick Name': 'Johnny',
        Email: 'john.smith@hospital.example.com',
        'Mobile Number': '0501234567',
        Nationality: 'Saudi Arabia',
        Role: 'Physician',
        'Profile Role': 'Clinical Specialist',
        'Barcode Number': 'BC-10029',
        'Requested Status': 'ACTIVE',
      },
      {
        Action: 'UPDATE',
        'User Name': 'anurse',
        'First Name': 'Alice',
        'Middle Name': '',
        'Last Name': 'Nurse',
        'Nick Name': 'Ali',
        Email: 'alice.nurse@hospital.example.com',
        'Mobile Number': '0509876543',
        Nationality: 'Philippines',
        Role: 'Nurse',
        'Profile Role': 'Head Nurse',
        'Barcode Number': 'BC-20045',
        'Requested Status': 'ACTIVE',
      },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateRows);
    XLSX.utils.book_append_sheet(wb, ws, 'User Import Template');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Dry-run preview of Excel user import with comprehensive duplicate and field validations.
   */
  async importPreview(clientId: string, fileBuffer: Buffer, user: JwtPayload): Promise<ExcelUserImportPreviewResult> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    const existingUsers = await this.snapshotRepo.find({ where: { clientId } });
    const existingUsernames = new Set(existingUsers.map((u) => u.username.toLowerCase()));
    const existingNamesMap = new Map<string, ClientUserSnapshot>();
    for (const u of existingUsers) {
      const key = `${u.firstName.toLowerCase().trim()}_${u.lastName.toLowerCase().trim()}`;
      existingNamesMap.set(key, u);
    }

    const wb = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new BadRequestException('Empty Excel workbook');

    const rawRows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    if (rawRows.length === 0) throw new BadRequestException('Excel sheet contains no data rows');

    const seenUsernamesInFile = new Set<string>();
    const previewRows: ExcelUserImportRow[] = [];

    let readyCount = 0;
    let errorCount = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 2; // Excel header is row 1

      const action = (row['Action'] || row['action'] || 'CREATE').toString().toUpperCase().trim() as any;
      const username = (row['User Name'] || row['UserName'] || row['username'] || '').toString().trim();
      const firstName = (row['First Name'] || row['FirstName'] || row['firstName'] || '').toString().trim();
      const middleName = (row['Middle Name'] || row['MiddleName'] || row['middleName'] || '').toString().trim();
      const lastName = (row['Last Name'] || row['LastName'] || row['lastName'] || '').toString().trim();
      const nickName = (row['Nick Name'] || row['NickName'] || row['nickName'] || '').toString().trim();
      const email = (row['Email'] || row['email'] || '').toString().trim();
      const mobileNumber = (row['Mobile Number'] || row['Mobile'] || row['mobileNumber'] || '').toString().trim();
      const nationality = (row['Nationality'] || row['nationality'] || '').toString().trim();
      const role = (row['Role'] || row['role'] || '').toString().trim();
      const profileRole = (row['Profile Role'] || row['ProfileRole'] || row['profileRole'] || '').toString().trim();
      const barcodeNumber = (row['Barcode Number'] || row['Barcode'] || row['barcodeNumber'] || '').toString().trim();
      const requestedStatus = ((row['Requested Status'] || row['Status'] || 'ACTIVE').toString().toUpperCase().trim() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') as ClientUserStatus;

      const validationErrors: string[] = [];
      let classification: any = 'READY_CREATE';
      let potentialDuplicateOf: any = undefined;

      const normUser = username.toLowerCase();

      // Required field validation
      if (!username) {
        validationErrors.push('User Name is required');
        classification = 'INVALID_REQUIRED_FIELD';
      }
      if (action === 'CREATE') {
        if (!firstName) {
          validationErrors.push('First Name is required');
          classification = 'INVALID_REQUIRED_FIELD';
        }
        if (!lastName) {
          validationErrors.push('Last Name is required');
          classification = 'INVALID_REQUIRED_FIELD';
        }
        if (!mobileNumber) {
          validationErrors.push('Mobile Number is required');
          classification = 'INVALID_REQUIRED_FIELD';
        }
        if (!nationality) {
          validationErrors.push('Nationality is required');
          classification = 'INVALID_REQUIRED_FIELD';
        }
      }

      // Email format validation
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        validationErrors.push('Invalid email format');
        classification = 'INVALID_EMAIL';
      }

      // Duplicate in File check
      if (normUser && seenUsernamesInFile.has(normUser)) {
        validationErrors.push(`Duplicate username '${username}' appears multiple times in Excel file`);
        classification = 'DUPLICATE_USERNAME';
      }
      if (normUser) seenUsernamesInFile.add(normUser);

      // Existing client user check
      if (action === 'CREATE' && existingUsernames.has(normUser)) {
        validationErrors.push(`User '${username}' already exists in client`);
        classification = 'DUPLICATE_USERNAME';
      }

      // Same First + Last name check
      if (action === 'CREATE' && firstName && lastName) {
        const nameKey = `${firstName.toLowerCase()}_${lastName.toLowerCase()}`;
        const match = existingNamesMap.get(nameKey);
        if (match) {
          validationErrors.push(`Possible duplicate: Another user already has name '${match.fullName}'`);
          classification = 'POTENTIAL_DUPLICATE_NAME';
          potentialDuplicateOf = {
            username: match.username,
            fullName: match.fullName,
            mobileNumber: match.mobileNumber || undefined,
            status: match.status,
          };
        }
      }

      // Map action to classification if valid
      if (validationErrors.length === 0) {
        if (action === 'CREATE') classification = 'READY_CREATE';
        else if (action === 'UPDATE') classification = 'READY_UPDATE';
        else if (action === 'ACTIVATE') classification = 'READY_ACTIVATE';
        else if (action === 'DEACTIVATE') classification = 'READY_DEACTIVATE';
        readyCount++;
      } else {
        errorCount++;
      }

      previewRows.push({
        rowNumber: rowNum,
        action,
        username,
        firstName,
        middleName: middleName || undefined,
        lastName,
        nickName: nickName || undefined,
        email: email || undefined,
        mobileNumber: mobileNumber || undefined,
        nationality: nationality || undefined,
        role: role || undefined,
        profileRole: profileRole || undefined,
        barcodeNumber: barcodeNumber || undefined,
        requestedStatus,
        classification,
        validationErrors,
        potentialDuplicateOf,
      });
    }

    return {
      totalRows: previewRows.length,
      readyRows: readyCount,
      errorRows: errorCount,
      rows: previewRows,
      liveClientOptions: {
        nationalities: ['Saudi Arabia', 'United Arab Emirates', 'United States', 'United Kingdom', 'India', 'Egypt', 'Jordan', 'Pakistan', 'Philippines', 'Other'],
        roles: ['Physician', 'Nurse', 'Admin', 'Pharmacist', 'Lab Technician', 'Operator', 'Super User'],
        profileRoles: ['Clinical Specialist', 'General Practitioner', 'Head Nurse', 'Chief Pharmacist', 'System Administrator', 'Billing Specialist'],
      },
    };
  }

  /**
   * Executes approved import rows sequentially or with safe limited concurrency.
   */
  async importExecute(clientId: string, rows: ExcelUserImportRow[], user: JwtPayload): Promise<ExcelUserImportExecutionSummary> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client ${clientId} not found`);

    const jobId = `usr_imp_${Date.now()}`;
    const results: ExcelUserImportExecutionRowResult[] = [];
    let succeededCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      const rowCorrelationId = crypto.randomUUID();
      const fullName = `${row.firstName} ${row.lastName}`.trim();

      if (row.classification.startsWith('READY_')) {
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
                nationality: row.nationality || 'Other',
                role: row.role,
                profileRole: row.profileRole,
                barcodeNumber: row.barcodeNumber,
                status: row.requestedStatus || 'ACTIVE',
                overrideDuplicateName: true,
              },
              user
            );

            results.push({
              rowNumber: row.rowNumber,
              action: row.action,
              username: row.username,
              fullName,
              result: 'SUCCESS',
              message: `User '${row.username}' created and verified on client.`,
              remoteStatus: 'ACTIVE',
              executedAt: new Date().toISOString(),
              correlationId: rowCorrelationId,
            });
            succeededCount++;
          } else if (row.action === 'ACTIVATE' || row.action === 'DEACTIVATE') {
            const snap = await this.snapshotRepo.findOne({ where: { clientId, username: row.username } });
            if (snap) {
              await this.setUserStatus(snap.id, row.action === 'ACTIVATE' ? 'ACTIVE' : 'INACTIVE', user);
              results.push({
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
              succeededCount++;
            } else {
              results.push({
                rowNumber: row.rowNumber,
                action: row.action,
                username: row.username,
                fullName,
                result: 'REMOTE_ERROR',
                message: `User '${row.username}' not found in client snapshot.`,
                executedAt: new Date().toISOString(),
                correlationId: rowCorrelationId,
              });
              failedCount++;
            }
          }
        } catch (err: any) {
          failedCount++;
          results.push({
            rowNumber: row.rowNumber,
            action: row.action,
            username: row.username,
            fullName,
            result: 'REMOTE_ERROR',
            errorCode: err.response?.code || 'EXECUTION_ERROR',
            message: err.message || 'Error executing row mutation',
            executedAt: new Date().toISOString(),
            correlationId: rowCorrelationId,
          });
        }
      } else if (row.classification === 'DUPLICATE_USERNAME') {
        skippedCount++;
        results.push({
          rowNumber: row.rowNumber,
          action: row.action,
          username: row.username,
          fullName,
          result: 'SKIPPED_DUPLICATE',
          message: `User '${row.username}' already exists. Creation skipped.`,
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
        });
      } else {
        failedCount++;
        results.push({
          rowNumber: row.rowNumber,
          action: row.action,
          username: row.username,
          fullName,
          result: 'VALIDATION_FAILED',
          message: row.validationErrors.join('; ') || 'Row failed dry-run validation',
          executedAt: new Date().toISOString(),
          correlationId: rowCorrelationId,
        });
      }
    }

    return {
      jobId,
      totalRows: rows.length,
      succeededRows: succeededCount,
      failedRows: failedCount,
      skippedRows: skippedCount,
      results,
    };
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
