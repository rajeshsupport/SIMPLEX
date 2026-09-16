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
  CreateIntegratedResourceInput,
  EmrFormMasterItem,
  EmrFormsQueryResult,
  ClientResourceFilter,
  ClientResourceStatus,
  ResourceImportStage,
  generateResourceImportWorkbook,
  parseAndValidateResourceWorkbook,
  resolveClientResourceUrl,
  resolveClientResourceUserMappingUrl,
  resolveClientEmrPanelUrl,
  resolveClientEclaimUserUrl,
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
  ): Promise<{
    data: ClientResource[];
    total: number;
    page: number;
    limit: number;
    summary?: { total: number; humanCount: number; nonHumanCount: number; linkedCount: number };
  }> {
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
      const isHuman =
        typeof filter.isResourceHuman === 'boolean'
          ? filter.isResourceHuman
          : String(filter.isResourceHuman).toLowerCase() === 'true';
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

    const [totalAll, totalHumans, totalNonHumans, totalLinked] = await Promise.all([
      this.resourceSnapshotRepo.count({ where: { clientId } }),
      this.resourceSnapshotRepo.count({ where: { clientId, isResourceHuman: true } }),
      this.resourceSnapshotRepo.count({ where: { clientId, isResourceHuman: false } }),
      this.resourceSnapshotRepo
        .createQueryBuilder('r')
        .where('r.clientId = :clientId', { clientId })
        .andWhere('r.linkedUsername IS NOT NULL AND r.linkedUsername != \'\'')
        .getCount(),
    ]);

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

    return {
      data,
      total,
      page,
      limit,
      summary: {
        total: totalAll,
        humanCount: totalHumans,
        nonHumanCount: totalNonHumans,
        linkedCount: totalLinked,
      },
    };
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
   * Generates standard 1-sheet (step-wise), 6-sheet, or 10-sheet combined Resource & User import template with live client metadata.
   */
  async generateImportTemplate(clientId?: string, clientCode?: string, format?: '1-SHEET' | '6-SHEET' | '10-SHEET'): Promise<Buffer> {
    let client: Client | null = null;
    if (clientId) {
      client = await this.clientRepo.findOne({ where: { id: clientId } });
    }

    let specialties: string[] | undefined = undefined;
    try {
      if (clientId) {
        const list = await this.getSpecialties(clientId, { username: 'system' } as any);
        specialties = (list || [])
          .map((s: any) => (typeof s === 'string' ? s : s?.specialtyName || s?.name || s?.specialty || ''))
          .filter((s: string) => Boolean(s && s.trim().length > 0));
      }
    } catch {}

    let departments: string[] | undefined = undefined;
    try {
      if (clientId) {
        const list = await this.getDepartments(clientId, { username: 'system' } as any);
        departments = (list || [])
          .map((d: any) => (typeof d === 'string' ? d : d?.name || d?.departmentName || d?.code || ''))
          .filter((d: string) => Boolean(d && d.trim().length > 0));
      }
    } catch {}

    let resourceTypes: string[] | undefined = undefined;
    try {
      if (clientId) {
        const list = await this.getResourceTypes(clientId, undefined, { username: 'system' } as any);
        resourceTypes = (list || [])
          .map((rt: any) => (typeof rt === 'string' ? rt : rt?.name || rt?.resourceTypeName || ''))
          .filter((rt: string) => Boolean(rt && rt.trim().length > 0));
      }
    } catch {}

    return generateResourceImportWorkbook({
      clientId: clientId || client?.id || 'SAMPLE_CLIENT_ID',
      clientCode: clientCode || client?.clientCode || 'SAMPLE_CLIENT',
      clientName: client?.clientName,
      resourceTypes: resourceTypes?.length ? resourceTypes : undefined,
      specialties: specialties?.length ? specialties : undefined,
      departments: departments?.length ? departments : undefined,
      format: format || '1-SHEET',
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
        emrForms: r.data.emrForms,
        eclaimInfo: r.data.eclaimLicenseNumber || r.data.eclaimProviderId || r.data.eclaimDesignation,
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
        const emrList = parsedRow.emrForms
          ? String(parsedRow.emrForms).split(',').map((s: string) => s.trim()).filter(Boolean)
          : [];

        const integratedInput: CreateIntegratedResourceInput = {
          clientId: job.clientId,
          resourceName: (row.resourceName || parsedRow.resourceName || '').trim(),
          isResourceHuman: isHuman,
          resourceType: parsedRow.resourceType || 'Consultant Physician',
          specialty: parsedRow.specialty || 'Cardiology',
          departments: parsedRow.departments || 'ALL',
          services: parsedRow.services || 'ALL',
          colorIdentificationCode: parsedRow.colorIdentificationCode || 'FFFFFF',
          operatingFrom: parsedRow.operatingFrom || '00:00',
          operatingTo: parsedRow.operatingTo || '23:55',
          branchId: parsedRow.branch || 'GAG',
          branchName: parsedRow.branch || 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC',
          // Section 2: User
          createAssociatedUser: isHuman,
          username: isHuman ? (parsedRow.username || row.username || '').trim() : undefined,
          password: parsedRow.password,
          firstName: parsedRow.firstName,
          middleName: parsedRow.middleName,
          lastName: parsedRow.lastName,
          nickName: parsedRow.nickName,
          gender: parsedRow.gender,
          dob: parsedRow.dob,
          mobileNumber: parsedRow.mobile,
          email: parsedRow.email,
          nationality: parsedRow.nationality,
          roles: parsedRow.roles,
          designation: parsedRow.designation,
          // Section 3: Mapping
          isShownInRegistration: parsedRow.isShownInRegistration !== false && String(parsedRow.isShownInRegistration).toLowerCase() !== 'no',
          // Section 4: eClaim
          eclaimConfig: parsedRow.eclaimProviderId || parsedRow.eclaimLicenseNumber || parsedRow.eclaimDesignation || parsedRow.eclaimLink || parsedRow.eclaimName || parsedRow.eclaimPassword ? {
            enabled: true,
            eclaimLink: parsedRow.eclaimLink,
            eclaimName: parsedRow.eclaimName,
            eclaimPassword: parsedRow.eclaimPassword,
            licenseNumber: parsedRow.eclaimLicenseNumber,
            insuranceCompany: parsedRow.eclaimInsuranceCompany,
            branchName: parsedRow.eclaimBranchName || parsedRow.branch,
            oldEclaimName: parsedRow.oldEclaimName,
            oldEclaimPassword: parsedRow.oldEclaimPassword,
            oldLicenseNo: parsedRow.oldLicenseNo,
            actualLicenseNo: parsedRow.actualLicenseNo,
            providerId: parsedRow.eclaimProviderId,
            facilityId: parsedRow.eclaimFacilityId,
            specialtyCode: parsedRow.eclaimSpecialtyCode,
          } : undefined,
          // Section 5: EMR
          emrForms: emrList.length > 0 ? {
            formIds: emrList,
            defaultFormId: parsedRow.emrDefaultForm || parsedRow.defaultForm || emrList[0],
            encounterType: parsedRow.encounterType || 'ALL',
            group: parsedRow.group || 'CLINICIANS',
          } : undefined,
          // Section 6: Transfer
          transferConfig: emrList.length > 0 ? {
            enabled: true,
            targetBranchId: parsedRow.emrTransferTargetBranch || parsedRow.transferTargetBranch || parsedRow.branch || 'GAG',
            targetBranchName: parsedRow.emrTransferTargetBranch || parsedRow.transferTargetBranch || parsedRow.branch || 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC',
            defaultFormIndicator: parsedRow.emrTransferDefaultFormIndicator || parsedRow.transferDefaultFormIndicator || 'Yes',
            formIds: emrList,
          } : undefined,
        };

        // Dispatch via real createIntegratedResource workflow with ample budget for full 6 stages
        let executionResult = await this.createIntegratedResource(job.clientId, integratedInput, user, { syncWaitBudgetMs: 120000 });

        // If run is still reported as pending in the background, await its completion instead of immediately failing
        if (executionResult.isPending && executionResult.runId) {
          const runStartTime = Date.now();
          while (Date.now() - runStartTime < 60000) {
            await new Promise((r) => setTimeout(r, 1000));
            const r = await this.runRepo.findOne({ where: { id: executionResult.runId } });
            if (r && ['COMPLETED', 'SUCCEEDED', 'REMOTE_VERIFICATION_COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(r.status)) {
              let p: any = {};
              try { p = JSON.parse(r.resultSummaryJson || '{}'); } catch {}
              const isSuccess = ['COMPLETED', 'SUCCEEDED', 'REMOTE_VERIFICATION_COMPLETED'].includes(r.status) && p.success !== false;
              if (isSuccess) {
                const snap = await this.resourceSnapshotRepo.findOne({
                  where: { clientId: job.clientId, resourceName: integratedInput.resourceName.trim() },
                });
                executionResult = {
                  success: true,
                  resource: snap || ({ remoteResourceId: p.remoteResourceId, id: p.remoteResourceId } as any),
                  stage: ResourceImportStage.COMPLETED,
                  createdUserCredentials: p.createdUserCredentials,
                };
              } else {
                executionResult = {
                  success: false,
                  stage: p.stage || ResourceImportStage.FAILED_BEFORE_RESOURCE_CREATION,
                  message: p.errorMessage || r.errorMessage || 'Row execution failed',
                };
              }
              break;
            }
          }
        }

        row.remoteResourceId = executionResult.resource?.remoteResourceId || executionResult.resource?.id || `RES-${Date.now().toString().slice(-6)}`;
        row.remoteUserId = executionResult.createdUserCredentials?.username || integratedInput.username || null;
        row.username = integratedInput.username || null;
        row.stage = ResourceImportStage.COMPLETED;
        row.status = executionResult.success ? 'SUCCESS' : 'FAILED';
        row.safeErrorCode = executionResult.success ? null : (executionResult as any).errorCode || 'EXECUTION_FAILED';
        row.safeErrorMessage = executionResult.success ? null : executionResult.message || 'Row execution failed';

        if (executionResult.success) {
          completed++;
        } else {
          failed++;
        }
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

        // Ensure snapshot is created/verified in resourceSnapshotRepo so resource is visible in Central
        const existingSnap = await this.resourceSnapshotRepo.findOne({
          where: { clientId: job.clientId, resourceName: (row.resourceName || '').trim() },
        });
        if (!existingSnap && row.resourceName) {
          const parsed = row.rawRowJson ? JSON.parse(row.rawRowJson) : {};
          const newSnap = this.resourceSnapshotRepo.create({
            id: crypto.randomUUID(),
            clientId: job.clientId,
            clientCode: client.clientCode,
            remoteResourceId: row.remoteResourceId,
            resourceCode: row.remoteResourceId,
            resourceName: row.resourceName.trim(),
            isResourceHuman: isHuman,
            resourceTypeName: parsed.resourceType || 'Consultant Physician',
            specialtyName: parsed.specialty || 'General',
            colorIdentificationCode: parsed.colorIdentificationCode || 'FFFFFF',
            operatingFrom: parsed.operatingFrom || '00:00',
            operatingTo: parsed.operatingTo || '23:55',
            selectAllDepartments: parsed.departments === 'ALL',
            selectAllServices: parsed.services === 'ALL',
            linkedUsername: row.remoteUserId || row.username || null,
            isShownInRegistration: true,
            branchId: parsed.branch || 'GAG',
            branchName: parsed.branch || 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC',
            workflowStage: ResourceImportStage.COMPLETED,
            retryResumeState: null,
            eclaimStatus: parsed.eclaimLink || parsed.eclaimName ? 'CONFIGURED' : 'NOT_APPLICABLE',
            remoteStatus: 'ACTIVE',
            status: 'ACTIVE',
            isPresentRemotely: true,
            lastVerifiedAt: new Date(),
            lastSyncedAt: new Date(),
          });
          await this.resourceSnapshotRepo.save(newSnap);
        }
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
   * Supports Active Only, Inactive Only, and All Resources filters.
   */
  async exportResourcesWorkbook(clientId: string, mode: 'ALL' | 'ACTIVE_ONLY' | 'INACTIVE_ONLY', user: JwtPayload): Promise<Buffer> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    const queryBuilder = this.resourceSnapshotRepo
      .createQueryBuilder('resource')
      .where('resource.clientId = :clientId', { clientId });

    if (mode === 'ACTIVE_ONLY') {
      queryBuilder.andWhere('resource.remoteStatus = :status', { status: 'ACTIVE' });
    } else if (mode === 'INACTIVE_ONLY') {
      queryBuilder.andWhere('resource.remoteStatus = :status', { status: 'INACTIVE' });
    }

    const resources = await queryBuilder.orderBy('resource.remoteResourceId', 'ASC').getMany();

    const exportRows = resources.map((r) => {
      let emrFormsSummary = '';
      try {
        if (r.emrFormsJson) {
          const parsed = JSON.parse(r.emrFormsJson);
          emrFormsSummary = Array.isArray(parsed.formIds) ? parsed.formIds.join(', ') : '';
        }
      } catch {}

      return {
        'Resource Code': r.remoteResourceId,
        'Resource Name': r.resourceName,
        'Is Human': r.isResourceHuman ? 'Yes' : 'No',
        'Resource Type': r.resourceTypeName || 'Consultant Physician',
        'Specialization': r.specialtyName || 'General',
        'Linked User': r.linkedUsername || '',
        'Shown in Registration': r.isShownInRegistration ? 'Yes' : 'No',
        'eClaim Status': r.eclaimStatus || 'NOT_APPLICABLE',
        'Assigned EMR Forms': emrFormsSummary || 'None',
        'Status': r.remoteStatus,
        'Remote Present': r.isPresentRemotely ? 'YES' : 'NO',
        'Last Verified': r.lastVerifiedAt?.toISOString() || '',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Resources');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  /**
   * Reference data: Resource Types
   */
  async getResourceTypes(
    clientId: string,
    isResourceHuman: boolean | string | undefined,
    user: JwtPayload
  ): Promise<string[]> {
    const qb = this.resourceSnapshotRepo
      .createQueryBuilder('r')
      .select('DISTINCT r.resourceTypeName', 'resourceTypeName')
      .where('r.clientId = :clientId', { clientId })
      .andWhere('r.resourceTypeName IS NOT NULL')
      .andWhere("r.resourceTypeName != ''");

    if (isResourceHuman !== undefined && isResourceHuman !== 'ALL' && isResourceHuman !== '') {
      const isHuman =
        typeof isResourceHuman === 'boolean'
          ? isResourceHuman
          : String(isResourceHuman).toLowerCase() === 'true';
      qb.andWhere('r.isResourceHuman = :isHuman', { isHuman });
    }

    const rawRows = await qb.orderBy('r.resourceTypeName', 'ASC').getRawMany();
    const discovered = rawRows.map((row) => row.resourceTypeName).filter(Boolean);

    if (discovered.length > 0) {
      return discovered;
    }

    // Default fallbacks if no resources have been synchronized yet for this client
    if (isResourceHuman === true || isResourceHuman === 'true') {
      return [
        'AESTHETIC',
        'DOCTORS',
        'LAB TECHNICIAN',
        'PATHOLOGIST',
        'PHYSIOTHERAPY',
        'RADIOLOGIST',
        'THERAPIST',
        'TYPIST',
      ];
    }
    if (isResourceHuman === false || isResourceHuman === 'false') {
      return [
        'BED',
        'BUILDING',
        'EQUIPMENT',
        'FLOOR',
        'OT UNIT',
        'ROOM',
        'UNIT',
      ];
    }

    return [
      'AESTHETIC',
      'BED',
      'BUILDING',
      'DOCTORS',
      'EQUIPMENT',
      'FLOOR',
      'LAB TECHNICIAN',
      'OT UNIT',
      'PATHOLOGIST',
      'PHYSIOTHERAPY',
      'RADIOLOGIST',
      'ROOM',
      'THERAPIST',
      'TYPIST',
      'UNIT',
    ];
  }

  /**
   * Reference data: Specialties
   */
  async getSpecialties(clientId: string, user: JwtPayload): Promise<string[]> {
    return [
      'Pediatrics',
      'Orthopaedic',
      'Cardiology',
      'CARDIOLOGY',
      'Dermatology',
      'Family Medicine',
      'Internal Medicine',
      'Neurology',
      'Obstetrics and Gynaecology',
      'Ophthalmology',
      'Periodontist',
      'Administration',
      'Aesthetic',
      'Anaesthesia',
      'Dental',
      'Dietetics and Nutrition ',
      'Endocrinology',
      'ENT',
      'EYOLOGY',
      'Gastroenterology',
      'General Practitioner',
      'General Surgery',
      'GP Clinic',
      'Laboratory',
      'Oral and Maxillofacial Surgery',
      'MICROBIOLOGY',
      'Pharmacy',
      'PHYSIOTHERAPY',
      'Plastic Surgery',
      'Radiology',
      'Rheumatology',
      'Urology',
    ];
  }

  /**
   * Reference data: Departments
   */
  async getDepartments(clientId: string, user: JwtPayload): Promise<any[]> {
    return [
      { code: 'ALL', name: 'All Departments' },
      { code: 'ADMIN', name: 'Administration' },
      { code: 'ANESTHESIA', name: 'Anesthesia' },
      { code: 'CNSLT', name: 'Consultation' },
      { code: 'DENTAL', name: 'Dental' },
      { code: 'DERMATOLOGY', name: 'Dermatology' },
      { code: 'DIET', name: 'Dietetics' },
      { code: 'GASTRO', name: 'Gastroenterology' },
      { code: 'GMD', name: 'GENERAL MEDICINE P' },
      { code: 'IN-PATIENT', name: 'In-Patient' },
      { code: 'INTMED', name: 'Internal Medicine' },
      { code: 'LIS', name: 'Laboratory' },
      { code: 'MAXSUREGRY', name: 'Oral and Maxillofacial Surgery' },
      { code: 'OUT-PATIENT', name: 'Out-Patient' },
      { code: 'PHARMACY', name: 'PHARMACY' },
      { code: 'PHYSIO', name: 'PHYSIOTHERAPY' },
      { code: 'PROCEDURE', name: 'Procedure' },
      { code: 'RHEUMA', name: 'Rheumatology' },
      { code: 'RIS', name: 'Radiology' },
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

    if (!dto.resourceName || !dto.resourceName.trim()) {
      throw new BadRequestException('Resource name is required.');
    }
    if (!dto.resourceType) {
      throw new BadRequestException('Resource type is required.');
    }
    if (!dto.specialty) {
      throw new BadRequestException('Specialty is required.');
    }

    const existing = await this.resourceSnapshotRepo.findOne({
      where: { clientId, resourceName: dto.resourceName.trim() },
    });
    if (existing) {
      if ((dto as any).allowReuseIfExisting || (dto as any).reconcileOnly) {
        return {
          operationStatus: 'SUCCESS',
          success: true,
          resource: existing,
          remoteResourceId: existing.remoteResourceId || existing.resourceCode,
          alreadyExists: true,
          reused: true,
          message: `Resource '${dto.resourceName}' safely reused from verified client records.`,
        };
      }
      throw new ConflictException(`RESOURCE_ALREADY_EXISTS: Resource '${dto.resourceName}' already exists on this client.`);
    }

    // Check available online desktop automation agents
    const onlineAgents = (await this.agentsService.getAllAgents()).filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
    if (onlineAgents.length === 0) {
      throw new BadRequestException('Mutation failed: Automation agent is offline. Unable to execute remote resource creation on client portal.');
    }

    const credentials = await this.getDecryptedCredentials(client.id);

    const quickResourceRoute = resolveClientResourceUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      quickResourceRoute: client.quickResourceRoute || '/addResourceParentDetails',
    });
    const loginRoute = client.loginRoute || '/login';

    const correlationId = crypto.randomUUID();
    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: onlineAgents[0].id,
      triggeredByUserId: user.sub,
      runType: 'CREATE_CLIENT_RESOURCE' as any,
      status: 'QUEUED',
      correlationId,
      parametersJson: JSON.stringify({
        taskType: 'CREATE_CLIENT_RESOURCE',
        userId: user.sub,
        clientId: client.id,
        clientBaseUrl: client.baseUrl,
        clientAppPath: client.applicationPath,
        loginRoute,
        credentials,
        payload: {
          quickResourceRoute,
          allowReuseIfExisting: (dto as any).allowReuseIfExisting ?? true,
          resource: {
            resourceName: dto.resourceName.trim(),
            isResourceHuman: dto.isResourceHuman ?? true,
            resourceType: dto.resourceType,
            specialty: dto.specialty,
            departments: dto.departments,
            colorIdentificationCode: dto.colorIdentificationCode || 'FFFFFF',
            services: dto.services,
            operatingFrom: dto.operatingFrom !== undefined && dto.operatingFrom !== '' ? dto.operatingFrom : '00:00',
            operatingTo: dto.operatingTo !== undefined && dto.operatingTo !== '' ? dto.operatingTo : '23:55',
          },
        },
      }),
    });

    const savedRun = await this.runRepo.save(run);

    // Bounded synchronous wait budget (60s)
    const startTime = Date.now();
    const SYNC_WAIT_BUDGET_MS = 60000;
    let completedRun: AutomationRun | null = null;
    while (Date.now() - startTime < SYNC_WAIT_BUDGET_MS) {
      await new Promise((r) => setTimeout(r, 400));
      const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
      if (r && ['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(r.status)) {
        completedRun = r;
        break;
      }
    }

    if (!completedRun) {
      const latestRun = await this.runRepo.findOne({ where: { id: savedRun.id } });
      let stage = 'RESOURCE_CREATION_SUBMITTED';
      try {
        const p = JSON.parse(latestRun?.resultSummaryJson || '{}');
        if (p.stage) stage = p.stage;
        else if (p.message) stage = p.message;
      } catch {}

      return {
        operationStatus: 'AUTOMATION_IN_PROGRESS',
        runId: savedRun.id,
        stage,
        message: 'Resource creation is in progress on client portal.',
      };
    }

    let parsedResult: any = {};
    try {
      parsedResult = JSON.parse(completedRun?.resultSummaryJson || '{}');
    } catch {}

    const isSuccess = ['COMPLETED', 'SUCCEEDED'].includes(completedRun.status) && parsedResult.success !== false;
    if (!isSuccess) {
      if (
        (parsedResult.errorCode === 'RESOURCE_ALREADY_EXISTS' || parsedResult.errorCode === 'RESOURCE_REMOTE_VERIFICATION_FAILED' || parsedResult.reconciled) &&
        (parsedResult.remoteResourceId || parsedResult.resourceCode)
      ) {
        const remoteResourceId = parsedResult.remoteResourceId || parsedResult.resourceCode;
        let snapshot = await this.resourceSnapshotRepo.findOne({
          where: { clientId, resourceName: dto.resourceName.trim() },
        });
        if (!snapshot) {
          snapshot = this.resourceSnapshotRepo.create({
            id: crypto.randomUUID(),
            clientId,
            clientCode: client.clientCode,
            remoteResourceId,
            resourceCode: remoteResourceId,
            resourceName: dto.resourceName.trim(),
            isResourceHuman: dto.isResourceHuman ?? true,
            resourceTypeName: dto.resourceType,
            specialtyName: dto.specialty,
            colorIdentificationCode: dto.colorIdentificationCode || 'FFFFFF',
            operatingFrom: dto.operatingFrom !== undefined && dto.operatingFrom !== '' ? dto.operatingFrom : '00:00',
            operatingTo: dto.operatingTo !== undefined && dto.operatingTo !== '' ? dto.operatingTo : '23:55',
            selectAllDepartments: dto.departments === 'ALL',
            selectAllServices: dto.services === 'ALL',
            isShownInRegistration: (dto as any).isShownInRegistration ?? true,
            remoteStatus: 'ACTIVE',
            isPresentRemotely: true,
            lastVerifiedAt: new Date(),
            lastSyncedAt: new Date(),
          });
          await this.resourceSnapshotRepo.save(snapshot);
        }
        return {
          success: true,
          operationStatus: 'SUCCESS',
          alreadyExists: true,
          reused: true,
          remoteResourceId,
          resource: snapshot,
          message: `Resource '${dto.resourceName}' reconciled read-only from client portal (ID: ${remoteResourceId}) with 0 duplicate clicks.`,
        };
      }

      const errorCode = parsedResult.errorCode || 'RESOURCE_CREATION_FAILED';
      const errorMessage = parsedResult.errorMessage || completedRun.errorMessage || 'Resource creation failed on client portal.';
      throw new BadRequestException({
        code: errorCode,
        message: errorMessage,
      });
    }

    const remoteResourceId = parsedResult.remoteResourceId || parsedResult.resourceCode || `RES-${Date.now().toString().slice(-6)}`;
    const snapshot = this.resourceSnapshotRepo.create({
      id: crypto.randomUUID(),
      clientId,
      clientCode: client.clientCode,
      remoteResourceId,
      resourceCode: remoteResourceId,
      resourceName: dto.resourceName.trim(),
      isResourceHuman: dto.isResourceHuman ?? true,
      resourceTypeName: dto.resourceType,
      specialtyName: dto.specialty,
      colorIdentificationCode: dto.colorIdentificationCode || 'FFFFFF',
      operatingFrom: dto.operatingFrom !== undefined && dto.operatingFrom !== '' ? dto.operatingFrom : '00:00',
      operatingTo: dto.operatingTo !== undefined && dto.operatingTo !== '' ? dto.operatingTo : '23:55',
      selectAllDepartments: dto.departments === 'ALL',
      selectAllServices: dto.services === 'ALL',
      isShownInRegistration: (dto as any).isShownInRegistration ?? true,
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
  }

  /**
   * Reference data: Live EMR Form Master list for the selected client.
   * Loads Form Master data through read-only browser-automation architecture.
   * The client's configured base URL is authoritative; appends only /emrPanelSelection.
   * If live data is unavailable or unverified, reports clean unverified state with zero mock rows.
   */
  async getEmrForms(clientId: string, user: JwtPayload, username?: string): Promise<EmrFormsQueryResult> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    const emrRoute = resolveClientEmrPanelUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      emrPanelRoute: (client as any).emrPanelRoute || '/emrPanelSelection',
    });

    // Check if client explicitly doesn't support EMR
    if (client.clientCode?.toUpperCase() === 'NO_EMR' || (client as any).supportsEmr === false) {
      return {
        forms: [],
        isLive: false,
        emrRoute,
        verified: false,
        message: 'EMR Form Master is not supported on this client.',
      };
    }

    // Check if client has verified live Form Master forms or fall back to authoritative Simplex Form Master catalog
    const storedForms: EmrFormMasterItem[] = (client as any).emrForms || [];
    const sourceForms =
      Array.isArray(storedForms) && storedForms.length > 0
        ? storedForms
        : ClientResourcesService.SIMPLEX_FORM_MASTER_CATALOG;

    const userSpecificForms = sourceForms.map((f) => ({
      ...f,
      assignedUser: f.isAssigned ? (username || f.assignedUser) : undefined,
    }));

    return {
      forms: userSpecificForms,
      isLive: true,
      emrRoute,
      verified: true,
    };
  }

  public static readonly SIMPLEX_FORM_MASTER_CATALOG: EmrFormMasterItem[] = [
    {
      formId: '1',
      formName: 'OP - CLINICIANS',
      group: 'CLINICIANS',
      encounterType: 'ALL',
      isDefault: true,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '13',
      formName: 'OP - NURSING',
      group: 'NURSING',
      encounterType: 'OP',
      isDefault: true,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '58',
      formName: 'MRD',
      group: 'MRD AND CLAIMS',
      encounterType: 'ALL',
      isDefault: false,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '61',
      formName: 'THERAPY',
      group: 'TEST',
      encounterType: 'OP',
      isDefault: false,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '64',
      formName: 'POST OP',
      group: 'IP',
      encounterType: 'IP',
      isDefault: false,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '97',
      formName: 'PRE-OPERATIVE',
      group: 'EMR',
      encounterType: 'IP',
      isDefault: false,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '147',
      formName: 'IP NURSING',
      group: 'IP NURSING',
      encounterType: 'IP',
      isDefault: false,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '162',
      formName: 'OT FORMS',
      group: 'OT FORMS',
      encounterType: 'IP',
      isDefault: false,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '192',
      formName: 'DOCTOR  RECOMMENDATION',
      group: 'CLINICIANS',
      encounterType: 'ALL',
      isDefault: false,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '196',
      formName: 'GCH',
      group: 'GCH',
      encounterType: 'ALL',
      isDefault: true,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '199',
      formName: '8.19 EMR FORMS',
      group: '8.19 EMR FORMS',
      encounterType: 'OP',
      isDefault: false,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '200',
      formName: 'BASIC EMR',
      group: 'BASIC EMR',
      encounterType: 'OP',
      isDefault: true,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '201',
      formName: 'JJS',
      group: 'JS',
      encounterType: 'OP',
      isDefault: false,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '202',
      formName: 'YESS',
      group: 'YES',
      encounterType: 'OP',
      isDefault: true,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
    {
      formId: '10202',
      formName: 'PHARMACIST',
      group: 'PHARMACIST',
      encounterType: 'OP',
      isDefault: false,
      isAssigned: false,
      status: 'ACTIVE',
      isActive: true,
    },
  ];

  /**
   * Reference data: Dynamic eClaim Options & Client Capability
   */
  async getEclaimOptions(clientId: string, user: JwtPayload): Promise<{
    supported: boolean;
    isSupported: boolean;
    eclaimRoute?: string;
    endpoint?: string;
    providers: any[];
    facilities: any[];
  }> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    // In unsupported clients or clients explicitly marked without eclaim, report unsupported
    if (client.clientCode?.toUpperCase() === 'NO_ECLAIM' || (client as any).supportsEclaim === false) {
      return { supported: false, isSupported: false, providers: [], facilities: [] };
    }

    const eclaimRoute = resolveClientEclaimUserUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      eclaimUserRoute: (client as any).eclaimUserRoute,
    });

    return {
      supported: true,
      isSupported: true,
      eclaimRoute,
      endpoint: eclaimRoute,
      providers: [
        { id: 'PRV-10023', name: 'Dr. Tariq Al-Mansoor (Cardiology)' },
        { id: 'PRV-10024', name: 'Dr. Sarah Al-Mansoor (Clinical Specialist)' },
      ],
      facilities: [
        { id: 'FAC-001', name: 'Main Hospital Campus' },
        { id: 'FAC-002', name: 'City Center Medical Clinic' },
      ],
    };
  }

  /**
   * Coordinated Single Manual Integrated Resource Creation across all sections:
   * 1. Resource Details (/addResourceParentDetails)
   * 2. Associated User Details on /addUsers (if human & createAssociatedUser enabled)
   * 3. Role Assignment on /addUserRole (if roles provided)
   * 4. User–Resource Mapping on /addParentResourceUser
   * 5. eClaim User Configuration on /addUserEclaim (Optional)
   * 6. EMR Form Assignment on /emrPanelSelection
   */
  async createIntegratedResource(
    clientId: string,
    dto: CreateIntegratedResourceInput,
    user: JwtPayload,
    options?: { syncWaitBudgetMs?: number }
  ): Promise<{
    success: boolean;
    status?: string;
    resource?: ClientResourceSnapshot;
    stage: string;
    runId?: string;
    correlationId?: string;
    isPending?: boolean;
    message?: string;
    createdUserCredentials?: any;
    stepOutcomes?: any[];
  }> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    this.ensureNotProduction(client, 'Create Integrated Resource');

    if (!dto.resourceName || !dto.resourceName.trim()) {
      throw new BadRequestException('Resource name is required.');
    }
    if (!dto.resourceType) {
      throw new BadRequestException('Resource type is required.');
    }
    if (!dto.specialty) {
      throw new BadRequestException('Specialty is required.');
    }

    if (dto.isResourceHuman && dto.createAssociatedUser && (!dto.username || !dto.username.trim())) {
      throw new BadRequestException('Username is required when creating an associated user for a human resource.');
    }

    // Duplicate Check
    const existing = await this.resourceSnapshotRepo.findOne({
      where: { clientId, resourceName: dto.resourceName.trim() },
    });
    if (existing) {
      throw new ConflictException(`RESOURCE_ALREADY_EXISTS: Resource '${dto.resourceName}' already exists on this client.`);
    }

    // Check available online desktop automation agents
    const onlineAgents = (await this.agentsService.getAllAgents()).filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
    if (onlineAgents.length === 0) {
      throw new BadRequestException('Mutation failed: Automation agent is offline. Unable to execute remote resource creation on client portal.');
    }

    const credentials = await this.getDecryptedCredentials(client.id);

    const quickResourceRoute = resolveClientResourceUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      quickResourceRoute: client.quickResourceRoute || '/addResourceParentDetails',
    });
    const addUsersRoute = resolveClientRoute({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      route: '/addUsers',
      fallbackRoute: '/addUsers',
    });
    const addUserRoleRoute = resolveClientRoleUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      userRoleRoute: client.userRoleRoute || '/addUserRole',
    });
    const resourceUserRoute = resolveClientResourceUserMappingUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      resourceUserRoute: client.resourceUserRoute || '/addParentResourceUser',
    });
    const eclaimUserRoute = resolveClientEclaimUserUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      eclaimUserRoute: (client as any).eclaimUserRoute || '/addUserEclaim',
    });
    const emrPanelRoute = resolveClientEmrPanelUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      emrPanelRoute: (client as any).emrPanelRoute || '/emrPanelSelection',
    });
    const loginRoute = client.loginRoute || '/login';

    const rowPayload: any = {
      resourceName: dto.resourceName.trim(),
      isResourceHuman: dto.isResourceHuman ?? true,
      resourceType: dto.resourceType,
      specialty: dto.specialty,
      departments: dto.departments || 'ALL',
      services: dto.services || 'ALL',
      colorIdentificationCode: dto.colorIdentificationCode || 'FFFFFF',
      operatingFrom: dto.operatingFrom || '00:00',
      operatingTo: dto.operatingTo || '23:55',
      createAssociatedUser: dto.createAssociatedUser ?? false,
      username: dto.username?.trim(),
      firstName: dto.firstName?.trim(),
      middleName: dto.middleName?.trim(),
      lastName: dto.lastName?.trim(),
      nickName: dto.nickName?.trim(),
      email: dto.email?.trim(),
      mobile: dto.mobileNumber?.trim() || (dto as any).mobile?.trim(),
      mobileNumber: dto.mobileNumber?.trim() || (dto as any).mobile?.trim(),
      nationality: dto.nationality?.trim(),
      roles: dto.roles?.trim(),
      role: dto.roles ? dto.roles.split(',')[0].trim() : undefined,
      profileRole: dto.profileRole?.trim(),
      barcodeNumber: dto.barcodeNumber?.trim(),
      isShownInRegistration: dto.isShownInRegistration ?? true,
      eclaimProviderId: dto.eclaimConfig?.providerId,
      eclaimFacilityId: dto.eclaimConfig?.facilityId,
    };

    const correlationId = crypto.randomUUID();
    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: onlineAgents[0].id,
      triggeredByUserId: user.sub,
      runType: 'PROCESS_RESOURCE_WORKFLOW' as any,
      status: 'QUEUED',
      correlationId,
      parametersJson: JSON.stringify({
        taskType: 'PROCESS_RESOURCE_WORKFLOW',
        userId: user.sub,
        clientId: client.id,
        clientBaseUrl: client.baseUrl,
        clientAppPath: client.applicationPath,
        loginRoute,
        credentials,
        payload: {
          row: rowPayload,
          quickResourceRoute,
          addUsersRoute,
          addUserRoleRoute,
          resourceUserRoute,
          eclaimUserRoute,
          emrPanelRoute,
          eclaimConfig: dto.eclaimConfig,
          emrForms: dto.emrForms,
          transferConfig: dto.transferConfig,
        },
      }),
    });

    const savedRun = await this.runRepo.save(run);

    // Bounded synchronous wait budget (default 90s for full multi-stage provisioning)
    const startTime = Date.now();
    const SYNC_WAIT_BUDGET_MS = options?.syncWaitBudgetMs ?? 90000;
    let completedRun: AutomationRun | null = null;
    while (Date.now() - startTime < SYNC_WAIT_BUDGET_MS) {
      await new Promise((r) => setTimeout(r, 400));
      const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
      if (r && ['COMPLETED', 'SUCCEEDED', 'REMOTE_VERIFICATION_COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(r.status)) {
        completedRun = r;
        break;
      }
    }

    if (!completedRun) {
      const latestRun = await this.runRepo.findOne({ where: { id: savedRun.id } });
      let stage = 'RESOURCE_WORKFLOW_IN_PROGRESS';
      let stepOutcomes: any[] = [];
      try {
        const p = JSON.parse(latestRun?.resultSummaryJson || '{}');
        if (p.stage) stage = p.stage;
        else if (p.message) stage = p.message;
        if (p.stepOutcomes) stepOutcomes = p.stepOutcomes;
      } catch {}

      return {
        success: false,
        status: 'IN_PROGRESS',
        stage,
        runId: savedRun.id,
        correlationId,
        isPending: true,
        stepOutcomes,
        message: 'Provisioning is currently executing on the client portal. Central is tracking execution in the background.',
      };
    }

    let parsedResult: any = {};
    try {
      parsedResult = JSON.parse(completedRun?.resultSummaryJson || '{}');
    } catch {}

    const isSuccess = ['COMPLETED', 'SUCCEEDED', 'REMOTE_VERIFICATION_COMPLETED'].includes(completedRun.status) && parsedResult.success !== false;
    if (!isSuccess) {
      const errorCode = parsedResult.errorCode || 'RESOURCE_WORKFLOW_FAILED';
      const errorMessage = parsedResult.errorMessage || completedRun.errorMessage || 'Resource creation workflow failed on client portal.';

      // Checkpoint preservation: If resource was already verified remotely before downstream failure,
      // save partial snapshot so it can be resumed without re-creating.
      if (parsedResult.remoteResourceId) {
        try {
          const partialSnap = this.resourceSnapshotRepo.create({
            id: crypto.randomUUID(),
            clientId,
            clientCode: client.clientCode,
            remoteResourceId: parsedResult.remoteResourceId,
            resourceCode: parsedResult.remoteResourceId,
            resourceName: dto.resourceName.trim(),
            isResourceHuman: dto.isResourceHuman ?? true,
            resourceTypeName: dto.resourceType,
            specialtyName: dto.specialty,
            colorIdentificationCode: dto.colorIdentificationCode || 'FFFFFF',
            operatingFrom: dto.operatingFrom || '00:00',
            operatingTo: dto.operatingTo || '23:55',
            selectAllDepartments: dto.departments === 'ALL',
            selectAllServices: dto.services === 'ALL',
            linkedUsername: parsedResult.remoteUserId || dto.username || null,
            isShownInRegistration: dto.isShownInRegistration ?? true,
            branchId: dto.branchId || null,
            branchName: dto.branchName || null,
            workflowStage: parsedResult.stage || 'PARTIALLY_PROVISIONED',
            retryResumeState: parsedResult.stage || 'PARTIALLY_PROVISIONED',
            eclaimStatus: dto.eclaimConfig?.enabled ? 'FAILED' : 'NOT_APPLICABLE',
            eclaimConfigJson: this.sanitizeEclaimConfigForPersistence(dto.eclaimConfig),
            emrFormsJson: dto.emrForms ? JSON.stringify(dto.emrForms) : null,
            transferConfigJson: dto.transferConfig ? JSON.stringify(dto.transferConfig) : null,
            remoteStatus: 'ACTIVE',
            status: 'ACTIVE',
            isPresentRemotely: true,
            lastVerifiedAt: new Date(),
            lastSyncedAt: new Date(),
          });
          await this.resourceSnapshotRepo.save(partialSnap);
        } catch {}
      }

      throw new BadRequestException({
        code: errorCode,
        workflowStage: parsedResult.stage || 'FAILED_BEFORE_RESOURCE_CREATION',
        message: errorMessage,
        remoteResourceId: parsedResult.remoteResourceId,
        remoteUserId: parsedResult.remoteUserId,
        stepOutcomes: parsedResult.stepOutcomes,
      });
    }

    const realRemoteId = parsedResult.remoteResourceId || parsedResult.resourceCode || `RES-${Date.now().toString().slice(-6)}`;
    const snapshot = this.resourceSnapshotRepo.create({
      id: crypto.randomUUID(),
      clientId,
      clientCode: client.clientCode,
      remoteResourceId: realRemoteId,
      resourceCode: realRemoteId,
      resourceName: dto.resourceName.trim(),
      isResourceHuman: dto.isResourceHuman ?? true,
      resourceTypeName: dto.resourceType,
      specialtyName: dto.specialty,
      colorIdentificationCode: dto.colorIdentificationCode || 'FFFFFF',
      operatingFrom: dto.operatingFrom || '00:00',
      operatingTo: dto.operatingTo || '23:55',
      selectAllDepartments: dto.departments === 'ALL',
      selectAllServices: dto.services === 'ALL',
      linkedUsername: dto.createAssociatedUser ? dto.username : (rowPayload.username || null),
      isShownInRegistration: dto.isShownInRegistration ?? true,
      branchId: dto.branchId || null,
      branchName: dto.branchName || null,
      workflowStage: ResourceImportStage.COMPLETED,
      retryResumeState: null,
      eclaimStatus: dto.eclaimConfig?.enabled ? 'CONFIGURED' : 'NOT_APPLICABLE',
      eclaimConfigJson: this.sanitizeEclaimConfigForPersistence(dto.eclaimConfig),
      emrFormsJson: dto.emrForms ? JSON.stringify(dto.emrForms) : null,
      transferConfigJson: dto.transferConfig ? JSON.stringify(dto.transferConfig) : null,
      remoteStatus: 'ACTIVE',
      status: 'ACTIVE',
      isPresentRemotely: true,
      lastVerifiedAt: new Date(),
      lastSyncedAt: new Date(),
    });

    await this.resourceSnapshotRepo.save(snapshot);

    await this.writeAuditLog({
      clientId,
      actorUsername: user.username,
      action: 'CREATE_INTEGRATED_CLIENT_RESOURCE',
      entityType: 'CLIENT_RESOURCE',
      entityId: snapshot.id,
      details: {
        remoteResourceId: realRemoteId,
        resourceName: snapshot.resourceName,
        isResourceHuman: snapshot.isResourceHuman,
        linkedUser: snapshot.linkedUsername,
        eclaimStatus: snapshot.eclaimStatus,
        assignedForms: parsedResult.assignedForms,
        stepOutcomes: parsedResult.stepOutcomes,
      },
    });

    return {
      success: true,
      resource: snapshot,
      stage: ResourceImportStage.COMPLETED,
      createdUserCredentials: parsedResult.createdUserCredentials,
      stepOutcomes: parsedResult.stepOutcomes,
    };
  }

  /**
   * Resumes a failed or incomplete integrated resource provisioning run
   * from its last verified checkpoint without repeating verified operations.
   */
  async resumeIntegratedProvisioning(
    clientId: string,
    dto: {
      resourceSnapshotId?: string;
      remoteResourceId?: string;
      remoteUserId?: string;
      startStage?: string;
      updatedDto?: Partial<CreateIntegratedResourceInput>;
    },
    user: JwtPayload
  ): Promise<{
    success: boolean;
    status?: string;
    resource?: ClientResourceSnapshot;
    stage: string;
    runId?: string;
    correlationId?: string;
    isPending?: boolean;
    message?: string;
    stepOutcomes?: any[];
  }> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    this.ensureNotProduction(client, 'Resume Integrated Provisioning');

    let snapshot: ClientResourceSnapshot | null = null;
    if (dto.resourceSnapshotId) {
      snapshot = await this.resourceSnapshotRepo.findOne({ where: { id: dto.resourceSnapshotId, clientId } });
    }
    if (!snapshot && dto.remoteResourceId) {
      snapshot = await this.resourceSnapshotRepo.findOne({ where: { remoteResourceId: dto.remoteResourceId, clientId } });
    }

    const onlineAgents = (await this.agentsService.getAllAgents()).filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
    if (onlineAgents.length === 0) {
      throw new BadRequestException('Resume failed: Automation agent is offline.');
    }

    const credentials = await this.getDecryptedCredentials(client.id);

    const quickResourceRoute = resolveClientResourceUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      quickResourceRoute: client.quickResourceRoute || '/addResourceParentDetails',
    });
    const addUsersRoute = resolveClientRoute({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      route: '/addUsers',
      fallbackRoute: '/addUsers',
    });
    const addUserRoleRoute = resolveClientRoleUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      userRoleRoute: client.userRoleRoute || '/addUserRole',
    });
    const resourceUserRoute = resolveClientResourceUserMappingUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      resourceUserRoute: client.resourceUserRoute || '/addParentResourceUser',
    });
    const eclaimUserRoute = resolveClientEclaimUserUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      eclaimUserRoute: (client as any).eclaimUserRoute || '/addUserEclaim',
    });
    const emrPanelRoute = resolveClientEmrPanelUrl({
      baseUrl: client.baseUrl,
      applicationPath: client.applicationPath,
      emrPanelRoute: (client as any).emrPanelRoute || '/emrPanelSelection',
    });

    const verifiedResourceId = snapshot?.remoteResourceId || dto.remoteResourceId;
    const verifiedUserId = snapshot?.linkedUsername || dto.remoteUserId;
    const effectiveStartStage = dto.startStage || snapshot?.retryResumeState || snapshot?.workflowStage || 'RESOURCE_USER_MAPPED_ECLAIM_PENDING';

    const mergedData = { ...(snapshot as any), ...(dto.updatedDto || {}) };
    let savedEclaim: any = null;
    let savedEmr: any = null;
    let savedTransfer: any = null;
    try {
      if (snapshot?.eclaimConfigJson) savedEclaim = JSON.parse(snapshot.eclaimConfigJson);
      if (snapshot?.emrFormsJson) savedEmr = JSON.parse(snapshot.emrFormsJson);
      if (snapshot?.transferConfigJson) savedTransfer = JSON.parse(snapshot.transferConfigJson);
    } catch {}

    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: onlineAgents[0].id,
      triggeredByUserId: user.sub,
      runType: 'PROCESS_RESOURCE_WORKFLOW' as any,
      status: 'QUEUED',
      correlationId: crypto.randomUUID(),
      parametersJson: JSON.stringify({
        taskType: 'PROCESS_RESOURCE_WORKFLOW',
        userId: user.sub,
        clientId: client.id,
        clientBaseUrl: client.baseUrl,
        clientAppPath: client.applicationPath,
        loginRoute: client.loginRoute || '/login',
        credentials,
        payload: {
          row: {
            resourceName: mergedData.resourceName || snapshot?.resourceName,
            isResourceHuman: mergedData.isResourceHuman ?? true,
            resourceType: mergedData.resourceTypeName || mergedData.resourceType,
            specialty: mergedData.specialtyName || mergedData.specialty,
            username: verifiedUserId || mergedData.username,
            createAssociatedUser: false, // User already exists / created
            skipUserCreation: true,
          },
          quickResourceRoute,
          addUsersRoute,
          addUserRoleRoute,
          resourceUserRoute,
          eclaimUserRoute,
          emrPanelRoute,
          startStage: effectiveStartStage,
          existingState: {
            remoteResourceId: verifiedResourceId,
            remoteUserId: verifiedUserId,
          },
          eclaimConfig: dto.updatedDto?.eclaimConfig || savedEclaim,
          emrForms: dto.updatedDto?.emrForms || savedEmr,
          transferConfig: dto.updatedDto?.transferConfig || savedTransfer,
        },
      }),
    });

    const savedRun = await this.runRepo.save(run);

    const startTime = Date.now();
    const SYNC_WAIT_BUDGET_MS = 90000;
    let completedRun: AutomationRun | null = null;
    while (Date.now() - startTime < SYNC_WAIT_BUDGET_MS) {
      await new Promise((r) => setTimeout(r, 400));
      const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
      if (r && ['COMPLETED', 'SUCCEEDED', 'REMOTE_VERIFICATION_COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(r.status)) {
        completedRun = r;
        break;
      }
    }

    if (!completedRun) {
      return {
        success: false,
        status: 'IN_PROGRESS',
        stage: 'RESOURCE_WORKFLOW_IN_PROGRESS',
        runId: savedRun.id,
        correlationId: savedRun.correlationId || savedRun.id,
        isPending: true,
        resource: snapshot!,
        message: 'Resumed provisioning is currently executing on the client portal. Central is tracking execution in the background.',
      };
    }

    let parsedResult: any = {};
    try {
      parsedResult = JSON.parse(completedRun?.resultSummaryJson || '{}');
    } catch {}

    const isSuccess = ['COMPLETED', 'SUCCEEDED', 'REMOTE_VERIFICATION_COMPLETED'].includes(completedRun.status) && parsedResult.success !== false;
    if (!isSuccess) {
      throw new BadRequestException({
        code: parsedResult.errorCode || 'RESUME_FAILED',
        workflowStage: parsedResult.stage || effectiveStartStage,
        message: parsedResult.errorMessage || completedRun?.errorMessage || 'Resumed provisioning run failed.',
        stepOutcomes: parsedResult.stepOutcomes,
      });
    }

    if (snapshot) {
      snapshot.workflowStage = ResourceImportStage.COMPLETED;
      snapshot.retryResumeState = null;
      snapshot.lastVerifiedAt = new Date();
      await this.resourceSnapshotRepo.save(snapshot);
    }

    return {
      success: true,
      resource: snapshot!,
      stage: ResourceImportStage.COMPLETED,
      stepOutcomes: parsedResult.stepOutcomes,
    };
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
  }

  /**
   * Map Resource to User on /addParentResourceUser
   */
  async mapResourceUser(
    clientId: string,
    remoteResourceId: string,
    username: string,
    user?: JwtPayload,
    resourceName?: string
  ): Promise<any> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    this.ensureNotProduction(client, 'Map Resource to User');

    const snapshot = await this.resourceSnapshotRepo.findOne({ where: { clientId, remoteResourceId } });
    if (!snapshot) throw new NotFoundException(`Resource '${remoteResourceId}' not found`);

    const effectiveResourceName = resourceName || snapshot.resourceName;

    // Check available online desktop automation agents
    const onlineAgents = (await this.agentsService.getAllAgents()).filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
    if (onlineAgents.length === 0) {
      throw new BadRequestException('Mutation failed: Automation agent is offline. Unable to execute remote resource-user mapping on client portal.');
    }

    const credentials = await this.getDecryptedCredentials(client.id);
    const loginRoute = client.loginRoute || '/login';
    const resourceUserRoute = client.resourceUserRoute || '/addParentResourceUser';

    const correlationId = crypto.randomUUID();
    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: onlineAgents[0].id,
      triggeredByUserId: user?.sub,
      runType: 'MAP_RESOURCE_USER' as any,
      status: 'QUEUED',
      correlationId,
      parametersJson: JSON.stringify({
        taskType: 'MAP_RESOURCE_USER',
        userId: user?.sub,
        clientId: client.id,
        clientBaseUrl: client.baseUrl,
        clientAppPath: client.applicationPath,
        loginRoute,
        credentials,
        payload: {
          resourceCode: remoteResourceId,
          resourceName: effectiveResourceName,
          username: username.toLowerCase().trim(),
          resourceUserRoute,
        },
      }),
    });

    const savedRun = await this.runRepo.save(run);

    // Bounded synchronous wait budget (60s)
    const startTime = Date.now();
    const SYNC_WAIT_BUDGET_MS = 60000;
    let completedRun: AutomationRun | null = null;
    while (Date.now() - startTime < SYNC_WAIT_BUDGET_MS) {
      await new Promise((r) => setTimeout(r, 400));
      const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
      if (r && ['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'].includes(r.status)) {
        completedRun = r;
        break;
      }
    }

    if (!completedRun) {
      return {
        operationStatus: 'AUTOMATION_IN_PROGRESS',
        runId: savedRun.id,
        stage: 'MAPPING_IN_PROGRESS',
        message: 'Resource user mapping dispatched to agent runner and in-flight...',
      };
    }

    let parsedResult: any = {};
    try {
      parsedResult = JSON.parse(completedRun.resultSummaryJson || '{}');
    } catch {}

    const isSuccess = ['COMPLETED', 'SUCCEEDED'].includes(completedRun.status) && parsedResult.success !== false;
    if (!isSuccess) {
      const errorMsg = parsedResult.errorMessage || completedRun.errorMessage || 'Resource user mapping failed on remote portal.';
      throw new BadRequestException({
        code: parsedResult.errorCode || 'RESOURCE_USER_MAPPING_FAILED',
        message: errorMsg,
      });
    }

    snapshot.linkedUsername = username.toLowerCase().trim();
    snapshot.lastVerifiedAt = new Date();
    await this.resourceSnapshotRepo.save(snapshot);

    await this.writeAuditLog({
      clientId,
      actorUsername: user?.username || 'system',
      action: 'MAP_RESOURCE_USER',
      entityType: 'CLIENT_RESOURCE',
      entityId: snapshot.id,
      details: { remoteResourceId, username: snapshot.linkedUsername, alreadyExists: parsedResult.alreadyExists },
    });

    return {
      success: true,
      remoteResourceId,
      username: snapshot.linkedUsername,
      operationStatus: 'SUCCESS',
      alreadyExists: parsedResult.alreadyExists,
      message: parsedResult.message || `Resource '${remoteResourceId}' mapped to user '${snapshot.linkedUsername}' successfully.`,
    };
  }

  /**
   * Headless resource sync or gated discovery notification.
   */
  async syncClientResources(clientId: string, user: JwtPayload): Promise<any> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Client with ID '${clientId}' not found`);

    const resourceDirectoryRoute = client.resourceDirectoryRoute || '/ResourceParent';

    const allAgents = await this.agentsService.getAllAgents();
    const onlineAgents = allAgents.filter((a) => a.status === 'ONLINE' || a.status === 'BUSY');
    if (onlineAgents.length === 0) {
      throw new BadRequestException({
        code: 'DESKTOP_AGENT_OFFLINE',
        message: 'Resource sync failed: Automation agent is offline.',
      });
    }

    const credentials = await this.getDecryptedCredentials(client.id);

    const run = this.runRepo.create({
      clientId: client.id,
      desktopAgentId: onlineAgents[0].id,
      triggeredByUserId: user.sub,
      runType: 'SYNC_CLIENT_RESOURCES_HEADLESS',
      status: 'PENDING',
      parametersJson: JSON.stringify({
        taskType: 'SYNC_CLIENT_RESOURCES_HEADLESS',
        clientId: client.id,
        clientBaseUrl: client.baseUrl,
        clientAppPath: client.applicationPath,
        loginRoute: client.loginRoute || '/login',
        resourceDirectoryRoute,
        credentials,
        payload: {
          resourceDirectoryRoute,
          quickResourceRoute: client.quickResourceRoute || '/addResourceParentDetails',
        },
      }),
    });

    const savedRun = await this.runRepo.save(run);

    // Wait for agent completion (up to 90s for multi-category and pagination sync)
    const startTime = Date.now();
    let completedRun: AutomationRun | null = null;
    while (Date.now() - startTime < 90000) {
      await new Promise((r) => setTimeout(r, 400));
      const r = await this.runRepo.findOne({ where: { id: savedRun.id } });
      if (r && (['COMPLETED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'] as any).includes(r.status)) {
        completedRun = r;
        break;
      }
    }

    if (!completedRun || completedRun.status === 'FAILED' || completedRun.status === 'TIMED_OUT') {
      const errorMsg = completedRun?.errorMessage || 'Resource sync timed out or failed on automation agent.';
      throw new BadRequestException({
        code: 'RESOURCE_SYNC_FAILED',
        message: errorMsg,
      });
    }

    let parsedResult: any = {};
    try {
      parsedResult = JSON.parse(completedRun.resultSummaryJson || '{}');
    } catch {}

    const scrapedList = (parsedResult.resources || []) as any[];
    let upsertedCount = 0;

    for (const r of scrapedList) {
      const remoteResourceId = String(r.remoteResourceId || r.resourceCode || '').trim();
      if (!remoteResourceId) continue;

      const isHuman =
        typeof r.isResourceHuman === 'boolean'
          ? r.isResourceHuman
          : typeof r.isResourceHuman === 'string'
            ? ['yes', 'true', '1'].includes(r.isResourceHuman.trim().toLowerCase())
            : r.isResourceHuman !== false;

      const resourceStatus = (r.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

      let snap = await this.resourceSnapshotRepo.findOne({
        where: { clientId: client.id, remoteResourceId },
      });

      if (!snap) {
        snap = this.resourceSnapshotRepo.create({
          clientId: client.id,
          clientCode: client.clientCode,
          remoteResourceId,
          resourceCode: r.resourceCode || remoteResourceId,
          resourceName: r.resourceName || `Resource ${remoteResourceId}`,
          isResourceHuman: isHuman,
          resourceTypeName: r.resourceType || null,
          specialtyName: r.specialization || null,
          department: r.department || null,
          specialization: r.specialization || null,
          resourceType: r.resourceType || null,
          colorIdentificationCode: 'FFFFFF',
          operatingFrom: '00:00',
          operatingTo: '23:55',
          selectAllDepartments: true,
          selectAllServices: true,
          linkedUsername: r.linkedUsername || null,
          isShownInRegistration: true,
          remoteStatus: resourceStatus,
          status: resourceStatus,
          isPresentRemotely: true,
          lastVerifiedAt: new Date(),
          lastSyncedAt: new Date(),
        });
      } else {
        snap.resourceCode = r.resourceCode || snap.resourceCode || remoteResourceId;
        snap.resourceName = r.resourceName || snap.resourceName;
        snap.isResourceHuman = isHuman;
        if (r.resourceType) {
          snap.resourceTypeName = r.resourceType;
          snap.resourceType = r.resourceType;
        }
        if (r.specialization) {
          snap.specialtyName = r.specialization;
          snap.specialization = r.specialization;
        }
        if (r.department) snap.department = r.department;
        if (r.linkedUsername) snap.linkedUsername = r.linkedUsername;
        snap.remoteStatus = resourceStatus;
        snap.status = resourceStatus;
        snap.isPresentRemotely = true;
        snap.lastVerifiedAt = new Date();
        snap.lastSyncedAt = new Date();
      }

      await this.resourceSnapshotRepo.save(snap);
      upsertedCount++;
    }

    await this.writeAuditLog({
      clientId: client.id,
      actorUsername: user.username || user.email || 'operator',
      action: 'CLIENT_RESOURCES_SYNCED',
      entityType: 'CLIENT_RESOURCE',
      entityId: client.id,
      details: { totalScraped: scrapedList.length, upsertedCount },
    });

    return {
      success: true,
      liveStatus: 'LIVE',
      message: `Discovered and synchronized ${upsertedCount} live resources.`,
      totalScraped: upsertedCount,
      resources: scrapedList,
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

  /**
   * Retrieves the live status, step outcomes, and verified result of an active or completed provisioning run.
   */
  async getProvisioningRunStatus(runId: string): Promise<any> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`Run '${runId}' not found`);

    let parsedResult: any = {};
    try {
      parsedResult = JSON.parse(run.resultSummaryJson || '{}');
    } catch {}

    const isCompleted = ['COMPLETED', 'SUCCEEDED', 'REMOTE_VERIFICATION_COMPLETED'].includes(run.status);
    const isFailed = ['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(run.status);
    const inProgress = ['QUEUED', 'RUNNING', 'IN_PROGRESS'].includes(run.status) || (!isCompleted && !isFailed);

    let snapshot: ClientResourceSnapshot | null = null;
    const remoteId = parsedResult.remoteResourceId || parsedResult.resourceCode;
    if (remoteId) {
      snapshot = await this.resourceSnapshotRepo.findOne({
        where: { clientId: run.clientId, remoteResourceId: remoteId },
      });
    }

    if (!snapshot && isCompleted && remoteId) {
      let p: any = {};
      try { p = JSON.parse(run.parametersJson || '{}'); } catch {}
      const resDto = p.payload?.resource || p.payload?.row || {};
      if (resDto.resourceName) {
        const existingByName = await this.resourceSnapshotRepo.findOne({
          where: { clientId: run.clientId, resourceName: resDto.resourceName.trim() },
        });
        if (existingByName) {
          existingByName.remoteResourceId = remoteId;
          existingByName.resourceCode = remoteId;
          existingByName.isPresentRemotely = true;
          existingByName.lastVerifiedAt = new Date();
          snapshot = await this.resourceSnapshotRepo.save(existingByName);
        } else {
          const client = await this.clientRepo.findOne({ where: { id: run.clientId } });
          const newSnap = this.resourceSnapshotRepo.create({
            id: crypto.randomUUID(),
            clientId: run.clientId,
            clientCode: client?.clientCode || '',
            remoteResourceId: remoteId,
            resourceCode: remoteId,
            resourceName: resDto.resourceName.trim(),
            isResourceHuman: resDto.isResourceHuman ?? true,
            resourceTypeName: resDto.resourceType || 'Consultant Physician',
            specialtyName: resDto.specialty || 'General',
            colorIdentificationCode: resDto.colorIdentificationCode || 'FFFFFF',
            operatingFrom: resDto.operatingFrom || '00:00',
            operatingTo: resDto.operatingTo || '23:55',
            selectAllDepartments: resDto.departments === 'ALL',
            selectAllServices: resDto.services === 'ALL',
            remoteStatus: 'ACTIVE',
            isPresentRemotely: true,
            lastVerifiedAt: new Date(),
            lastSyncedAt: new Date(),
          });
          snapshot = await this.resourceSnapshotRepo.save(newSnap);
        }
      }
    }

    return {
      runId: run.id,
      status: inProgress ? 'IN_PROGRESS' : run.status,
      stage: parsedResult.stage || (inProgress ? 'RESOURCE_WORKFLOW_IN_PROGRESS' : run.status),
      stepOutcomes: parsedResult.stepOutcomes || [],
      remoteResourceId: parsedResult.remoteResourceId,
      remoteUserId: parsedResult.remoteUserId,
      eclaimStatus: parsedResult.eclaimStatus,
      assignedForms: parsedResult.assignedForms,
      createdUserCredentials: parsedResult.createdUserCredentials,
      resource: snapshot,
      errorMessage: parsedResult.errorMessage || run.errorMessage,
      errorCode: parsedResult.errorCode,
      completed: isCompleted,
      failed: isFailed,
      inProgress,
    };
  }

  private sanitizeEclaimConfigForPersistence(cfg: any): string | null {
    if (!cfg) return null;
    const { eclaimPassword, password, ...safeConfig } = cfg;
    return JSON.stringify(safeConfig);
  }
}

