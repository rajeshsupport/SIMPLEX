import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog, ErrorLog } from '@hmc/database';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, ErrorLog])],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
