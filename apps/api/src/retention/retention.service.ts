import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { RetentionPolicy, AuditLog, ErrorLog, StoredFile } from '@hmc/database';

@Injectable()
export class RetentionService {
  constructor(
    @InjectRepository(RetentionPolicy)
    private retentionRepo: Repository<RetentionPolicy>,
    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,
    @InjectRepository(ErrorLog)
    private errorRepo: Repository<ErrorLog>,
    @InjectRepository(StoredFile)
    private fileRepo: Repository<StoredFile>
  ) {}

  async getAllPolicies(): Promise<RetentionPolicy[]> {
    return this.retentionRepo.find({ order: { logType: 'ASC' } });
  }

  async updatePolicy(id: string, dto: { retentionDays: number; isArchiveEnabled: boolean; archiveDestination?: string }): Promise<RetentionPolicy> {
    const policy = await this.retentionRepo.findOne({ where: { id } });
    if (!policy) throw new NotFoundException('Retention policy not found');

    policy.retentionDays = dto.retentionDays;
    policy.isArchiveEnabled = dto.isArchiveEnabled;
    if (dto.archiveDestination !== undefined) policy.archiveDestination = dto.archiveDestination;

    return this.retentionRepo.save(policy);
  }

  async executeRetentionPurge(): Promise<{ purgedCounts: Record<string, number> }> {
    const policies = await this.getAllPolicies();
    const purgedCounts: Record<string, number> = {};

    for (const policy of policies) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

      let count = 0;
      if (policy.logType === 'ERROR_LOGS') {
        const res = await this.errorRepo.delete({ timestamp: LessThan(cutoffDate) });
        count = res.affected || 0;
      } else if (policy.logType === 'SCREENSHOTS') {
        const res = await this.fileRepo.delete({ fileType: 'SCREENSHOT', createdAt: LessThan(cutoffDate) });
        count = res.affected || 0;
      }

      purgedCounts[policy.logType] = count;
      policy.lastPurgedAt = new Date();
      await this.retentionRepo.save(policy);
    }

    return { purgedCounts };
  }
}
