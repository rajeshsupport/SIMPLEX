import * as XLSX from 'xlsx';
import crypto from 'node:crypto';
import {
  RESOURCE_IMPORT_SHEETS,
  RESOURCE_IMPORT_COLUMNS,
  CombinedResourceUserRowSchema,
  CombinedResourceUserRowDto,
} from '../schemas/client-resource.schema.js';

export interface ResourceTemplateOptions {
  clientId: string;
  clientCode: string;
  clientName?: string;
  resourceTypes?: string[];
  specialties?: string[];
  departments?: string[];
  services?: string[];
  branches?: string[];
  nationalities?: string[];
  roles?: string[];
}

export function generateResourceImportWorkbook(options: ResourceTemplateOptions): Buffer {
  const wb = XLSX.utils.book_new();

  // 1. Sheet 1: Resource Import
  const initialRowData = [
    {
      'S.No': 1,
      'Resource Name*': 'Dr. Tariq Al-Mansoor',
      'Is Resource Human*': 'Yes',
      'Resource Type*': options.resourceTypes?.[0] || 'Consultant Physician',
      'Specialty*': options.specialties?.[0] || 'Cardiology',
      'Departments*': 'ALL',
      'Color Identification Code': 'FFFFFF',
      'Services*': 'ALL',
      'Operating From*': '00:00',
      'Operating To*': '23:55',
      'Username* (Human Only)': 'dr_tariq_m',
      'First Name* (Human Only)': 'Tariq',
      'Middle Name': '',
      'Last Name* (Human Only)': 'Al-Mansoor',
      'Mobile* (Human Only)': '0501234567',
      'Email': 'tariq.m@hospital.example.com',
      'Nationality* (Human Only)': 'Saudi Arabia',
      'Roles* (Human Only)': options.roles?.[0] || 'PHYSICIAN',
      'Is Shown in Registration': 'Yes',
    },
    {
      'S.No': 2,
      'Resource Name*': 'MRI Scanner Room B',
      'Is Resource Human*': 'No',
      'Resource Type*': 'Equipment',
      'Specialty*': 'Radiology',
      'Departments*': 'ALL',
      'Color Identification Code': 'FFFFFF',
      'Services*': 'ALL',
      'Operating From*': '00:00',
      'Operating To*': '23:55',
      'Username* (Human Only)': '',
      'First Name* (Human Only)': '',
      'Middle Name': '',
      'Last Name* (Human Only)': '',
      'Mobile* (Human Only)': '',
      'Email': '',
      'Nationality* (Human Only)': '',
      'Roles* (Human Only)': '',
      'Is Shown in Registration': 'No',
    },
  ];

  const wsImport = XLSX.utils.json_to_sheet(initialRowData, { header: [...RESOURCE_IMPORT_COLUMNS] });
  XLSX.utils.book_append_sheet(wb, wsImport, RESOURCE_IMPORT_SHEETS[0]);

  // 2. Sheet 2: Instructions
  const instructions = [
    { Section: 'General Instructions', Details: 'Fill in the Resource Import sheet. All fields marked with * are strictly mandatory.' },
    { Section: 'Is Resource Human', Details: 'Select "Yes" for doctors, clinical specialists, nurses, and staff. Select "No" for equipment, rooms, and devices.' },
    { Section: 'Human vs Non-Human', Details: 'If Human is "Yes", Username, First Name, Last Name, Mobile, and Roles are mandatory. If Human is "No", user fields must be left blank.' },
    { Section: 'Departments & Services', Details: 'Use "ALL" to assign all available clinical departments/services, or specify exact comma-separated codes.' },
    { Section: 'Timings', Details: 'Format operating hours in 24-hour HH:mm format (e.g. 00:00 to 23:55).' },
    { Section: 'Color Code', Details: 'Enter 6-character hex code without # (e.g. FFFFFF for White).' },
  ];
  const wsInstructions = XLSX.utils.json_to_sheet(instructions);
  XLSX.utils.book_append_sheet(wb, wsInstructions, RESOURCE_IMPORT_SHEETS[1]);

  // 3. Sheet 3: Resource Types
  const typesData = (options.resourceTypes || ['Consultant Physician', 'Specialist', 'Resident Doctor', 'Staff Nurse', 'Technician', 'Room / Facility', 'Equipment']).map((t) => ({ 'Resource Type': t }));
  const wsTypes = XLSX.utils.json_to_sheet(typesData);
  XLSX.utils.book_append_sheet(wb, wsTypes, RESOURCE_IMPORT_SHEETS[2]);

  // 4. Sheet 4: Specialties
  const specialtiesData = (options.specialties || ['Cardiology', 'Neurology', 'Orthopedics', 'Pediatrics', 'Radiology', 'General Surgery', 'Internal Medicine', 'Emergency Medicine']).map((s) => ({ 'Specialty': s }));
  const wsSpecialties = XLSX.utils.json_to_sheet(specialtiesData);
  XLSX.utils.book_append_sheet(wb, wsSpecialties, RESOURCE_IMPORT_SHEETS[3]);

  // 5. Sheet 5: Departments
  const deptsData = (options.departments || ['Cardiology Dept', 'Neurology Dept', 'Emergency Dept', 'Outpatient Clinics', 'Inpatient Ward', 'Operation Theatres', 'Radiology Suite']).map((d) => ({ 'Department': d }));
  const wsDepts = XLSX.utils.json_to_sheet(deptsData);
  XLSX.utils.book_append_sheet(wb, wsDepts, RESOURCE_IMPORT_SHEETS[4]);

  // 6. Sheet 6: Services
  const servicesData = (options.services || ['Cardiology Consultation', 'Echocardiogram', 'MRI Scan', 'CT Scan', 'Routine Health Check', 'General Consultation']).map((s) => ({ 'Service': s }));
  const wsServices = XLSX.utils.json_to_sheet(servicesData);
  XLSX.utils.book_append_sheet(wb, wsServices, RESOURCE_IMPORT_SHEETS[5]);

  // 7. Sheet 7: Branches
  const branchesData = (options.branches || ['Main Hospital Campus', 'City Center Medical Clinic', 'West Branch']).map((b) => ({ 'Branch': b }));
  const wsBranches = XLSX.utils.json_to_sheet(branchesData);
  XLSX.utils.book_append_sheet(wb, wsBranches, RESOURCE_IMPORT_SHEETS[6]);

  // 8. Sheet 8: Nationalities
  const nationalitiesData = (options.nationalities || ['Saudi Arabia', 'United Arab Emirates', 'Kuwait', 'Bahrain', 'Qatar', 'Oman', 'Egypt', 'Jordan', 'India', 'Pakistan', 'Philippines', 'United Kingdom', 'United States']).map((n) => ({ 'Nationality': n }));
  const wsNationalities = XLSX.utils.json_to_sheet(nationalitiesData);
  XLSX.utils.book_append_sheet(wb, wsNationalities, RESOURCE_IMPORT_SHEETS[7]);

  // 9. Sheet 9: Roles
  const rolesData = (options.roles || ['PHYSICIAN', 'SPECIALIST', 'ACCUMED', 'FRONT DESK', 'NURSE', 'REPORTS']).map((r) => ({ 'Role': r }));
  const wsRoles = XLSX.utils.json_to_sheet(rolesData);
  XLSX.utils.book_append_sheet(wb, wsRoles, RESOURCE_IMPORT_SHEETS[8]);

  // 10. Sheet 10: Template Info (Client-bound security hash)
  const clientHash = crypto.createHash('sha256').update(`${options.clientId}:${options.clientCode}:RESOURCE_TEMPLATE_V1`).digest('hex');
  const templateInfoData = [
    { Property: 'Client Code', Value: options.clientCode },
    { Property: 'Client ID', Value: options.clientId },
    { Property: 'Client Name', Value: options.clientName || options.clientCode },
    { Property: 'Template Version', Value: '1.0' },
    { Property: 'Security Binding Hash', Value: clientHash },
    { Property: 'Generated At', Value: new Date().toISOString() },
  ];
  const wsInfo = XLSX.utils.json_to_sheet(templateInfoData);
  XLSX.utils.book_append_sheet(wb, wsInfo, RESOURCE_IMPORT_SHEETS[9]);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export interface ParsedResourceImportRow {
  rowNumber: number;
  data: CombinedResourceUserRowDto;
  raw: any;
  isValid: boolean;
  errors: string[];
}

export function parseAndValidateResourceWorkbook(
  buffer: Buffer,
  expectedClientId: string
): {
  isValid: boolean;
  clientMismatch: boolean;
  totalRows: number;
  validRows: ParsedResourceImportRow[];
  invalidRows: ParsedResourceImportRow[];
  error?: string;
} {
  const wb = XLSX.read(buffer, { type: 'buffer' });

  // 1. Verify Sheet 1 exists
  const importSheet = wb.Sheets[RESOURCE_IMPORT_SHEETS[0]] || wb.Sheets['Resource Import'] || wb.Sheets[wb.SheetNames[0]];
  if (!importSheet) {
    return {
      isValid: false,
      clientMismatch: false,
      totalRows: 0,
      validRows: [],
      invalidRows: [],
      error: 'RESOURCE_IMPORT_SHEET_MISSING: The workbook is missing the primary "Resource Import" sheet.',
    };
  }

  // 2. Verify Template Info Client Binding if present
  const infoSheet = wb.Sheets[RESOURCE_IMPORT_SHEETS[9]] || wb.Sheets['Template Info'];
  if (infoSheet) {
    const infoRows: any[] = XLSX.utils.sheet_to_json(infoSheet);
    const clientIdRow = infoRows.find((r) => r.Property === 'Client ID');
    if (clientIdRow && clientIdRow.Value && clientIdRow.Value !== expectedClientId) {
      return {
        isValid: false,
        clientMismatch: true,
        totalRows: 0,
        validRows: [],
        invalidRows: [],
        error: `CLIENT_MISMATCH: Template was generated for client '${clientIdRow.Value}' but uploaded to client '${expectedClientId}'.`,
      };
    }
  }

  const rawRows: any[] = XLSX.utils.sheet_to_json(importSheet);
  const validRows: ParsedResourceImportRow[] = [];
  const invalidRows: ParsedResourceImportRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const rowNum = i + 2; // 1-based, +1 for header

    const mapped = {
      sNo: raw['S.No'] || i + 1,
      resourceName: raw['Resource Name*'] || raw['Resource Name'] || raw['resourceName'] || '',
      isResourceHuman: raw['Is Resource Human*'] || raw['Is Resource Human'] || raw['isResourceHuman'] || 'Yes',
      resourceType: raw['Resource Type*'] || raw['Resource Type'] || raw['resourceType'] || '',
      specialty: raw['Specialty*'] || raw['Specialty'] || raw['specialty'] || '',
      departments: raw['Departments*'] || raw['Departments'] || raw['departments'] || 'ALL',
      colorIdentificationCode: raw['Color Identification Code'] || raw['colorIdentificationCode'] || 'FFFFFF',
      services: raw['Services*'] || raw['Services'] || raw['services'] || 'ALL',
      operatingFrom: raw['Operating From*'] || raw['Operating From'] || raw['operatingFrom'] || '00:00',
      operatingTo: raw['Operating To*'] || raw['Operating To'] || raw['operatingTo'] || '23:55',
      username: raw['Username* (Human Only)'] || raw['Username*'] || raw['Username'] || raw['User Name'] || raw['username'] || undefined,
      firstName: raw['First Name* (Human Only)'] || raw['First Name*'] || raw['First Name'] || raw['firstName'] || undefined,
      middleName: raw['Middle Name'] || raw['middleName'] || undefined,
      lastName: raw['Last Name* (Human Only)'] || raw['Last Name*'] || raw['Last Name'] || raw['lastName'] || undefined,
      mobile: raw['Mobile* (Human Only)'] || raw['Mobile*'] || raw['Mobile'] || raw['Mobile No'] || raw['mobile'] || undefined,
      email: raw['Email'] || raw['email'] || undefined,
      nationality: raw['Nationality* (Human Only)'] || raw['Nationality*'] || raw['Nationality'] || raw['nationality'] || undefined,
      roles: raw['Roles* (Human Only)'] || raw['Roles*'] || raw['Roles'] || raw['roles'] || undefined,
      isShownInRegistration: raw['Is Shown in Registration'] || raw['isShownInRegistration'] || 'Yes',
    };

    const parsed = CombinedResourceUserRowSchema.safeParse(mapped);

    if (parsed.success) {
      validRows.push({
        rowNumber: rowNum,
        data: parsed.data,
        raw,
        isValid: true,
        errors: [],
      });
    } else {
      const errorMessages = parsed.error.issues.map((iss) => iss.message);
      invalidRows.push({
        rowNumber: rowNum,
        data: mapped as any,
        raw,
        isValid: false,
        errors: errorMessages,
      });
    }
  }

  return {
    isValid: invalidRows.length === 0 && validRows.length > 0,
    clientMismatch: false,
    totalRows: rawRows.length,
    validRows,
    invalidRows,
  };
}
