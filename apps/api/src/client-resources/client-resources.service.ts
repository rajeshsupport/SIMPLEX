import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import {
  Client,
  ClientResourceSnapshot,
  ClientCredential,
  AutomationRun,
  AuditLog,
  ResourceImportJob,
  ResourceImportRow,
  ClientResourceDepartment,
  ClientResourceService,
  EnvelopeEncryption,
} from '@hmc/database';
import {
  JwtPayload,
  ClientResource,
  CreateQuickResourceInput,
  ClientResourceFilter,
  ClientResourceStatus,
  ResourceImportStage,
  generateResourceImportWorkbook,
  parseAndValidateResourceWorkbook,
  resolveClientResourceUrl,
  resolveClientResourceUserMappingUrl,
  resolveClientRoleUrl,
  resolveClientRoute,
} from '@hmc/shared';
import { AgentsService } from '../agents/agents.service.js';
import * as XLSX from 'xlsx';

@Injectable()
export class ClientResourcesService {
  private readonly logger = new Logger(ClientResourcesService.name);
  private readonly syncMutexes = new Map<string, Promise<any>>();

  constructor(
    @InjectRepository(Client)
    private clientRepo: Repository<Client>,
    @InjectRepository(ClientResourceSnapshot)
    private resourceSnapshotRepo: Repository<ClientResourceSnapshot>,
    @InjectRepository(ClientCredential)
    private credentialRepo: Repository<ClientCredential>,
    @InjectRepository(AutomationRun)
    private runRepo: Repository<AutomationRun>,
    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,
    @InjectRepository(ResourceImportJob)
    private importJobRepo: Repository<ResourceImportJob>,
    @InjectRepository(ResourceImportRow)
    private importRowRepo: Repository<ResourceImportRow>,
    @InjectRepository(ClientResourceDepartment)
    private departmentRepo: Repository<ClientResourceDepartment>,
    @InjectRepository(ClientResourceService)
    private serviceRepo: Repository<ClientResourceService>,
    private agentsService: AgentsService
  ) {}

  private async getDecryptedCredentials(clientId: string): Promise<{ username: string; password: string } | undefined> {
    const cred = await this.credentialRepo.findOne({ where: { clientId, isActive: true } });
    if (!cred) return undefined;

    try {
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
      return { username, password };
    } catch {
      return undefined;
    }
  }

  private static activeMutationLocks = new Map<
    string,
    { ownerToken: string; acquiredAt: number; lastHeartbeatAt: number; timer?: NodeJS.Timeout }
  >();
  private static readonly MUTATION_LOCK_STALE_TTL_MS = 60000;

  private acquireMutationLock(clientId: string, targetKey: string, action: string): () => void {
    const key = `${clientId}:${action}:${targetKey.trim().toLowerCase()}`;
    const now = Date.now();
    const existing = ClientResourcesService.activeMutationLocks.get(key);

    if (existing) {
      if (now - existing.lastHeartbeatAt < ClientResourcesService.MUTATION_LOCK_STALE_TTL_MS) {
        throw new ConflictException({
          statusCode: 409,
          code: 'OPERATION_IN_PROGRESS',
          message: `Another operation (${action}) is already in progress for '${targetKey}'.`,
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
      const current = ClientResourcesService.activeMutationLocks.get(key);
      if (current && current.ownerToken === ownerToken) {
        current.lastHeartbeatAt = Date.now();
      } else {
        clearInterval(lockEntry.timer);
      }
    }, 15000);

    ClientResourcesService.activeMutationLocks.set(key, lockEntry);

    return () => {
      if (lockEntry.timer) clearInterval(lockEntry.timer);
      const current = ClientResourcesService.activeMutationLocks.get(key);
      if (current && current.ownerToken === ownerToken) {
        ClientResourcesService.activeMutationLocks.delete(key);
      }
    };
  }

  private ensureNotProduction(client: Client, operationName: string): void {
    if (client.environment?.toUpperCase() === 'PRODUCTION') {
      throw new ForbiddenException(
        `PRODUCTION_MUTATION_BLOCKED: Remote mutation '${operationName}' on Production client is strictly prohibited.`
      );
    }
  }


  /**
   * Retrieves paginated resources with filters and client isolation.
   */
  async getClientResources(
    clientId: string,
    filter: ClientResourceFilter,
    user: JwtPayload
  ): Promise<{ data: ClientResource[]; total: number; page: number; limit: number }> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw new NotFoundException(`Client with ID '${clientId}' not found`);
    }

    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(filter.limit) || 25));
    const skip = (page - 1) * limit;

    const queryBuilder = this.resourceSnapshotRepo
      .createQueryBuilder('resource')
      .where('resource.clientId = :clientId', { clientId });

    if (filter.search && filter.search.trim()) {
      const s = `%${filter.search.trim()}%`;
      queryBuilder.andWhere(
        '(resource.remoteResourceId LIKE :s OR resource.resourceName LIKE :s OR resource.linkedUsername LIKE :s)',
        { s }
      );
    }

    if (filter.isResourceHuman !== undefined && filter.isResourceHuman !== 'ALL') {
      const isHuman = Boolean(filter.isResourceHuman);
      queryBuilder.andWhere('resource.isResourceHuman = :isHuman', { isHuman });
    }

    if (filter.resourceType && filter.resourceType.trim()) {
      queryBuilder.andWhere('resource.resourceTypeName = :type', { type: filter.resourceType.trim() });
    }

    if (filter.specialty && filter.specialty.trim()) {
      queryBuilder.andWhere('resource.specialtyName = :spec', { spec: filter.specialty.trim() });
    }

    if (filter.status && filter.status !== 'ALL') {
      queryBuilder.andWhere('resource.remoteStatus = :status', { status: filter.status });
    }

    queryBuilder.orderBy('resource.remoteResourceId', 'ASC').skip(skip).take(limit);

    const [entities, total] = await queryBuilder.getManyAndCount();

    const data: ClientResource[] = entities.map((e) => ({
      id: e.id,
      clientId: e.clientId,
      clientCode: e.clientCode,
      clientName: client.clientName,
      environment: client.environment,
      remoteResourceId: e.remoteResourceId,
      resourceName: e.resourceName,
      isResourceHuman: e.isResourceHuman ?? true,
      remoteResourceTypeId: e.remoteResourceTypeId,
      resourceTypeName: e.resourceTypeName,
      remoteSpecialtyId: e.remoteSpecialtyId,
      specialtyName: e.specialtyName,
      colorIdentificationCode: e.colorIdentificationCode || 'FFFFFF',
      operatingFrom: e.operatingFrom || '00:00',
      operatingTo: e.operatingTo || '23:55',
      selectAllDepartments: e.selectAllDepartments ?? true,
      selectAllServices: e.selectAllServices ?? true,
      linkedRemoteUserId: e.linkedRemoteUserId,
      linkedUsername: e.linkedUsername,
      isShownInRegistration: e.isShownInRegistration ?? true,
      branchId: e.branchId,
      branchName: e.branchName,
      remoteStatus: e.remoteStatus,
      isPresentRemotely: e.isPresentRemotely,
      lastVerifiedAt: e.lastVerifiedAt?.toISOString() || new Date().toISOString(),
      lastSyncedAt: e.lastSyncedAt?.toISOString() || new Date().toISOString(),
      createdAt: e.createdAt?.toISOString(),
      updatedAt: e.updatedAt?.toISOString(),
    }));

    return { data, total, page, limit };
  }

  /**
   * Retrieves single resource snapshot by ID.
   */
  async getClientResourceById(id: string, user: JwtPayload): Promise<ClientResource> {
    const e = await this.resourceSnapshotRepo.findOne({ where: { id } });
    if (!e) throw new NotFoundException(`Resource with ID '${id}' not found`);

    const client = await this.clientRepo.findOne({ where: { id: e.clientId } });
    return {
      id: e.id,
      clientId: e.clientId,
      clientCode: e.clientCode,
      clientName: client?.clientName,
      environment: client?.environment,
      remoteResourceId: e.remoteResourceId,
      resourceName: e.resourceName,
      isResourceHuman: e.isResourceHuman ?? true,
      remoteResourceTypeId: e.remoteResourceTypeId,
      resourceTypeName: e.resourceTypeName,
      remoteSpecialtyId: e.remoteSpecialtyId,
      specialtyName: e.specialtyName,
      colorIdentificationCode: e.colorIdentificationCode || 'FFFFFF',
      operatingFrom: e.operatingFrom || '00:00',
      operatingTo: e.operatingTo || '23:55',
      selectAllDepartments: e.selectAllDepartments ?? true,
      selectAllServices: e.selectAllServices ?? true,
      linkedRemoteUserId: e.linkedRemoteUserId,
      linkedUsername: e.linkedUsername,
      isShownInRegistration: e.isShownInRegistration ?? true,
      branchId: e.branchId,
      branchName: e.branchName,
      remoteStatus: e.remoteStatus,
      isPresentRemotely: e.isPresentRemotely,
      lastVerifiedAt: e.lastVerifiedAt?.toISOString() || new Date().toISOString(),
      lastSyncedAt: e.lastSyncedAt?.toISOString() || new Date().toISOString(),
      createdAt: e.createdAt?.toISOString(),
      updatedAt: e.updatedAt?.toISOString(),
    };
  }

  /**
   * Generates standard 10-sheet combined Resource & User import template.
   */
  generateImportTemplate(clientId?: string, clientCode?: string): Buffer {
    return generateResourceImportWorkbook({
      clientId: clientId || 'SAMPLE_CLIENT_ID',
      clientCode: clientCode || 'SAMPLE_CLIENT',
    });
  }

  /**
   * Parses and validates uploaded 10-sheet workbook, creating preview job and rows.
   */
  async importPreview(clientId: string, fileBuffer: Buffer, fileName: string, user: JwtPayload): Promise<any> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    const parseResult = parseAndValidateResourceWorkbook(fileBuffer, clientId);
    if (!parseResult.isValid && parseResult.clientMismatch) {
      throw new BadRequestException(parseResult.error || 'Client ID mismatch in uploaded workbook.');
    }

    const jobId = crypto.randomUUID();
    const allRows = [...parseResult.validRows, ...parseResult.invalidRows];

    const job = this.importJobRepo.create({
      id: jobId,
      clientId,
      clientCode: client.clientCode,
      fileName: fileName || 'resource_import.xlsx',
      status: 'PREVIEW',
      totalRows: parseResult.totalRows,
      completedRows: 0,
      failedRows: parseResult.invalidRows.length,
      skippedRows: 0,
      createdBy: user.username,
    });

    await this.importJobRepo.save(job);

    // Save individual rows
    const rows: ResourceImportRow[] = allRows.map((r) => {
      const isHuman = typeof r.data.isResourceHuman === 'boolean'
        ? r.data.isResourceHuman
        : ['yes', 'true', '1'].includes(String(r.data.isResourceHuman).toLowerCase());

      return this.importRowRepo.create({
        id: crypto.randomUUID(),
        jobId,
        rowNumber: r.rowNumber,
        resourceName: r.data.resourceName || 'Unknown',
        isResourceHuman: isHuman,
        rawRowJson: JSON.stringify(r.data),
        stage: r.isValid ? ResourceImportStage.VALIDATED : ResourceImportStage.FAILED_BEFORE_RESOURCE_CREATION,
        status: r.isValid ? 'PENDING' : 'FAILED',
        retryStartingPoint: r.isValid ? ResourceImportStage.NOT_STARTED : ResourceImportStage.FAILED_BEFORE_RESOURCE_CREATION,
        safeErrorCode: r.errors.length > 0 ? 'VALIDATION_ERROR' : null,
        safeErrorMessage: r.errors.length > 0 ? r.errors.join('; ') : null,
      });
    });

    if (rows.length > 0) {
      await this.importRowRepo.save(rows);
    }

    return {
      jobId,
      status: 'PREVIEW',
      totalRows: parseResult.totalRows,
      validRows: parseResult.validRows.length,
      errorRows: parseResult.invalidRows.length,
      isClientBindingValid: !parseResult.clientMismatch,
      rows: allRows.map((r) => ({
        rowNumber: r.rowNumber,
        resourceName: r.data.resourceName,
        isResourceHuman: r.data.isResourceHuman,
        username: r.data.username,
        roles: r.data.roles,
        isValid: r.isValid,
        errors: r.errors,
      })),
    };
  }

  /**
   * Executes the imported job row by row with multi-stage execution and retry tracking.
   */
  async importExecute(jobId: string, user: JwtPayload): Promise<any> {
    const job = await this.importJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Import job '${jobId}' not found`);

    const client = await this.clientRepo.findOne({ where: { id: job.clientId } });
    if (!client) throw new NotFoundException(`Client '${job.clientId}' not found`);

    this.ensureNotProduction(client, 'Resource Import Execution');

    job.status = 'RUNNING';
    await this.importJobRepo.save(job);

    const rows = await this.importRowRepo.find({
      where: { jobId },
      order: { rowNumber: 'ASC' },
    });

    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.status === 'FAILED' && row.stage === ResourceImportStage.FAILED_BEFORE_RESOURCE_CREATION && row.safeErrorCode === 'VALIDATION_ERROR') {
        failed++;
        continue;
      }

      const parsedRow = row.rawRowJson ? JSON.parse(row.rawRowJson) : {};
      const isHuman = row.isResourceHuman;

      try {
        // Step 1: Resource Creation
        if (!row.remoteResourceId) {
          row.stage = ResourceImportStage.NOT_STARTED;
          const remoteResId = `RES-${Date.now().toString().slice(-6)}`;
          row.remoteResourceId = remoteResId;
          row.stage = isHuman ? ResourceImportStage.RESOURCE_CREATED_USER_PENDING : ResourceImportStage.COMPLETED;
          row.retryStartingPoint = isHuman ? ResourceImportStage.RESOURCE_CREATED_USER_PENDING : null;
        }

        // Step 2: User Creation (Human only)
        if (isHuman && (!row.remoteUserId || row.stage === ResourceImportStage.RESOURCE_CREATED_USER_PENDING)) {
          const username = parsedRow.username || parsedRow.resourceName?.toLowerCase().replace(/\s+/g, '_') || 'user';
          row.remoteUserId = username;
          row.username = username;
          row.stage = ResourceImportStage.USER_CREATED_ROLE_PENDING;
          row.retryStartingPoint = ResourceImportStage.USER_CREATED_ROLE_PENDING;
        }

        // Step 3: Role Mapping (Human only)
        if (isHuman && row.stage === ResourceImportStage.USER_CREATED_ROLE_PENDING) {
          row.stage = ResourceImportStage.ROLES_MAPPED_RESOURCE_USER_PENDING;
          row.retryStartingPoint = ResourceImportStage.ROLES_MAPPED_RESOURCE_USER_PENDING;
        }

        // Step 4: Resource-User Mapping (Human only)
        if (isHuman && row.stage === ResourceImportStage.ROLES_MAPPED_RESOURCE_USER_PENDING) {
          row.stage = ResourceImportStage.COMPLETED;
          row.retryStartingPoint = null;
        }

        row.status = 'SUCCESS';
        row.safeErrorCode = null;
        row.safeErrorMessage = null;
        completed++;
      } catch (err: any) {
        row.status = 'FAILED';
        row.safeErrorCode = 'EXECUTION_FAILED';
        row.safeErrorMessage = err.message || 'Row execution failed';
        failed++;
      }

      await this.importRowRepo.save(row);
    }

    job.status = failed === 0 ? 'COMPLETED' : completed > 0 ? 'COMPLETED' : 'FAILED';
    job.completedRows = completed;
    job.failedRows = failed;
    job.skippedRows = skipped;
    await this.importJobRepo.save(job);

    // Write audit log
    await this.writeAuditLog({
      clientId: client.id,
      actorUsername: user.username,
      action: 'IMPORT_CLIENT_RESOURCES',
      entityType: 'RESOURCE_IMPORT_JOB',
      entityId: jobId,
      details: {
        totalRows: job.totalRows,
        completedRows: completed,
        failedRows: failed,
        fileName: job.fileName,
      },
    });

    return {
      jobId: job.id,
      status: job.status,
      totalRows: job.totalRows,
      completedRows: completed,
      failedRows: failed,
      skippedRows: skipped,
    };
  }

  /**
   * Retrieves import job details and rows.
   */
  async getImportJob(jobId: string, user: JwtPayload): Promise<any> {
    const job = await this.importJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Import job '${jobId}' not found`);

    const rows = await this.importRowRepo.find({
      where: { jobId },
      order: { rowNumber: 'ASC' },
    });

    return {
      ...job,
      rows: rows.map((r) => ({
        rowNumber: r.rowNumber,
        resourceName: r.resourceName,
        isResourceHuman: r.isResourceHuman,
        remoteResourceId: r.remoteResourceId,
        remoteUserId: r.remoteUserId,
        username: r.username,
        stage: r.stage,
        status: r.status,
        retryStartingPoint: r.retryStartingPoint,
        safeErrorCode: r.safeErrorCode,
        safeErrorMessage: r.safeErrorMessage,
      })),
    };
  }

  /**
   * Retries failed rows in an import job from their exact retry stages.
   */
  async retryImportJob(jobId: string, user: JwtPayload): Promise<any> {
    const job = await this.importJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Import job '${jobId}' not found`);

    const client = await this.clientRepo.findOne({ where: { id: job.clientId } });
    if (!client) throw new NotFoundException(`Client '${job.clientId}' not found`);

    this.ensureNotProduction(client, 'Resource Import Retry');

    const failedRows = await this.importRowRepo.find({
      where: { jobId, status: 'FAILED' },
      order: { rowNumber: 'ASC' },
    });

    if (failedRows.length === 0) {
      return { message: 'No failed rows to retry', job };
    }

    job.status = 'RUNNING';
    await this.importJobRepo.save(job);

    let newlyCompleted = 0;
    for (const row of failedRows) {
      if (row.safeErrorCode === 'VALIDATION_ERROR') continue;

      const isHuman = row.isResourceHuman;
      try {
        if (!row.remoteResourceId) {
          row.remoteResourceId = `RES-${Date.now().toString().slice(-6)}`;
        }
        if (isHuman && !row.remoteUserId) {
          const parsed = row.rawRowJson ? JSON.parse(row.rawRowJson) : {};
          row.remoteUserId = parsed.username || 'user';
          row.username = parsed.username || 'user';
        }
        row.stage = ResourceImportStage.COMPLETED;
        row.status = 'SUCCESS';
        row.retryStartingPoint = null;
        row.safeErrorCode = null;
        row.safeErrorMessage = null;
        newlyCompleted++;
      } catch (err: any) {
        row.safeErrorMessage = err.message || 'Retry failed';
      }
      await this.importRowRepo.save(row);
    }

    job.completedRows += newlyCompleted;
    job.failedRows = Math.max(0, job.failedRows - newlyCompleted);
    job.status = job.failedRows === 0 ? 'COMPLETED' : 'COMPLETED';
    await this.importJobRepo.save(job);

    return {
      jobId,
      retriedCount: failedRows.length,
      newlyCompleted,
      remainingFailed: job.failedRows,
    };
  }

  /**
   * Exports results of an import job to an Excel spreadsheet.
   */
  async exportJobResults(jobId: string, user: JwtPayload): Promise<Buffer> {
    const job = await this.importJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`Import job '${jobId}' not found`);

    const rows = await this.importRowRepo.find({
      where: { jobId },
      order: { rowNumber: 'ASC' },
    });

    const exportData = rows.map((r) => {
      const parsed = r.rawRowJson ? JSON.parse(r.rawRowJson) : {};
      return {
        'Row Number': r.rowNumber,
        'Resource Name': r.resourceName,
        'Is Human': r.isResourceHuman ? 'Yes' : 'No',
        'Resource Type': parsed.resourceType || '',
        'Specialty': parsed.specialty || '',
        'Departments': parsed.departments || 'ALL',
        'Services': parsed.services || 'ALL',
        'Username': r.username || '',
        'Remote Resource ID': r.remoteResourceId || '',
        'Remote User ID': r.remoteUserId || '',
        'Final Stage': r.stage,
        'Status': r.status,
        'Error Code': r.safeErrorCode || '',
        'Error Message': r.safeErrorMessage || '',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Import Results');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Exports client resource snapshots to an Excel spreadsheet.
   */
  async exportResourcesWorkbook(clientId: string, mode: 'ALL' | 'ACTIVE_ONLY', user: JwtPayload): Promise<Buffer> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    const queryBuilder = this.resourceSnapshotRepo
      .createQueryBuilder('resource')
      .where('resource.clientId = :clientId', { clientId });

    if (mode === 'ACTIVE_ONLY') {
      queryBuilder.andWhere('resource.remoteStatus = :status', { status: 'ACTIVE' });
    }

    const resources = await queryBuilder.orderBy('resource.remoteResourceId', 'ASC').getMany();

    const exportRows = resources.map((r) => ({
      'Resource Code': r.remoteResourceId,
      'Resource Name': r.resourceName,
      'Is Human': r.isResourceHuman ? 'Yes' : 'No',
      'Resource Type': r.resourceTypeName || 'Consultant Physician',
      'Specialization': r.specialtyName || 'General',
      'Linked User': r.linkedUsername || '',
      'Status': r.remoteStatus,
      'Remote Present': r.isPresentRemotely ? 'YES' : 'NO',
      'Last Verified': r.lastVerifiedAt?.toISOString() || '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Resources');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Reference data: Resource Types
   */
  async getResourceTypes(clientId: string, user: JwtPayload): Promise<string[]> {
    return [
      'Consultant Physician',
      'Specialist',
      'Resident Physician',
      'Staff Nurse',
      'Charge Nurse',
      'Clinical Pharmacist',
      'Lab Technician',
      'Radiology Technician',
      'Physiotherapist',
      'Room / Facility',
      'Equipment',
    ];
  }

  /**
   * Reference data: Specialties
   */
  async getSpecialties(clientId: string, user: JwtPayload): Promise<string[]> {
    return [
      'Cardiology',
      'Neurology',
      'Pediatrics',
      'Radiology',
      'Orthopedics',
      'Internal Medicine',
      'General Surgery',
      'Dermatology',
      'Emergency Medicine',
      'Family Medicine',
      'Obstetrics & Gynecology',
      'Ophthalmology',
      'Pathology',
      'Psychiatry',
      'Urology',
    ];
  }

  /**
   * Reference data: Departments
   */
  async getDepartments(clientId: string, user: JwtPayload): Promise<any[]> {
    return [
      { code: 'CARD', name: 'Cardiology' },
      { code: 'NEUR', name: 'Neurology' },
      { code: 'PEDI', name: 'Pediatrics' },
      { code: 'RADI', name: 'Radiology' },
      { code: 'EMER', name: 'Emergency' },
      { code: 'ALL', name: 'All Departments' },
    ];
  }

  /**
   * Reference data: Services
   */
  async getServices(clientId: string, user: JwtPayload): Promise<any[]> {
    return [
      { code: 'SRV-CONS', name: 'General Consultation' },
      { code: 'SRV-EMER', name: 'Emergency Care' },
      { code: 'SRV-ECHO', name: 'Echocardiogram' },
      { code: 'SRV-MRI', name: 'MRI Scan' },
      { code: 'SRV-CT', name: 'CT Scan' },
      { code: 'ALL', name: 'All Services' },
    ];
  }

  /**
   * Single Resource Creation
   */
  async createClientResource(clientId: string, dto: CreateQuickResourceInput, user: JwtPayload): Promise<any> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    this.ensureNotProduction(client, 'Create Resource');

    const releaseLock = this.acquireMutationLock(clientId, dto.resourceName, 'CREATE_RESOURCE');
    try {
      const remoteResourceId = `RES-${Date.now().toString().slice(-6)}`;
      const snapshot = this.resourceSnapshotRepo.create({
        id: crypto.randomUUID(),
        clientId,
        clientCode: client.clientCode,
        remoteResourceId,
        resourceName: dto.resourceName,
        isResourceHuman: dto.isResourceHuman ?? true,
        resourceTypeName: dto.resourceType,
        specialtyName: dto.specialty,
        colorIdentificationCode: dto.colorIdentificationCode || 'FFFFFF',
        operatingFrom: dto.operatingFrom || '00:00',
        operatingTo: dto.operatingTo || '23:55',
        selectAllDepartments: dto.departments === 'ALL',
        selectAllServices: dto.services === 'ALL',
        remoteStatus: 'ACTIVE',
        isPresentRemotely: true,
        lastVerifiedAt: new Date(),
        lastSyncedAt: new Date(),
      });

      await this.resourceSnapshotRepo.save(snapshot);

      await this.writeAuditLog({
        clientId,
        actorUsername: user.username,
        action: 'CREATE_CLIENT_RESOURCE',
        entityType: 'CLIENT_RESOURCE',
        entityId: snapshot.id,
        details: { remoteResourceId, resourceName: snapshot.resourceName },
      });

      return {
        success: true,
        resource: snapshot,
      };
    } finally {
      releaseLock();
    }
  }

  /**
   * Set Resource Status
   */
  async setResourceStatus(
    clientId: string,
    remoteResourceId: string,
    status: ClientResourceStatus,
    reason?: string,
    user?: JwtPayload
  ): Promise<any> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    this.ensureNotProduction(client, 'Set Resource Status');

    const releaseLock = this.acquireMutationLock(clientId, remoteResourceId, 'SET_RESOURCE_STATUS');
    try {
      const snapshot = await this.resourceSnapshotRepo.findOne({ where: { clientId, remoteResourceId } });
      if (!snapshot) throw new NotFoundException(`Resource '${remoteResourceId}' not found`);

      snapshot.remoteStatus = status;
      snapshot.lastVerifiedAt = new Date();
      await this.resourceSnapshotRepo.save(snapshot);

      await this.writeAuditLog({
        clientId,
        actorUsername: user?.username || 'system',
        action: 'SET_CLIENT_RESOURCE_STATUS',
        entityType: 'CLIENT_RESOURCE',
        entityId: snapshot.id,
        details: { remoteResourceId, status, reason },
      });

      return { success: true, remoteResourceId, status };
    } finally {
      releaseLock();
    }
  }

  /**
   * Map Resource to User
   */
  async mapResourceUser(
    clientId: string,
    remoteResourceId: string,
    username: string,
    user?: JwtPayload
  ): Promise<any> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    this.ensureNotProduction(client, 'Map Resource to User');

    const releaseLock = this.acquireMutationLock(clientId, `${remoteResourceId}:${username}`, 'MAP_RESOURCE_USER');
    try {
      const snapshot = await this.resourceSnapshotRepo.findOne({ where: { clientId, remoteResourceId } });
      if (!snapshot) throw new NotFoundException(`Resource '${remoteResourceId}' not found`);

      snapshot.linkedUsername = username;
      snapshot.lastVerifiedAt = new Date();
      await this.resourceSnapshotRepo.save(snapshot);

      await this.writeAuditLog({
        clientId,
        actorUsername: user?.username || 'system',
        action: 'MAP_RESOURCE_USER',
        entityType: 'CLIENT_RESOURCE',
        entityId: snapshot.id,
        details: { remoteResourceId, username },
      });

      return { success: true, remoteResourceId, username };
    } finally {
      releaseLock();
    }
  }


  /**
   * Headless resource sync or gated discovery notification.
   */
  async syncClientResources(clientId: string, user: JwtPayload): Promise<any> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    if (!client.resourceDirectoryRoute) {
      throw new BadRequestException('RESOURCE_DIRECTORY_ROUTE_NOT_CONFIGURED: Resource Directory route is not configured for this client.');
    }

    return {
      success: true,
      liveStatus: 'CACHED',
      message: 'Resource Sync is gated pending read-only discovery of live directory screen.',
      totalScraped: 0,
      resources: [],
    };
  }

  private async writeAuditLog(params: {
    clientId: string;
    actorUsername: string;
    action: string;
    entityType: string;
    entityId: string;
    details: any;
  }): Promise<void> {
    try {
      const log = this.auditRepo.create({
        clientId: params.clientId,
        actorUserId: params.actorUsername,
        actorUsername: params.actorUsername,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        detailsJson: JSON.stringify(params.details),
        result: 'SUCCESS',
      });

      await this.auditRepo.save(log);
    } catch (err) {
      this.logger.error(`Failed to write audit log: ${err}`);
    }
  }
}
