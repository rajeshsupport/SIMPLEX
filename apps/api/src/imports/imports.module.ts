import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportJob, ImportJobRow, Client, StoredFile } from '@hmc/database';
import { ImportsService } from './imports.service.js';
import { SpreadsheetService } from './spreadsheet.service.js';
import { ImportsController } from './imports.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([ImportJob, ImportJobRow, Client, StoredFile])],
  providers: [ImportsService, SpreadsheetService],
  controllers: [ImportsController],
  exports: [ImportsService, SpreadsheetService],
})
export class ImportsModule {}
