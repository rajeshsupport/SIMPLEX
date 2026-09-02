import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Like } from 'typeorm';
import { stringify } from 'csv-stringify/sync';
import { AuditLog, ErrorLog } from '@hmc/database';
import { AuditResult } from '@hmc/shared';

export interface RecordAuditDto {
  actorUserId?: string | null;
  actorUsername?: string | null;
  clientId?: string | null;
  clientCode?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  result: AuditResult;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  importJobId?: string | null;
  automationRunId?: string | null;
  details?: Record<string, any> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,
    @InjectRepository(ErrorLog)
    private errorRepo: Repository<ErrorLog>
  ) {}

  async logEvent(dto: RecordAuditDto): Promise<void> {
    try {
      // Sanitize details: strip passwords, tokens, auth headers
      const sanitizedDetails = dto.details ? this.sanitizeObject(dto.details) : undefined;

      const log = this.auditRepo.create({
        actorUserId: dto.actorUserId,
        actorUsername: dto.actorUsername,
        clientId: dto.clientId,
        clientCode: dto.clientCode,
        action: dto.action,
        entityType: dto.entityType,
        entityId: dto.entityId,
        result: dto.result,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        correlationId: dto.correlationId,
        importJobId: dto.importJobId,
        automationRunId: dto.automationRunId,
        detailsJson: sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
      });

      await this.auditRepo.save(log);
    } catch (err) {
      this.logger.error('Failed to write audit log', err);
    }
  }

  async getAuditLogs(filter: {
    startDate?: string;
    endDate?: string;
    action?: string;
    actorUsername?: string;
    clientId?: string;
    result?: AuditResult;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    const qb = this.auditRepo.createQueryBuilder('log');

    if (filter.startDate && filter.endDate) {
      qb.andWhere('log.timestamp BETWEEN :startDate AND :endDate', {
        startDate: filter.startDate,
        endDate: filter.endDate,
      });
    }

    if (filter.action) {
      qb.andWhere('log.action LIKE :action', { action: `%${filter.action}%` });
    }

    if (filter.actorUsername) {
      qb.andWhere('log.actorUsername LIKE :user', { user: `%${filter.actorUsername}%` });
    }

    if (filter.clientId) {
      qb.andWhere('log.clientId = :clientId', { clientId: filter.clientId });
    }

    if (filter.result) {
      qb.andWhere('log.result = :result', { result: filter.result });
    }

    qb.orderBy('log.timestamp', 'DESC');
    qb.take(filter.limit || 50);
    qb.skip(filter.offset || 0);

    const [logs, total] = await qb.getManyAndCount();
    return { logs, total };
  }

  async exportAuditCsv(filter: {
    startDate?: string;
    endDate?: string;
    action?: string;
    clientId?: string;
  }): Promise<{ fileName: string; csvContent: string }> {
    const { logs } = await this.getAuditLogs({ ...filter, limit: 5000, offset: 0 });

    const csvData = logs.map((l) => ({
      'Timestamp (UTC)': l.timestamp.toISOString(),
      'Event ID': l.id,
      'User': l.actorUsername || 'System',
      'Action': l.action,
      'Client': l.clientCode || 'N/A',
      'Entity': l.entityType,
      'Entity ID': l.entityId || '',
      'Result': l.result,
      'IP Address': l.ipAddress || '',
      'Correlation ID': l.correlationId || '',
    }));

    const csvContent = stringify(csvData, { header: true });
    const fileName = `audit-export-${Date.now()}.csv`;

    return { fileName, csvContent };
  }

  private sanitizeObject(obj: Record<string, any>): Record<string, any> {
    const sensitiveKeys = ['password', 'token', 'secret', 'authorization', 'cookie', 'accessToken', 'refreshToken'];
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        sanitized[key] = '********';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
