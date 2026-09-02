import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RetentionPolicy, AuditLog, ErrorLog, StoredFile } from '@hmc/database';
import { RetentionService } from './retention.service.js';
import { RetentionController } from './retention.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([RetentionPolicy, AuditLog, ErrorLog, StoredFile])],
  providers: [RetentionService],
  controllers: [RetentionController],
  exports: [RetentionService],
})
export class RetentionModule {}
