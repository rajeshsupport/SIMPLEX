import { Injectable, BadRequestException } from '@nestjs/common';
import * as xlsx from 'xlsx';
import { parse } from 'csv-parse/sync';
import {
  ImportPreviewSummary,
  ImportJobType,
  ServiceMasterRowSchema,
  UserImportRowSchema,
} from '@hmc/shared';

@Injectable()
export class SpreadsheetService {
  /**
   * Parses uploaded Excel or CSV buffer into raw records
   */
  parseFileBuffer(buffer: Buffer, fileName: string): Array<Record<string, any>> {
    const ext = fileName.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      try {
        const records = parse(buffer.toString('utf-8'), {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
        return records;
      } catch (err: any) {
        throw new BadRequestException(`Failed to parse CSV file: ${err.message}`);
      }
    } else if (ext === 'xlsx' || ext === 'xls') {
      try {
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const records = xlsx.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
        return records;
      } catch (err: any) {
        throw new BadRequestException(`Failed to parse Excel file: ${err.message}`);
      }
    } else {
      throw new BadRequestException('Unsupported file format. Please upload .xlsx or .csv');
    }
  }

  /**
   * Generates validation preview, duplicate detection, and suggested column mappings
   */
  generatePreview(
    rawRecords: Array<Record<string, any>>,
    fileName: string,
    fileSizeBytes: number,
    jobType: ImportJobType,
    customMappings?: Record<string, string>
  ): ImportPreviewSummary {
    if (rawRecords.length === 0) {
      throw new BadRequestException('Uploaded spreadsheet contains no data rows');
    }

    const availableColumns = Object.keys(rawRecords[0] || {});
    const suggestedMappings = customMappings || this.getSuggestedMappings(availableColumns, jobType);

    const schema = jobType === 'SERVICE_MASTER' ? ServiceMasterRowSchema : UserImportRowSchema;

    const seenPrimaryKeys = new Set<string>();
    let validRowsCount = 0;
    let invalidRowsCount = 0;
    let duplicateRowsCount = 0;

    const previewRows: ImportPreviewSummary['previewRows'] = [];

    for (let i = 0; i < rawRecords.length; i++) {
      const raw = rawRecords[i];
      const mapped: Record<string, any> = {};

      for (const [targetField, sourceCol] of Object.entries(suggestedMappings)) {
        if (sourceCol && raw[sourceCol] !== undefined) {
          mapped[targetField] = raw[sourceCol];
        }
      }

      // Check schema validity
      const parseResult = schema.safeParse(mapped);
      const validationErrors: string[] = [];
      if (!parseResult.success) {
        parseResult.error.errors.forEach((e) => {
          validationErrors.push(`${e.path.join('.')}: ${e.message}`);
        });
      }

      // Check duplicates within the file
      const primaryKeyVal = jobType === 'SERVICE_MASTER'
        ? String(mapped.serviceCode || '').trim().toLowerCase()
        : String(mapped.username || '').trim().toLowerCase();

      let isDuplicate = false;
      if (primaryKeyVal) {
        if (seenPrimaryKeys.has(primaryKeyVal)) {
          isDuplicate = true;
          duplicateRowsCount++;
          validationErrors.push(`Duplicate key '${primaryKeyVal}' in file`);
        } else {
          seenPrimaryKeys.add(primaryKeyVal);
        }
      }

      const isValid = parseResult.success && !isDuplicate;
      if (isValid) {
        validRowsCount++;
      } else {
        invalidRowsCount++;
      }

      if (i < 20) {
        // Store first 20 for preview UI
        previewRows.push({
          rowIndex: i + 1,
          rawValues: raw,
          mappedValues: parseResult.success ? parseResult.data : mapped,
          isValid,
          validationErrors,
          isDuplicate,
        });
      }
    }

    return {
      fileName,
      fileSizeBytes,
      totalRows: rawRecords.length,
      validRowsCount,
      invalidRowsCount,
      duplicateRowsCount,
      previewRows,
      availableColumns,
      suggestedMappings,
    };
  }

  private getSuggestedMappings(columns: string[], jobType: ImportJobType): Record<string, string> {
    const mappings: Record<string, string> = {};
    const norm = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

    const targetFields = jobType === 'SERVICE_MASTER'
      ? ['serviceCode', 'serviceName', 'category', 'department', 'unitPrice', 'taxRate', 'billingFrequency', 'isActive', 'notes']
      : ['username', 'email', 'fullName', 'department', 'role', 'initialPassword'];

    for (const target of targetFields) {
      const match = columns.find((col) => norm(col) === norm(target) || norm(col).includes(norm(target)));
      if (match) {
        mappings[target] = match;
      }
    }

    return mappings;
  }
}
