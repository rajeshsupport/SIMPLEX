import * as XLSX from 'xlsx';
import crypto from 'node:crypto';
import {
  RESOURCE_IMPORT_SHEETS,
  RESOURCE_IMPORT_COLUMNS,
  RESOURCE_STEP_COLUMNS,
  CombinedResourceUserRowSchema,
  CombinedResourceUserRowDto,
} from '../schemas/client-resource.schema.js';

import {
  SIMPLEX_EMR_FORMS_CATALOG,
  SIMPLEX_RESOURCE_TYPES_CATALOG,
  SIMPLEX_NATIONALITIES_CATALOG,
  SIMPLEX_ROLES_CATALOG,
  SIMPLEX_SPECIALTIES_CATALOG,
  SIMPLEX_DEPARTMENTS_CATALOG,
  SIMPLEX_SERVICES_CATALOG,
} from './simplex-master-catalog.js';

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
  format?: '1-SHEET' | '6-SHEET' | '10-SHEET';
}

// Step-wise Theme Palette (fill color, text color, label)
export const STEP_STYLE_PALETTES: Record<number, { fill: string; font: string; name: string }> = {
  1: { fill: 'E0F2FE', font: '0369A1', name: 'Step 1: Resource Details' },        // Sky Blue
  2: { fill: 'ECFDF5', font: '047857', name: 'Step 2: Associated User' },         // Mint Green
  3: { fill: 'FEF3C7', font: 'B45309', name: 'Step 3: User–Resource Mapping' },   // Warm Amber
  4: { fill: 'F3E8FF', font: '6B21A8', name: 'Step 4: eClaim Configuration' },     // Lavender
  5: { fill: 'F0FDFA', font: '0F766E', name: 'Step 5: EMR Form Assignment' },     // Teal / Jade
};

// Style helper for standard sheets: marks required headers in red font and light red background
function applyHeaderStyles(ws: XLSX.WorkSheet, headerCount: number, requiredColIndices: number[]) {
  if (!ws) return;
  for (let c = 0; c < headerCount; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[cellRef]) continue;
    const isReq = requiredColIndices.includes(c);
    ws[cellRef].s = {
      font: {
        name: 'Calibri',
        sz: 11,
        bold: true,
        color: { rgb: isReq ? 'B91C1C' : '1E293B' },
      },
      fill: { fgColor: { rgb: isReq ? 'FEE2E2' : 'F1F5F9' } },
      alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
    };
  }
}

// Style helper for 1-Sheet Step-Wise Master Sheet: applies distinctive step fills and highlights required fields in red font
export function applyStepWiseHeaderStyles(ws: XLSX.WorkSheet) {
  if (!ws) return;

  const colsMeta: { wch: number }[] = [];

  RESOURCE_STEP_COLUMNS.forEach((col, c) => {
    colsMeta.push({ wch: col.width || 22 });
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[cellRef]) return;

    const palette = STEP_STYLE_PALETTES[col.step] || { fill: 'F1F5F9', font: '000000', name: '' };
    const isRequired = col.required || col.name.includes('*');

    ws[cellRef].s = {
      font: {
        name: 'Calibri',
        sz: 11,
        bold: true,
        color: { rgb: isRequired ? 'B91C1C' : palette.font },
      },
      fill: {
        fgColor: { rgb: isRequired ? 'FFF1F2' : palette.fill },
      },
      alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
    };
  });

  ws['!cols'] = colsMeta;
}


function buildInstructionsRows() {
  return [
    {
      'Section': '1. WORKFLOW ARCHITECTURE',
      'Field / Requirement': 'Automated 6-Stage Process',
      'Mandatory?': 'Yes',
      'Rules & Guidelines': 'The automation executes 6 sequential stages: 1. Create Resource on /addResourceParentDetails, 2. Create User on /addUsers, 3. Assign User Role on /addUserRole, 4. Map User to Resource with Registration on /ResourceParent, 5. Configure eClaim Provider on /eclaimConfiguration, 6. Assign EMR Forms on /emrPanelSelection and transfer to Target Branch.',
      'Example Value': 'Fully automated via Desktop Agent',
    },
    {
      'Section': '2. HUMAN VS NON-HUMAN',
      'Field / Requirement': 'Is Resource Human*',
      'Mandatory?': 'Yes',
      'Rules & Guidelines': 'Set to "Yes" for doctors, clinical specialists, surgeons, nurses, pharmacists, and lab techs. Set to "No" for equipment, MRI/CT scanners, X-ray rooms, Operation Theatres (OT), ICU beds, inpatient beds, and ambulances.',
      'Example Value': 'Yes (for Doctor) / No (for Equipment)',
    },
    {
      'Section': '2. HUMAN VS NON-HUMAN',
      'Field / Requirement': 'Human Resource Rules',
      'Mandatory?': 'Yes (When Human = Yes)',
      'Rules & Guidelines': 'If Is Resource Human is "Yes", the following fields are STRICTLY MANDATORY: Username, First Name, Last Name, Mobile, Nationality, and Roles. A Simplex user account will be created, given roles, and mapped to the resource with registration display.',
      'Example Value': 'Username: dr_tariq_m, Roles: CLINICIANS',
    },
    {
      'Section': '2. HUMAN VS NON-HUMAN',
      'Field / Requirement': 'Non-Human Resource Rules',
      'Mandatory?': 'Yes (When Human = No)',
      'Rules & Guidelines': 'If Is Resource Human is "No", all user fields (Username, First Name, Middle Name, Last Name, Gender, Mobile, Email, Nationality, Roles) MUST BE LEFT COMPLETELY BLANK. eClaim and EMR Form sections should also be left blank.',
      'Example Value': '[Leave blank for Equipment / Rooms / Beds]',
    },

    {
      'Section': '3. EMR FORMS SELECTION',
      'Field / Requirement': 'Available EMR Forms (15 Live Forms)',
      'Mandatory?': 'Optional (Human Only)',
      'Rules & Guidelines': 'Select exact form names from the "EMR Forms" master sheet: OP - CLINICIANS (Outpatient Doctor SOAP notes & e-prescriptions), OP - NURSING (Triage & vitals), MRD (Medical Records coding), THERAPY (Physiotherapy & rehabilitation), POST OP (PACU recovery), PRE-OPERATIVE (Surgical clearance), IP NURSING (Inpatient ward MAR & care), OT FORMS (Operation Theatre surgical logs), DOCTOR  RECOMMENDATION (Referrals), GCH (General Clinical History), 8.19 EMR FORMS (Clinical suite v8.19), BASIC EMR (Primary care baseline), JJS (Specialty assessment), YESS (Specialty care), PHARMACIST (Pharmacy dispensing). Multiple forms can be comma-separated.',
      'Example Value': 'OP - CLINICIANS, OP - NURSING',
    },
    {
      'Section': '3. EMR FORMS SELECTION',
      'Field / Requirement': 'EMR Default Form',
      'Mandatory?': 'Optional (Human Only)',
      'Rules & Guidelines': 'Specifies which of the assigned forms opens automatically by default when a clinician opens an encounter.',
      'Example Value': 'OP - CLINICIANS',
    },
    {
      'Section': '3. EMR FORMS SELECTION',
      'Field / Requirement': 'EMR Encounter Type',
      'Mandatory?': 'Optional',
      'Rules & Guidelines': 'Select encounter applicability: "ALL" (All encounters), "OP" (Outpatient only), "IP" (Inpatient only), or "OT" (Operation Theatre only). Defaults to "ALL".',
      'Example Value': 'ALL',
    },
    {
      'Section': '3. EMR FORMS SELECTION',
      'Field / Requirement': 'EMR Target Branch & Transfer',
      'Mandatory?': 'Optional',
      'Rules & Guidelines': 'Specify the target branch name to transfer form permissions to. Set Transfer Default to "Yes" to establish it as the default form in that branch.',
      'Example Value': 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC',
    },
    {
      'Section': '4. RESOURCE DETAILS',
      'Field / Requirement': 'Resource Name*',
      'Mandatory?': 'Yes',
      'Rules & Guidelines': 'Full official name of the resource or provider. Max 250 characters.',
      'Example Value': 'Dr. Tariq Al-Mansoor',
    },
    {
      'Section': '4. RESOURCE DETAILS',
      'Field / Requirement': 'Resource Type*',
      'Mandatory?': 'Yes',
      'Rules & Guidelines': 'Select exact resource type from the "Resource Types" master sheet (e.g. "Consultant Physician", "Specialist Doctor", "Staff Nurse", "Equipment", "MRI Scanner Room").',
      'Example Value': 'Consultant Physician',
    },
    {
      'Section': '4. RESOURCE DETAILS',
      'Field / Requirement': 'Specialty*',
      'Mandatory?': 'Yes',
      'Rules & Guidelines': 'Select clinical specialty from the "Specialties" master sheet (e.g. "Cardiology", "Neurology", "Orthopedics", "Radiology").',
      'Example Value': 'Cardiology',
    },
    {
      'Section': '4. RESOURCE DETAILS',
      'Field / Requirement': 'Departments* & Services*',
      'Mandatory?': 'Yes',
      'Rules & Guidelines': 'Enter "ALL" to grant access to all clinical departments and services, or specify exact comma-separated names from the master sheets.',
      'Example Value': 'ALL',
    },
    {
      'Section': '4. RESOURCE DETAILS',
      'Field / Requirement': 'Operating Hours*',
      'Mandatory?': 'Yes',
      'Rules & Guidelines': 'Operating From and Operating To in 24-hour HH:mm format. Standard full day is 00:00 to 23:55.',
      'Example Value': '00:00 to 23:55',
    },
    {
      'Section': '4. RESOURCE DETAILS',
      'Field / Requirement': 'Color Identification Code',
      'Mandatory?': 'Optional',
      'Rules & Guidelines': '6-character hexadecimal color code without "#" symbol (default FFFFFF for White).',
      'Example Value': 'FFFFFF',
    },
    {
      'Section': '5. USER ACCOUNT & ROLES',
      'Field / Requirement': 'Username*',
      'Mandatory?': 'Yes (Human Only)',
      'Rules & Guidelines': 'Unique login username for Simplex ERP. Must contain only alphanumeric characters and underscores.',
      'Example Value': 'dr_tariq_m',
    },
    {
      'Section': '5. USER ACCOUNT & ROLES',
      'Field / Requirement': 'Nationality*',
      'Mandatory?': 'Yes (Human Only)',
      'Rules & Guidelines': 'Select from the 248 official Simplex nationalities in the "Nationalities" sheet. You can use the Label (e.g. "Indian ( IND )"), ISO Code (e.g. "IND"), or Country Name (e.g. "India").',
      'Example Value': 'Saudi ( SAU ) or Indian ( IND )',
    },
    {
      'Section': '5. USER ACCOUNT & ROLES',
      'Field / Requirement': 'Roles* (Multiple Selection Allowed)',
      'Mandatory?': 'Yes (Human Only)',
      'Rules & Guidelines': 'Select from the 75 official Simplex roles in the "Roles" sheet. MULTIPLE ROLES CAN BE ASSIGNED: enter them as comma-separated values (e.g. "CLINICIANS, APPOINTMENT ROLE, BILLING SUPER USER"). Each role will be mapped and granted in Simplex ERP.',
      'Example Value': 'CLINICIANS, APPOINTMENT ROLE',
    },

    {
      'Section': '6. REGISTRATION & ECLAIM',
      'Field / Requirement': 'Is Shown in Registration',
      'Mandatory?': 'Optional (Default Yes)',
      'Rules & Guidelines': 'Set to "Yes" to show doctor in patient registration, appointment booking, and billing search. Set to "No" for non-human or back-office staff.',
      'Example Value': 'Yes',
    },
    {
      'Section': '6. REGISTRATION & ECLAIM',
      'Field / Requirement': 'eClaim Designation / License',
      'Mandatory?': 'Optional (Human Only)',
      'Rules & Guidelines': 'Official healthcare professional license number (MOH/DOH/DHA) and clinical designation (e.g. CONSULTANT, SPECIALIST, GP).',
      'Example Value': 'License: LIC-77889, Designation: CONSULTANT',
    },
  ];
}

function appendMasterSheets(wb: XLSX.WorkBook, options: ResourceTemplateOptions, isIntegrated6Sheet: boolean = false) {
  // 1. Instructions Sheet
  const instructions = buildInstructionsRows();
  const wsInstructions = XLSX.utils.json_to_sheet(instructions);
  applyHeaderStyles(wsInstructions, 5, [0, 1, 2]);
  XLSX.utils.book_append_sheet(wb, wsInstructions, isIntegrated6Sheet ? 'Instructions Master' : 'Instructions');

  // 2. EMR Forms Sheet (15 Live Forms)
  const emrFormsData = SIMPLEX_EMR_FORMS_CATALOG.map((f) => ({
    'Form Name*': f.formName,
    'Form ID': f.formId,
    'Default Group': f.defaultGroup,
    'Encounter Type': f.encounterType,
    'Clinical Description': f.description,
  }));
  const wsEmrForms = XLSX.utils.json_to_sheet(emrFormsData);
  applyHeaderStyles(wsEmrForms, 5, [0]);
  XLSX.utils.book_append_sheet(wb, wsEmrForms, isIntegrated6Sheet ? 'EMR Forms Master' : 'EMR Forms');

  // 3. Resource Types Sheet (Human vs Non-Human Categorized Table)
  const resourceTypesData = SIMPLEX_RESOURCE_TYPES_CATALOG.map((t) => ({
    'Resource Type*': t.resourceType,
    'Category (Human / Non-Human)*': t.category,
    'Is Human (Yes/No)*': t.isHuman,
    'User Account Required?*': t.userAccountRequired,
    'eClaim Applicable?*': t.eclaimApplicable,
    'EMR Applicable?*': t.emrApplicable,
    'Recommended Role': t.recommendedRole,
    'Clinical Description / Guidelines': t.description,
  }));
  const wsResTypes = XLSX.utils.json_to_sheet(resourceTypesData);
  applyHeaderStyles(wsResTypes, 8, [0, 1, 2, 3, 4, 5]);
  XLSX.utils.book_append_sheet(wb, wsResTypes, isIntegrated6Sheet ? 'Resource Types Master' : 'Resource Types');

  // 4. Specialties Sheet
  const validSpecialties = (options.specialties || [])
    .map((s) => (typeof s === 'string' ? s.trim() : (s as any)?.specialtyName || (s as any)?.name || ''))
    .filter((s) => Boolean(s && s.length > 0));

  const specialtiesData = validSpecialties.length
    ? validSpecialties.map((s) => ({
        'Specialty*': s,
        'Clinical Department': 'Clinical Specialty',
      }))
    : SIMPLEX_SPECIALTIES_CATALOG.map((s) => ({
        'Specialty*': s.specialty,
        'Clinical Department': s.department,
      }));
  const wsSpecialties = XLSX.utils.json_to_sheet(specialtiesData);
  applyHeaderStyles(wsSpecialties, 2, [0]);
  XLSX.utils.book_append_sheet(wb, wsSpecialties, isIntegrated6Sheet ? 'Specialties Master' : 'Specialties');

  // 5. Departments Sheet
  const validDepts = (options.departments || [])
    .map((d) => (typeof d === 'string' ? d.trim() : (d as any)?.name || (d as any)?.departmentName || (d as any)?.code || ''))
    .filter((d) => Boolean(d && d.length > 0));

  const deptsData = validDepts.length
    ? validDepts.map((d) => ({
        'Department Name*': d,
        'Department Code': d.substring(0, 6).toUpperCase(),
        'Clinical Scope': 'Department Unit',
      }))
    : SIMPLEX_DEPARTMENTS_CATALOG.map((d) => ({
        'Department Name*': d.department,
        'Department Code': d.code,
        'Clinical Scope': d.description,
      }));
  const wsDepts = XLSX.utils.json_to_sheet(deptsData);
  applyHeaderStyles(wsDepts, 3, [0]);
  XLSX.utils.book_append_sheet(wb, wsDepts, isIntegrated6Sheet ? 'Departments Master' : 'Departments');

  // 6. Services Sheet
  const validServices = (options.services || [])
    .map((srv) => (typeof srv === 'string' ? srv.trim() : (srv as any)?.name || (srv as any)?.serviceName || (srv as any)?.code || ''))
    .filter((srv) => Boolean(srv && srv.length > 0));

  const servicesData = validServices.length
    ? validServices.map((s) => ({
        'Service Name*': s,
        'Service Code': s.substring(0, 10).toUpperCase(),
        'Department': 'Clinical Services',
      }))
    : SIMPLEX_SERVICES_CATALOG.map((s) => ({
        'Service Name*': s.service,
        'Service Code': s.code,
        'Department': s.department,
      }));
  const wsServices = XLSX.utils.json_to_sheet(servicesData);
  applyHeaderStyles(wsServices, 3, [0]);
  XLSX.utils.book_append_sheet(wb, wsServices, isIntegrated6Sheet ? 'Services Master' : 'Services');

  // 7. Branches Sheet
  const validBranches = (options.branches || [])
    .map((b) => (typeof b === 'string' ? b.trim() : (b as any)?.name || (b as any)?.branchName || ''))
    .filter((b) => Boolean(b && b.length > 0));

  const branchesData = (validBranches.length ? validBranches : ['GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC', 'Main Hospital Campus', 'City Center Clinic']).map((b) => ({ 'Branch Name*': b }));
  const wsBranches = XLSX.utils.json_to_sheet(branchesData);
  applyHeaderStyles(wsBranches, 1, [0]);
  XLSX.utils.book_append_sheet(wb, wsBranches, isIntegrated6Sheet ? 'Branches Master' : 'Branches');

  // 8. Nationalities Sheet (all 248 official Simplex nationalities)
  const validNationalities = (options.nationalities || [])
    .map((n) => (typeof n === 'string' ? n.trim() : (n as any)?.label || (n as any)?.name || ''))
    .filter((n) => Boolean(n && n.length > 0));

  const nationalitiesData = validNationalities.length
    ? validNationalities.map((n) => ({
        'Nationality Label*': n,
        'ISO Code (3-Letter)*': n.substring(0, 3).toUpperCase(),
        'Country Name*': n,
      }))
    : SIMPLEX_NATIONALITIES_CATALOG.map((n) => ({
        'Nationality Label*': n.label,
        'ISO Code (3-Letter)*': n.code,
        'Country Name*': n.countryName,
      }));
  const wsNationalities = XLSX.utils.json_to_sheet(nationalitiesData);
  applyHeaderStyles(wsNationalities, 3, [0, 1, 2]);
  XLSX.utils.book_append_sheet(wb, wsNationalities, isIntegrated6Sheet ? 'Nationalities Master' : 'Nationalities');

  // 9. Roles Sheet (all 75 official Simplex roles)
  const validRoles = (options.roles || [])
    .map((r) => (typeof r === 'string' ? r.trim() : (r as any)?.label || (r as any)?.name || ''))
    .filter((r) => Boolean(r && r.length > 0));

  const rolesData = validRoles.length
    ? validRoles.map((r) => ({
        'Role Name / Label*': r,
        'Role Code*': r.substring(0, 10).toUpperCase(),
        'Role Category / Department*': 'Clinical & Admin Role',
      }))
    : SIMPLEX_ROLES_CATALOG.map((r) => ({
        'Role Name / Label*': r.label,
        'Role Code*': r.code,
        'Role Category / Department*': r.category,
      }));
  const wsRoles = XLSX.utils.json_to_sheet(rolesData);
  applyHeaderStyles(wsRoles, 3, [0, 1, 2]);
  XLSX.utils.book_append_sheet(wb, wsRoles, isIntegrated6Sheet ? 'Roles Master' : 'Roles');
}

export function generateResourceImportWorkbook(options: ResourceTemplateOptions): Buffer {
  const wb = XLSX.utils.book_new();

  if (options.format === '6-SHEET') {
    // 1. Sheet 1: Resource Details
    const resourceDetailsData = [
      {
        'Row Reference*': 'ROW-1',
        'Resource Name*': 'Dr. Tariq Al-Mansoor',
        'Is Resource Human*': 'Yes',
        'Resource Type*': options.resourceTypes?.[0] || 'Consultant Physician',
        'Specialty*': options.specialties?.[0] || 'Cardiology',
        'Departments*': 'ALL',
        'Color Identification Code': 'FFFFFF',
        'Services*': 'ALL',
        'Operating From*': '00:00',
        'Operating To*': '23:55',
      },
      {
        'Row Reference*': 'ROW-2',
        'Resource Name*': 'MRI Scanner Room B',
        'Is Resource Human*': 'No',
        'Resource Type*': 'Equipment',
        'Specialty*': 'Radiology',
        'Departments*': 'ALL',
        'Color Identification Code': 'FFFFFF',
        'Services*': 'ALL',
        'Operating From*': '00:00',
        'Operating To*': '23:55',
      },
    ];
    const wsResDetails = XLSX.utils.json_to_sheet(resourceDetailsData);
    applyHeaderStyles(wsResDetails, 10, [0, 1, 2, 3, 4, 5, 7, 8, 9]);
    XLSX.utils.book_append_sheet(wb, wsResDetails, 'Resource Details');

    // 2. Sheet 2: Associated User
    const associatedUserData = [
      {
        'Row Reference*': 'ROW-1',
        'Username*': 'dr_tariq_m',
        'Password (Optional)': 'Welcome@123',
        'First Name*': 'Tariq',
        'Middle Name': '',
        'Last Name*': 'Al-Mansoor',
        'Nick Name': 'Dr. Tariq',
        'Gender': 'Male',
        'Date of Birth (YYYY-MM-DD)': '1985-05-15',
        'Designation': 'Consultant Physician',
        'Email': 'tariq.m@hospital.example.com',
        'Mobile*': '0501234567',
        'Nationality*': 'Saudi ( SAU )',
        'Roles*': options.roles?.[0] || 'CLINICIANS',
        'Profile Role': 'Clinical Specialist',
        'Barcode Number': 'BC-9901',
        'Reports Number in Days': 30,
        'Signature Width': 150,
        'Signature Height': 50,
      },
    ];
    const wsAssocUser = XLSX.utils.json_to_sheet(associatedUserData);
    applyHeaderStyles(wsAssocUser, 19, [0, 1, 3, 5, 11, 12, 13]);
    XLSX.utils.book_append_sheet(wb, wsAssocUser, 'Associated User');

    // 3. Sheet 3: User–Resource Mapping
    const mappingData = [
      {
        'Row Reference*': 'ROW-1',
        'Resource Name / Code*': 'Dr. Tariq Al-Mansoor',
        'Username*': 'dr_tariq_m',
        'Is Shown in Registration*': 'Yes',
        'Branch': options.branches?.[0] || 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC',
      },
    ];
    const wsMapping = XLSX.utils.json_to_sheet(mappingData);
    applyHeaderStyles(wsMapping, 5, [0, 1, 2, 3]);
    XLSX.utils.book_append_sheet(wb, wsMapping, 'User–Resource Mapping');

    // 4. Sheet 4: eClaim Configuration
    const eclaimData = [
      {
        'Row Reference*': 'ROW-1',
        'Resource Name / Code*': 'Dr. Tariq Al-Mansoor',
        'Username*': 'dr_tariq_m',
        'Designation': 'CONSULTANT',
        'Provider Type': 'DOCTOR',
        'Activity Type': 'CLINICAL',
        'License Number': 'LIC-77889',
        'Provider ID': 'PRV-10023',
        'Facility ID': 'FAC-001',
      },
    ];
    const wsEclaim = XLSX.utils.json_to_sheet(eclaimData);
    applyHeaderStyles(wsEclaim, 9, [0, 1, 2]);
    XLSX.utils.book_append_sheet(wb, wsEclaim, 'eClaim Configuration');

    // 5. Sheet 5: EMR Form Assignment
    const emrFormData = [
      {
        'Row Reference*': 'ROW-1',
        'Resource Name / Code*': 'Dr. Tariq Al-Mansoor',
        'Username*': 'dr_tariq_m',
        'EMR Forms* (Comma-Separated)': 'OP - CLINICIANS',
        'Default Form': 'OP - CLINICIANS',
        'Encounter Type': 'ALL',
        'Group': 'CLINICIANS',
        'Transfer Target Branch': options.branches?.[0] || 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC',
        'Transfer Default Form Indicator (S/Yes)': 'Yes',
      },
    ];
    const wsEmrForms = XLSX.utils.json_to_sheet(emrFormData);
    applyHeaderStyles(wsEmrForms, 9, [0, 1, 2, 3]);
    XLSX.utils.book_append_sheet(wb, wsEmrForms, 'EMR Form Assignment');

    // 6. Sheet 6: Template Info
    const clientHash = crypto.createHash('sha256').update(`${options.clientId}:${options.clientCode}:RESOURCE_TEMPLATE_V1`).digest('hex');
    const templateInfoData = [
      { Property: 'Client Code', Value: options.clientCode },
      { Property: 'Client ID', Value: options.clientId },
      { Property: 'Client Name', Value: options.clientName || options.clientCode },
      { Property: 'Template Version', Value: '2.0' },
      { Property: 'Security Binding Hash', Value: clientHash },
      { Property: 'Generated At', Value: new Date().toISOString() },
    ];
    const wsInfo = XLSX.utils.json_to_sheet(templateInfoData);
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Template Info');

    // Append Master Reference Sheets for 6-Sheet format as well
    appendMasterSheets(wb, options, true);

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  // 1-SHEET (Default & Recommended) or 10-SHEET: Unified Step-Wise Data Sheet
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
      // Step 2: User Account & Credentials (Password, Nick Name, Date of Birth, Designation removed)
      'Username* (Human Only)': 'dr_tariq_m',
      'First Name* (Human Only)': 'Tariq',
      'Middle Name': '',
      'Last Name* (Human Only)': 'Al-Mansoor',
      'Gender': 'Male',
      'Mobile* (Human Only)': '0501234567',
      'Email': 'tariq.m@hospital.example.com',
      'Nationality* (Human Only)': 'Saudi ( SAU )',
      'Roles* (Comma-Separated, Human Only)': options.roles?.[0] ? `${options.roles[0]}, APPOINTMENT ROLE` : 'CLINICIANS, APPOINTMENT ROLE',
      // Step 3: Mapping & Registration (Branch removed)
      'Is Shown in Registration*': 'Yes',
      // Step 4: eClaim Configuration (matching live /addUserEclaim screen)
      'Eclaim Link': 'dr_tariq_m',
      'Eclaim Name': 'dr_tariq_m',
      'Eclaim Password': 'EclaimPassword123!',
      'License No': 'LIC-77889',
      'Insurance Company': 'Tawuniya',
      'Branch Name': 'staging',
      'Old Eclaim Name': '',
      'Old Eclaim Password': '',
      'Old License No': '',
      'Actual License No': 'LIC-77889',
      // Step 5: EMR Form Assignment & Transfer (EMR Group & EMR Target Branch removed)
      'EMR Forms* (Comma-Separated)': 'OP - CLINICIANS',
      'EMR Default Form': 'OP - CLINICIANS',
      'EMR Encounter Type': 'ALL',
      'EMR Transfer Default (Yes/No)': 'Yes',
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
      // Step 2: Blank for non-human
      'Username* (Human Only)': '',
      'First Name* (Human Only)': '',
      'Middle Name': '',
      'Last Name* (Human Only)': '',
      'Gender': '',
      'Mobile* (Human Only)': '',
      'Email': '',
      'Nationality* (Human Only)': '',
      'Roles* (Comma-Separated, Human Only)': '',
      // Step 3: Mapping
      'Is Shown in Registration*': 'No',
      // Step 4: eClaim (Blank for non-human)
      'Eclaim Link': '',
      'Eclaim Name': '',
      'Eclaim Password': '',
      'License No': '',
      'Insurance Company': '',
      'Branch Name': '',
      'Old Eclaim Name': '',
      'Old Eclaim Password': '',
      'Old License No': '',
      'Actual License No': '',
      // Step 5: EMR (Blank for non-human)
      'EMR Forms* (Comma-Separated)': '',
      'EMR Default Form': '',
      'EMR Encounter Type': '',
      'EMR Transfer Default (Yes/No)': '',
    },
  ];



  const wsImport = XLSX.utils.json_to_sheet(initialRowData, { header: [...RESOURCE_IMPORT_COLUMNS] });
  applyStepWiseHeaderStyles(wsImport);
  XLSX.utils.book_append_sheet(wb, wsImport, 'Resource Import');

  // Append all master sheets (Instructions, EMR Forms, Resource Types, Specialties, Departments, Services, Branches, Nationalities, Roles)
  appendMasterSheets(wb, options, false);

  // Template Info Sheet
  const clientHash = crypto.createHash('sha256').update(`${options.clientId}:${options.clientCode}:RESOURCE_TEMPLATE_V2`).digest('hex');
  const templateInfoData = [
    { Property: 'Client Code', Value: options.clientCode },
    { Property: 'Client ID', Value: options.clientId },
    { Property: 'Client Name', Value: options.clientName || options.clientCode },
    { Property: 'Template Version', Value: '2.0 (Step-Wise 1-Sheet)' },
    { Property: 'Format', Value: options.format || '1-SHEET' },
    { Property: 'Security Binding Hash', Value: clientHash },
    { Property: 'Generated At', Value: new Date().toISOString() },
  ];
  const wsInfo = XLSX.utils.json_to_sheet(templateInfoData);
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Template Info');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
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

  // 1. Verify primary sheet exists (Resource Details or Resource Import)
  const isMultiSheet = !!wb.Sheets['Resource Details'];
  const importSheet = wb.Sheets['Resource Details'] || wb.Sheets[RESOURCE_IMPORT_SHEETS[0]] || wb.Sheets['Resource Import'] || wb.Sheets[wb.SheetNames[0]];
  if (!importSheet) {
    return {
      isValid: false,
      clientMismatch: false,
      totalRows: 0,
      validRows: [],
      invalidRows: [],
      error: 'RESOURCE_IMPORT_SHEET_MISSING: The workbook is missing the primary "Resource Details" or "Resource Import" sheet.',
    };
  }

  // 2. Verify Template Info Client Binding if present
  const infoSheet = wb.Sheets['Template Info'] || wb.Sheets[RESOURCE_IMPORT_SHEETS[RESOURCE_IMPORT_SHEETS.length - 1]] || wb.Sheets[RESOURCE_IMPORT_SHEETS[9]];
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

  // If 6-sheet workbook, build lookup maps by Row Reference / S.No
  const userMap = new Map<string, any>();
  const mappingMap = new Map<string, any>();
  const emrMap = new Map<string, any>();
  const eclaimMap = new Map<string, any>();

  if (isMultiSheet) {
    if (wb.Sheets['Associated User']) {
      const uRows: any[] = XLSX.utils.sheet_to_json(wb.Sheets['Associated User']);
      uRows.forEach((r) => {
        const key = String(r['Row Reference*'] || r['Row Reference'] || r['S.No'] || '').trim();
        if (key) userMap.set(key, r);
      });
    }
    if (wb.Sheets['User–Resource Mapping'] || wb.Sheets['User-Resource Mapping']) {
      const mSheet = wb.Sheets['User–Resource Mapping'] || wb.Sheets['User-Resource Mapping'];
      const mRows: any[] = XLSX.utils.sheet_to_json(mSheet);
      mRows.forEach((r) => {
        const key = String(r['Row Reference*'] || r['Row Reference'] || r['S.No'] || '').trim();
        if (key) mappingMap.set(key, r);
      });
    }
    if (wb.Sheets['eClaim Configuration']) {
      const ecRows: any[] = XLSX.utils.sheet_to_json(wb.Sheets['eClaim Configuration']);
      ecRows.forEach((r) => {
        const key = String(r['Row Reference*'] || r['Row Reference'] || r['S.No'] || '').trim();
        if (key) eclaimMap.set(key, r);
      });
    }
    if (wb.Sheets['EMR Form Assignment']) {
      const emrRows: any[] = XLSX.utils.sheet_to_json(wb.Sheets['EMR Form Assignment']);
      emrRows.forEach((r) => {
        const key = String(r['Row Reference*'] || r['Row Reference'] || r['S.No'] || '').trim();
        if (key) emrMap.set(key, r);
      });
    }
  }

  // Helper to safely extract values from rows matching various header styles
  // (e.g. "[Step 1] Resource Name*", "Resource Name*", "Resource Name", "resourcename")
  const normalizeKey = (key: string): string => {
    return key
      .replace(/^\[step\s*\d+\]/i, '')
      .replace(/\*/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  };

  const getField = (row: any, ...fieldAliases: string[]): string => {
    if (!row || typeof row !== 'object') return '';
    // 1. Direct match
    for (const alias of fieldAliases) {
      if (row[alias] !== undefined && row[alias] !== null && String(row[alias]).trim() !== '') {
        return String(row[alias]).trim();
      }
    }
    // 2. Normalized fuzzy match across row keys
    const rowKeys = Object.keys(row);
    for (const alias of fieldAliases) {
      const targetNorm = normalizeKey(alias);
      const foundKey = rowKeys.find((k) => normalizeKey(k) === targetNorm);
      if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && String(row[foundKey]).trim() !== '') {
        return String(row[foundKey]).trim();
      }
    }
    return '';
  };

  rawRows.forEach((rawRow, index) => {
    const rowNum = index + 2; // 1-based index including header
    const rowKey = getField(rawRow, 'Row Reference*', 'Row Reference', 'S.No');

    // Merge normalized sheets if multi-sheet workbook
    const userRow = isMultiSheet ? userMap.get(rowKey) || {} : {};
    const mapRow = isMultiSheet ? mappingMap.get(rowKey) || {} : {};
    const eclaimRow = isMultiSheet ? eclaimMap.get(rowKey) || {} : {};
    const emrRow = isMultiSheet ? emrMap.get(rowKey) || {} : {};

    const candidate = {
      // Step 1: Resource Details
      sNo: rawRow['S.No'] ? Number(rawRow['S.No']) : index + 1,
      resourceName: getField(rawRow, 'Resource Name*', 'Resource Name', 'Resource Name / Code*'),
      isResourceHuman: getField(rawRow, 'Is Resource Human*', 'Is Resource Human') || 'Yes',
      resourceType: getField(rawRow, 'Resource Type*', 'Resource Type'),
      specialty: getField(rawRow, 'Specialty*', 'Specialty'),
      departments: getField(rawRow, 'Departments*', 'Departments') || 'ALL',
      colorIdentificationCode: getField(rawRow, 'Color Identification Code', 'Color Code') || 'FFFFFF',
      services: getField(rawRow, 'Services*', 'Services') || 'ALL',
      operatingFrom: getField(rawRow, 'Operating From*', 'Operating From') || '00:00',
      operatingTo: getField(rawRow, 'Operating To*', 'Operating To') || '23:55',

      // Step 2: User Account & Credentials
      username: getField(userRow, 'Username*', 'Username') ||
        getField(rawRow, 'Username* (Human Only)', 'Username*', 'Username') || undefined,
      password: getField(userRow, 'Password (Optional)', 'Password') ||
        getField(rawRow, 'Password (Optional)', 'Password') || undefined,
      firstName: getField(userRow, 'First Name*', 'First Name') ||
        getField(rawRow, 'First Name* (Human Only)', 'First Name*', 'First Name') || undefined,
      middleName: getField(userRow, 'Middle Name') ||
        getField(rawRow, 'Middle Name') || undefined,
      lastName: getField(userRow, 'Last Name*', 'Last Name') ||
        getField(rawRow, 'Last Name* (Human Only)', 'Last Name*', 'Last Name') || undefined,
      nickName: getField(userRow, 'Nick Name') ||
        getField(rawRow, 'Nick Name') || undefined,
      gender: getField(userRow, 'Gender') ||
        getField(rawRow, 'Gender') || undefined,
      dob: getField(userRow, 'Date of Birth (YYYY-MM-DD)', 'Date of Birth') ||
        getField(rawRow, 'Date of Birth (YYYY-MM-DD)', 'Date of Birth') || undefined,
      designation: getField(userRow, 'Designation') ||
        getField(rawRow, 'Designation') || undefined,
      mobile: getField(userRow, 'Mobile*', 'Mobile') ||
        getField(rawRow, 'Mobile* (Human Only)', 'Mobile*', 'Mobile') || undefined,
      email: getField(userRow, 'Email') ||
        getField(rawRow, 'Email') || undefined,
      nationality: getField(userRow, 'Nationality*', 'Nationality') ||
        getField(rawRow, 'Nationality* (Human Only)', 'Nationality*', 'Nationality') || undefined,
      roles: getField(userRow, 'Roles*', 'Roles', 'Roles* (Comma-Separated)') ||
        getField(rawRow, 'Roles* (Comma-Separated, Human Only)', 'Roles* (Human Only)', 'Roles* (Comma-Separated)', 'Roles*', 'Roles') || undefined,

      // Step 3: Mapping & Registration
      branch: getField(mapRow, 'Branch') ||
        getField(rawRow, 'Branch') || undefined,
      isShownInRegistration: getField(mapRow, 'Is Shown in Registration*', 'Is Shown in Registration') ||
        getField(rawRow, 'Is Shown in Registration*', 'Is Shown in Registration') || 'Yes',

      // Step 4: eClaim Configuration (10 cols matching live /addUserEclaim screen)
      eclaimLink: getField(eclaimRow, 'Eclaim Link', 'eClaim Link', 'Eclaim Link *') ||
        getField(rawRow, 'Eclaim Link', 'eClaim Link', 'Eclaim Link *') || undefined,
      eclaimName: getField(eclaimRow, 'Eclaim Name', 'eClaim Name', 'Eclaim Name *') ||
        getField(rawRow, 'Eclaim Name', 'eClaim Name', 'Eclaim Name *') || undefined,
      eclaimPassword: getField(eclaimRow, 'Eclaim Password', 'eClaim Password', 'Eclaim Password *') ||
        getField(rawRow, 'Eclaim Password', 'eClaim Password', 'Eclaim Password *') || undefined,
      eclaimLicenseNumber: getField(eclaimRow, 'License No', 'License Number', 'eClaim License Number') ||
        getField(rawRow, 'License No', 'License Number', 'eClaim License Number') || undefined,
      eclaimInsuranceCompany: getField(eclaimRow, 'Insurance Company', 'eClaim Insurance Company') ||
        getField(rawRow, 'Insurance Company', 'eClaim Insurance Company') || undefined,
      eclaimBranchName: getField(eclaimRow, 'Branch Name', 'Branch', 'eClaim Branch Name') ||
        getField(rawRow, 'Branch Name', 'Branch', 'eClaim Branch Name') || undefined,
      oldEclaimName: getField(eclaimRow, 'Old Eclaim Name', 'Old eClaim Name') ||
        getField(rawRow, 'Old Eclaim Name', 'Old eClaim Name') || undefined,
      oldEclaimPassword: getField(eclaimRow, 'Old Eclaim Password', 'Old eClaim Password') ||
        getField(rawRow, 'Old Eclaim Password', 'Old eClaim Password') || undefined,
      oldLicenseNo: getField(eclaimRow, 'Old License No', 'Old License Number') ||
        getField(rawRow, 'Old License No', 'Old License Number') || undefined,
      actualLicenseNo: getField(eclaimRow, 'Actual License No', 'Actual Medical License No') ||
        getField(rawRow, 'Actual License No', 'Actual Medical License No') || undefined,
      eclaimDesignation: getField(eclaimRow, 'Designation') ||
        getField(rawRow, 'eClaim Designation') || undefined,
      eclaimProviderType: getField(eclaimRow, 'Provider Type') ||
        getField(rawRow, 'eClaim Provider Type') || undefined,
      eclaimActivityType: getField(eclaimRow, 'Activity Type') ||
        getField(rawRow, 'eClaim Activity Type') || undefined,
      eclaimProviderId: getField(eclaimRow, 'Provider ID') ||
        getField(rawRow, 'eClaim Provider ID') || undefined,
      eclaimFacilityId: getField(eclaimRow, 'Facility ID') ||
        getField(rawRow, 'eClaim Facility ID') || undefined,
      eclaimSpecialtyCode: getField(eclaimRow, 'Specialty Code') ||
        getField(rawRow, 'eClaim Specialty Code') || undefined,

      // Step 5: EMR Form Assignment & Transfer
      emrForms: getField(emrRow, 'EMR Forms* (Comma-Separated)', 'EMR Forms*', 'EMR Forms') ||
        getField(rawRow, 'EMR Forms* (Comma-Separated)', 'EMR Forms (Comma-Separated)', 'EMR Forms*', 'EMR Forms') || undefined,
      emrDefaultForm: getField(emrRow, 'Default Form', 'EMR Default Form') ||
        getField(rawRow, 'EMR Default Form', 'Default Form') || undefined,
      emrEncounterType: getField(emrRow, 'Encounter Type', 'EMR Encounter Type') ||
        getField(rawRow, 'EMR Encounter Type', 'Encounter Type') || 'ALL',
      emrGroup: getField(emrRow, 'Group', 'EMR Group') ||
        getField(rawRow, 'EMR Group', 'Group') || undefined,
      emrTransferTargetBranch: getField(emrRow, 'Transfer Target Branch', 'EMR Target Branch') ||
        getField(rawRow, 'EMR Target Branch', 'Transfer Target Branch') || undefined,
      emrTransferDefaultFormIndicator: getField(emrRow, 'Transfer Default Form Indicator (S/Yes)', 'EMR Transfer Default (Yes/No)') ||
        getField(rawRow, 'EMR Transfer Default (Yes/No)', 'Transfer Default Form Indicator (S/Yes)') || 'Yes',
    };


    const parsed = CombinedResourceUserRowSchema.safeParse(candidate);
    if (parsed.success) {
      validRows.push({
        rowNumber: rowNum,
        data: parsed.data,
        raw: { ...rawRow, ...userRow, ...mapRow, ...eclaimRow, ...emrRow },
        isValid: true,
        errors: [],
      });
    } else {
      const errorMessages = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      invalidRows.push({
        rowNumber: rowNum,
        data: candidate as any,
        raw: { ...rawRow, ...userRow, ...mapRow, ...eclaimRow, ...emrRow },
        isValid: false,
        errors: errorMessages,
      });
    }
  });

  return {
    isValid: invalidRows.length === 0 && validRows.length > 0,
    clientMismatch: false,
    totalRows: rawRows.length,
    validRows,
    invalidRows,
  };
}
