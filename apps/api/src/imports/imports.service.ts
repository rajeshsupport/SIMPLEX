import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { stringify } from 'csv-stringify/sync';
import {
  ImportJob,
  ImportJobRow,
  Client,
  StoredFile,
} from '@hmc/database';
import {
  CreateImportJobDto,
  ImportPreviewSummary,
  ImportJobType,
} from '@hmc/shared';
import { SpreadsheetService } from './spreadsheet.service.js';

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @InjectRepository(ImportJob)
    private jobRepo: Repository<ImportJob>,
    @InjectRepository(ImportJobRow)
    private rowRepo: Repository<ImportJobRow>,
    @InjectRepository(Client)
    private clientRepo: Repository<Client>,
    @InjectRepository(StoredFile)
    private fileRepo: Repository<StoredFile>,
    private spreadsheetService: SpreadsheetService
  ) {}

  async previewSpreadsheet(
    fileBuffer: Buffer,
    fileName: string,
    fileSizeBytes: number,
    jobType: ImportJobType,
    customMappings?: Record<string, string>
  ): Promise<ImportPreviewSummary> {
    const rawRecords = this.spreadsheetService.parseFileBuffer(fileBuffer, fileName);
    return this.spreadsheetService.generatePreview(
      rawRecords,
      fileName,
      fileSizeBytes,
      jobType,
      customMappings
    );
  }

  async createImportJob(
    dto: CreateImportJobDto,
    fileBuffer: Buffer,
    fileName: string,
    username: string
  ): Promise<ImportJob> {
    const client = await this.clientRepo.findOne({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Target client not found');

    // Production guardrail: Check typed confirmation
    if (client.environment === 'Production') {
      if (!dto.typedConfirmation || dto.typedConfirmation.trim().toUpperCase() !== client.clientCode.toUpperCase()) {
        throw new BadRequestException(
          `Production client import requires typing the exact client code '${client.clientCode}' as confirmation.`
        );
      }
    }

    const rawRecords = this.spreadsheetService.parseFileBuffer(fileBuffer, fileName);
    const preview = this.spreadsheetService.generatePreview(
      rawRecords,
      fileName,
      fileBuffer.length,
      dto.jobType,
      dto.columnMappings
    );

    const job = this.jobRepo.create({
      clientId: client.id,
      jobType: dto.jobType,
      originalFileName: fileName,
      totalRows: dto.oneRecordTestMode ? 1 : rawRecords.length,
      processedRows: 0,
      succeededRows: 0,
      failedRows: 0,
      skippedRows: 0,
      status: 'PENDING',
      columnMappingsJson: JSON.stringify(preview.suggestedMappings),
      oneRecordTestMode: Boolean(dto.oneRecordTestMode),
      typedConfirmation: dto.typedConfirmation || null,
      createdBy: username,
      updatedBy: username,
    });

    const savedJob = await this.jobRepo.save(job);

    // Save rows
    const rowsToInsert: ImportJobRow[] = [];
    const limit = dto.oneRecordTestMode ? 1 : rawRecords.length;

    for (let i = 0; i < limit; i++) {
      const raw = rawRecords[i];
      const mapped: Record<string, any> = {};
      for (const [target, source] of Object.entries(preview.suggestedMappings)) {
        if (source && raw[source] !== undefined) {
          mapped[target] = raw[source];
        }
      }

      rowsToInsert.push(
        this.rowRepo.create({
          importJobId: savedJob.id,
          rowIndex: i + 1,
          rawDataJson: JSON.stringify(raw),
          mappedDataJson: JSON.stringify(mapped),
          status: 'PENDING',
        })
      );
    }

    await this.rowRepo.save(rowsToInsert);
    return savedJob;
  }

  async getImportJobs(clientId?: string): Promise<ImportJob[]> {
    const where = clientId ? { clientId } : {};
    return this.jobRepo.find({
      where,
      relations: ['client'],
      order: { createdAt: 'DESC' },
    });
  }

  async getImportJobById(id: string): Promise<ImportJob & { rows: ImportJobRow[] }> {
    const job = await this.jobRepo.findOne({
      where: { id },
      relations: ['client', 'rows'],
    });
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }

  async pauseImportJob(id: string, username: string): Promise<ImportJob> {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Import job not found');
    if (job.status !== 'PROCESSING' && job.status !== 'PENDING') {
      throw new BadRequestException(`Cannot pause job in status ${job.status}`);
    }

    job.status = 'PAUSED';
    job.updatedBy = username;
    return this.jobRepo.save(job);
  }

  async resumeImportJob(id: string, username: string): Promise<ImportJob> {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Import job not found');
    if (job.status !== 'PAUSED') {
      throw new BadRequestException(`Cannot resume job in status ${job.status}`);
    }

    job.status = 'PROCESSING';
    job.updatedBy = username;
    return this.jobRepo.save(job);
  }

  async cancelImportJob(id: string, username: string): Promise<ImportJob> {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Import job not found');

    job.status = 'CANCELLED';
    job.updatedBy = username;
    return this.jobRepo.save(job);
  }

  async retryFailedRows(id: string, username: string): Promise<ImportJob> {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Import job not found');

    const failedRows = await this.rowRepo.find({
      where: { importJobId: job.id, status: In(['FAILED', 'REQUIRES_REVIEW']) },
    });

    if (failedRows.length === 0) {
      throw new BadRequestException('No failed rows available to retry');
    }

    for (const row of failedRows) {
      row.status = 'PENDING';
      row.retryCount += 1;
      row.errorMessage = null;
    }
    await this.rowRepo.save(failedRows);

    job.status = 'PROCESSING';
    job.failedRows -= failedRows.length;
    job.updatedBy = username;
    return this.jobRepo.save(job);
  }

  async exportErrorsCsv(id: string): Promise<{ fileName: string; csvContent: string }> {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Import job not found');

    const failedRows = await this.rowRepo.find({
      where: { importJobId: job.id, status: In(['FAILED', 'REQUIRES_REVIEW']) },
      order: { rowIndex: 'ASC' },
    });

    if (failedRows.length === 0) {
      throw new BadRequestException('No error rows found for this import job');
    }

    const csvData = failedRows.map((r) => {
      const raw = JSON.parse(r.rawDataJson || '{}');
      return {
        'Row Number': r.rowIndex,
        'Status': r.status,
        'Error Message': r.errorMessage || 'Unknown failure',
        'Retry Count': r.retryCount,
        ...raw,
      };
    });

    const csvContent = stringify(csvData, { header: true });
    const fileName = `import-errors-${job.id.substring(0, 8)}-${Date.now()}.csv`;

    return { fileName, csvContent };
  }
}
