/**
 * Simplex Live Master Catalog
 * Authoritative constants and dropdown options extracted directly from Simplex Health ERP.
 * Contains:
 * - 15 Live EMR Forms (Form Name, ID, Group, Encounter Type, Description)
 * - 24 Resource Types (Human vs Non-Human classification, rules & guidelines)
 * - 248 Live Nationalities (Label, 3-letter ISO Code, Country Name)
 * - 75 Live User Roles (Role Name, Role Code, Category)
 * - 28 Clinical Specialties (Specialty, Department, eClaim Code)
 * - Clinical Departments & Services Catalog
 */

export interface SimplexEmrFormCatalogItem {
  formName: string;
  formId: number;
  defaultGroup: string;
  encounterType: 'ALL' | 'OP' | 'IP' | 'OT';
  description: string;
}

export interface SimplexResourceTypeCatalogItem {
  resourceType: string;
  category: 'Human' | 'Non-Human';
  isHuman: 'Yes' | 'No';
  userAccountRequired: string;
  eclaimApplicable: 'Yes' | 'No';
  emrApplicable: 'Yes' | 'No';
  recommendedRole: string;
  description: string;
}

export interface SimplexNationalityCatalogItem {
  label: string;
  code: string;
  countryName: string;
}

export interface SimplexRoleCatalogItem {
  label: string;
  code: string;
  category: string;
}

export interface SimplexSpecialtyCatalogItem {
  specialty: string;
  department: string;
  eclaimCode: string;
}

export const SIMPLEX_EMR_FORMS_CATALOG: SimplexEmrFormCatalogItem[] = [
  {
    "formName": "OP - CLINICIANS",
    "formId": 1,
    "defaultGroup": "CLINICIANS",
    "encounterType": "ALL",
    "description": "Outpatient Clinician consultation, SOAP notes, diagnosis, ICD-10 coding & e-prescribing"
  },
  {
    "formName": "OP - NURSING",
    "formId": 13,
    "defaultGroup": "NURSING",
    "encounterType": "ALL",
    "description": "Outpatient Nursing triage, vitals recording, nursing assessment & care notes"
  },
  {
    "formName": "MRD",
    "formId": 58,
    "defaultGroup": "MRD",
    "encounterType": "ALL",
    "description": "Medical Records Department documentation, chart completion & medical coding"
  },
  {
    "formName": "THERAPY",
    "formId": 61,
    "defaultGroup": "THERAPY",
    "encounterType": "ALL",
    "description": "Physiotherapy, Rehabilitation & Allied Health treatment sessions and evaluations"
  },
  {
    "formName": "POST OP",
    "formId": 64,
    "defaultGroup": "SURGICAL",
    "encounterType": "IP",
    "description": "Post-Operative recovery notes, PACU vitals monitoring & surgical discharge checklist"
  },
  {
    "formName": "PRE-OPERATIVE",
    "formId": 97,
    "defaultGroup": "SURGICAL",
    "encounterType": "IP",
    "description": "Pre-Operative surgical assessment, anesthesia clearance & surgical safety checklist"
  },
  {
    "formName": "IP NURSING",
    "formId": 147,
    "defaultGroup": "NURSING",
    "encounterType": "IP",
    "description": "Inpatient Ward Nursing monitoring, medication administration records (MAR) & shift handover"
  },
  {
    "formName": "OT FORMS",
    "formId": 162,
    "defaultGroup": "SURGICAL",
    "encounterType": "OT",
    "description": "Operation Theatre intraoperative surgical log, anesthesia records & scrub counts"
  },
  {
    "formName": "DOCTOR  RECOMMENDATION",
    "formId": 192,
    "defaultGroup": "CLINICIANS",
    "encounterType": "ALL",
    "description": "Clinical referrals, inter-departmental second opinions & specialist recommendations"
  },
  {
    "formName": "GCH",
    "formId": 196,
    "defaultGroup": "CLINICAL",
    "encounterType": "ALL",
    "description": "General Clinical History & comprehensive physical examination form"
  },
  {
    "formName": "8.19 EMR FORMS",
    "formId": 199,
    "defaultGroup": "CLINICAL",
    "encounterType": "ALL",
    "description": "Standard EMR clinical assessment suite v8.19"
  },
  {
    "formName": "BASIC EMR",
    "formId": 200,
    "defaultGroup": "GENERAL",
    "encounterType": "ALL",
    "description": "Baseline primary care encounters, general practice consultation & quick progress notes"
  },
  {
    "formName": "JJS",
    "formId": 201,
    "defaultGroup": "SPECIALTY",
    "encounterType": "ALL",
    "description": "Specialized clinical assessment protocol & customized specialty documentation"
  },
  {
    "formName": "YESS",
    "formId": 202,
    "defaultGroup": "SPECIALTY",
    "encounterType": "ALL",
    "description": "Specialized clinical workflow & customized care notes"
  },
  {
    "formName": "PHARMACIST",
    "formId": 10202,
    "defaultGroup": "PHARMACY",
    "encounterType": "ALL",
    "description": "Clinical Pharmacy medication review, dispensing verification & reconciliation"
  }
];

export const SIMPLEX_RESOURCE_TYPES_CATALOG: SimplexResourceTypeCatalogItem[] = [
  {
    "resourceType": "Consultant Physician",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "CLINICIANS",
    "description": "Senior specialist physician with admitting and clinical prescribing privileges"
  },
  {
    "resourceType": "Specialist Doctor",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "CLINICIANS",
    "description": "Licensed clinical specialist in a designated clinical specialty"
  },
  {
    "resourceType": "Resident Doctor",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "CLINICIANS",
    "description": "Resident doctor in postgraduate clinical training under supervision"
  },
  {
    "resourceType": "General Practitioner",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "CLINICIANS",
    "description": "Primary care medical practitioner for outpatient and emergency clinics"
  },
  {
    "resourceType": "Staff Nurse",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "NURSING",
    "description": "Registered nurse responsible for direct patient care, triage & vitals"
  },
  {
    "resourceType": "Head Nurse / Nurse Supervisor",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "NURSING",
    "description": "Nursing supervisor managing ward nursing operations and shift assignments"
  },
  {
    "resourceType": "Clinical Pharmacist",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "PHARMACY",
    "description": "Licensed pharmacist dispensing medications and conducting drug interactions review"
  },
  {
    "resourceType": "Radiologist / Imaging Specialist",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "RADIOLOGY",
    "description": "Diagnostic radiologist interpreting X-ray, CT, MRI and ultrasound imaging"
  },
  {
    "resourceType": "Radiology Technician",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "RIS",
    "description": "Technologist operating radiological scanning machinery and PACS systems"
  },
  {
    "resourceType": "Physiotherapist",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "CLINICIANS",
    "description": "Licensed physical therapy and musculoskeletal rehabilitation clinician"
  },
  {
    "resourceType": "Medical Lab Technician",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "LIS TECHNICIANS",
    "description": "Laboratory technician executing pathology and biochemistry specimen testing"
  },
  {
    "resourceType": "Dietician / Nutritionist",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "CLINICIANS",
    "description": "Clinical nutritionist managing therapeutic dietary counseling"
  },
  {
    "resourceType": "Anesthesiologist",
    "category": "Human",
    "isHuman": "Yes",
    "userAccountRequired": "Yes - Mandatory",
    "eclaimApplicable": "Yes",
    "emrApplicable": "Yes",
    "recommendedRole": "CLINICIANS",
    "description": "Specialist physician managing anesthesia, sedation & perioperative safety"
  },
  {
    "resourceType": "Equipment",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "General clinical equipment (e.g. Laser, ECG machine, Defibrillator, Incubator)"
  },
  {
    "resourceType": "MRI Scanner Room",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Magnetic Resonance Imaging suite/room for appointment slot scheduling"
  },
  {
    "resourceType": "CT Scanner Room",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Computed Tomography scanning suite for schedule and appointment booking"
  },
  {
    "resourceType": "Ultrasound Room",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Diagnostic ultrasound scanning room / sonography unit"
  },
  {
    "resourceType": "X-Ray Room",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Diagnostic plain radiography suite / digital X-ray examination room"
  },
  {
    "resourceType": "Operation Theatre / OT Room",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Surgical operation theatre suite booked for elective and emergency surgeries"
  },
  {
    "resourceType": "ICU Bed",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Monitored Intensive Care Unit bed for critically ill patient admissions"
  },
  {
    "resourceType": "Inpatient Bed / Ward",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Standard inpatient ward bed for overnight medical and surgical admissions"
  },
  {
    "resourceType": "Consultation Room / Clinic Office",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Outpatient clinic doctor consultation examination room"
  },
  {
    "resourceType": "Ambulance / Vehicle",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Emergency patient transport ambulance or hospital dispatch vehicle"
  },
  {
    "resourceType": "Dialysis Station",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Hemodialysis unit station for renal replacement therapy scheduling"
  },
  {
    "resourceType": "Endoscopy Suite",
    "category": "Non-Human",
    "isHuman": "No",
    "userAccountRequired": "No - Leave Blank",
    "eclaimApplicable": "No",
    "emrApplicable": "No",
    "recommendedRole": "N/A",
    "description": "Gastrointestinal and bronchoscopy diagnostic procedure room"
  }
];

export const SIMPLEX_NATIONALITIES_CATALOG: SimplexNationalityCatalogItem[] = [
  {
    "label": "Afghan ( AFG )",
    "code": "AFG",
    "countryName": "Afghan"
  },
  {
    "label": "Aland Island ( ALA )",
    "code": "ALA",
    "countryName": "Aland Island"
  },
  {
    "label": "Albanian ( ALB )",
    "code": "ALB",
    "countryName": "Albanian"
  },
  {
    "label": "Algerian ( DZA )",
    "code": "DZA",
    "countryName": "Algerian"
  },
  {
    "label": "American Samoan ( ASM )",
    "code": "ASM",
    "countryName": "American Samoan"
  },
  {
    "label": "Andorran ( AND )",
    "code": "AND",
    "countryName": "Andorran"
  },
  {
    "label": "Angolan ( AGO )",
    "code": "AGO",
    "countryName": "Angolan"
  },
  {
    "label": "Anguillan ( AIA )",
    "code": "AIA",
    "countryName": "Anguillan"
  },
  {
    "label": "Antarctic ( ATA )",
    "code": "ATA",
    "countryName": "Antarctic"
  },
  {
    "label": "Antiguan, Barbudan ( ATG )",
    "code": "ATG",
    "countryName": "Antiguan, Barbudan"
  },
  {
    "label": "Argentine ( ARG )",
    "code": "ARG",
    "countryName": "Argentine"
  },
  {
    "label": "Armenian ( ARM )",
    "code": "ARM",
    "countryName": "Armenian"
  },
  {
    "label": "Aruban ( ABW )",
    "code": "ABW",
    "countryName": "Aruban"
  },
  {
    "label": "Australian ( AUS )",
    "code": "AUS",
    "countryName": "Australian"
  },
  {
    "label": "Austrian ( AUT )",
    "code": "AUT",
    "countryName": "Austrian"
  },
  {
    "label": "Azerbaijani ( AZE )",
    "code": "AZE",
    "countryName": "Azerbaijani"
  },
  {
    "label": "Bahamian ( BHS )",
    "code": "BHS",
    "countryName": "Bahamian"
  },
  {
    "label": "Bahraini ( BHR )",
    "code": "BHR",
    "countryName": "Bahraini"
  },
  {
    "label": "Bangladeshi ( BGD )",
    "code": "BGD",
    "countryName": "Bangladeshi"
  },
  {
    "label": "Barbadian ( BRB )",
    "code": "BRB",
    "countryName": "Barbadian"
  },
  {
    "label": "Belarusian ( BLR )",
    "code": "BLR",
    "countryName": "Belarusian"
  },
  {
    "label": "Belgian ( BEL )",
    "code": "BEL",
    "countryName": "Belgian"
  },
  {
    "label": "Belizean ( BLZ )",
    "code": "BLZ",
    "countryName": "Belizean"
  },
  {
    "label": "Beninese ( BEN )",
    "code": "BEN",
    "countryName": "Beninese"
  },
  {
    "label": "Bermudian ( BMU )",
    "code": "BMU",
    "countryName": "Bermudian"
  },
  {
    "label": "Bhutanese ( BTN )",
    "code": "BTN",
    "countryName": "Bhutanese"
  },
  {
    "label": "Bolivian ( BOL )",
    "code": "BOL",
    "countryName": "Bolivian"
  },
  {
    "label": "Bonaire, Sint Eustatius and Saba ( BES )",
    "code": "BES",
    "countryName": "Bonaire, Sint Eustatius and Saba"
  },
  {
    "label": "Bosnian ( BIH )",
    "code": "BIH",
    "countryName": "Bosnian"
  },
  {
    "label": "Botswanan ( BWA )",
    "code": "BWA",
    "countryName": "Botswanan"
  },
  {
    "label": "Bouvet Island ( BVT )",
    "code": "BVT",
    "countryName": "Bouvet Island"
  },
  {
    "label": "Brazilian ( BRA )",
    "code": "BRA",
    "countryName": "Brazilian"
  },
  {
    "label": "British ( IOT )",
    "code": "IOT",
    "countryName": "British"
  },
  {
    "label": "Bruneian ( BRN )",
    "code": "BRN",
    "countryName": "Bruneian"
  },
  {
    "label": "Bulgarian ( BGR )",
    "code": "BGR",
    "countryName": "Bulgarian"
  },
  {
    "label": "Burkinabé ( BFA )",
    "code": "BFA",
    "countryName": "Burkinabé"
  },
  {
    "label": "Burundian ( BDI )",
    "code": "BDI",
    "countryName": "Burundian"
  },
  {
    "label": "Cabo Verdean ( CPV )",
    "code": "CPV",
    "countryName": "Cabo Verdean"
  },
  {
    "label": "Cambodian ( KHM )",
    "code": "KHM",
    "countryName": "Cambodian"
  },
  {
    "label": "Cameroonian ( CMR )",
    "code": "CMR",
    "countryName": "Cameroonian"
  },
  {
    "label": "Canadian ( CAN )",
    "code": "CAN",
    "countryName": "Canadian"
  },
  {
    "label": "Caymanian ( CYM )",
    "code": "CYM",
    "countryName": "Caymanian"
  },
  {
    "label": "Central African ( CAF )",
    "code": "CAF",
    "countryName": "Central African"
  },
  {
    "label": "Chadian ( TCD )",
    "code": "TCD",
    "countryName": "Chadian"
  },
  {
    "label": "Chilean ( CHL )",
    "code": "CHL",
    "countryName": "Chilean"
  },
  {
    "label": "Chinese ( CHN )",
    "code": "CHN",
    "countryName": "Chinese"
  },
  {
    "label": "Christmas Island ( CXR )",
    "code": "CXR",
    "countryName": "Christmas Island"
  },
  {
    "label": "Cocos Island ( CCK )",
    "code": "CCK",
    "countryName": "Cocos Island"
  },
  {
    "label": "Colombian ( COL )",
    "code": "COL",
    "countryName": "Colombian"
  },
  {
    "label": "Comorian ( COM )",
    "code": "COM",
    "countryName": "Comorian"
  },
  {
    "label": "Cook Island ( COK )",
    "code": "COK",
    "countryName": "Cook Island"
  },
  {
    "label": "Costa Rican ( CRI )",
    "code": "CRI",
    "countryName": "Costa Rican"
  },
  {
    "label": "Ivorian ( CIV )",
    "code": "CIV",
    "countryName": "Ivorian"
  },
  {
    "label": "Croatian ( HRV )",
    "code": "HRV",
    "countryName": "Croatian"
  },
  {
    "label": "Cuban ( CUB )",
    "code": "CUB",
    "countryName": "Cuban"
  },
  {
    "label": "Curacaoan ( CUW )",
    "code": "CUW",
    "countryName": "Curacaoan"
  },
  {
    "label": "Cypriot ( CYP )",
    "code": "CYP",
    "countryName": "Cypriot"
  },
  {
    "label": "Czech ( CZE )",
    "code": "CZE",
    "countryName": "Czech"
  },
  {
    "label": "Danish ( DNK )",
    "code": "DNK",
    "countryName": "Danish"
  },
  {
    "label": "Djiboutian ( DJI )",
    "code": "DJI",
    "countryName": "Djiboutian"
  },
  {
    "label": "Dominican ( DMA )",
    "code": "DMA",
    "countryName": "Dominican"
  },
  {
    "label": "Dominican ( DOM )",
    "code": "DOM",
    "countryName": "Dominican"
  },
  {
    "label": "Ecuadorian ( ECU )",
    "code": "ECU",
    "countryName": "Ecuadorian"
  },
  {
    "label": "Egyptian ( EGY )",
    "code": "EGY",
    "countryName": "Egyptian"
  },
  {
    "label": "Salvadoran ( SLV )",
    "code": "SLV",
    "countryName": "Salvadoran"
  },
  {
    "label": "Equatorial Guinean ( GNQ )",
    "code": "GNQ",
    "countryName": "Equatorial Guinean"
  },
  {
    "label": "Eritrean ( ERI )",
    "code": "ERI",
    "countryName": "Eritrean"
  },
  {
    "label": "Estonian ( EST )",
    "code": "EST",
    "countryName": "Estonian"
  },
  {
    "label": "Ethiopian ( ETH )",
    "code": "ETH",
    "countryName": "Ethiopian"
  },
  {
    "label": "Falkland Island ( FLK )",
    "code": "FLK",
    "countryName": "Falkland Island"
  },
  {
    "label": "Faroese ( FRO )",
    "code": "FRO",
    "countryName": "Faroese"
  },
  {
    "label": "Fijian ( FJI )",
    "code": "FJI",
    "countryName": "Fijian"
  },
  {
    "label": "Finnish ( FIN )",
    "code": "FIN",
    "countryName": "Finnish"
  },
  {
    "label": "French ( FRA )",
    "code": "FRA",
    "countryName": "French"
  },
  {
    "label": "French Guianese ( GUF )",
    "code": "GUF",
    "countryName": "French Guianese"
  },
  {
    "label": "French Polynesian ( PYF )",
    "code": "PYF",
    "countryName": "French Polynesian"
  },
  {
    "label": "French Southern Territories ( ATF )",
    "code": "ATF",
    "countryName": "French Southern Territories"
  },
  {
    "label": "Gabonese ( GAB )",
    "code": "GAB",
    "countryName": "Gabonese"
  },
  {
    "label": "Gambian ( GMB )",
    "code": "GMB",
    "countryName": "Gambian"
  },
  {
    "label": "Georgian ( GEO )",
    "code": "GEO",
    "countryName": "Georgian"
  },
  {
    "label": "German ( DEU )",
    "code": "DEU",
    "countryName": "German"
  },
  {
    "label": "Ghanaian ( GHA )",
    "code": "GHA",
    "countryName": "Ghanaian"
  },
  {
    "label": "Gibraltar ( GIB )",
    "code": "GIB",
    "countryName": "Gibraltar"
  },
  {
    "label": "Greek ( GRC )",
    "code": "GRC",
    "countryName": "Greek"
  },
  {
    "label": "Greenlandic ( GRL )",
    "code": "GRL",
    "countryName": "Greenlandic"
  },
  {
    "label": "Grenadian ( GRD )",
    "code": "GRD",
    "countryName": "Grenadian"
  },
  {
    "label": "Guadeloupe ( GLP )",
    "code": "GLP",
    "countryName": "Guadeloupe"
  },
  {
    "label": "Guamanian ( GUM )",
    "code": "GUM",
    "countryName": "Guamanian"
  },
  {
    "label": "Guatemalan ( GTM )",
    "code": "GTM",
    "countryName": "Guatemalan"
  },
  {
    "label": "Channel Island ( GGY )",
    "code": "GGY",
    "countryName": "Channel Island"
  },
  {
    "label": "Guinean ( GIN )",
    "code": "GIN",
    "countryName": "Guinean"
  },
  {
    "label": "Bissau-Guinean ( GNB )",
    "code": "GNB",
    "countryName": "Bissau-Guinean"
  },
  {
    "label": "Guyanese ( GUY )",
    "code": "GUY",
    "countryName": "Guyanese"
  },
  {
    "label": "Haitian ( HTI )",
    "code": "HTI",
    "countryName": "Haitian"
  },
  {
    "label": "Heard Island ( HMD )",
    "code": "HMD",
    "countryName": "Heard Island"
  },
  {
    "label": "Holy See ( VAT )",
    "code": "VAT",
    "countryName": "Holy See"
  },
  {
    "label": "Honduran ( HND )",
    "code": "HND",
    "countryName": "Honduran"
  },
  {
    "label": "Hong Kong ( HKG )",
    "code": "HKG",
    "countryName": "Hong Kong"
  },
  {
    "label": "Hungarian ( HUN )",
    "code": "HUN",
    "countryName": "Hungarian"
  },
  {
    "label": "Icelandic ( ISL )",
    "code": "ISL",
    "countryName": "Icelandic"
  },
  {
    "label": "Indian ( IND )",
    "code": "IND",
    "countryName": "Indian"
  },
  {
    "label": "Indonesian ( IDN )",
    "code": "IDN",
    "countryName": "Indonesian"
  },
  {
    "label": "Iranian ( IRN )",
    "code": "IRN",
    "countryName": "Iranian"
  },
  {
    "label": "Iraqi ( IRQ )",
    "code": "IRQ",
    "countryName": "Iraqi"
  },
  {
    "label": "Irish ( IRL )",
    "code": "IRL",
    "countryName": "Irish"
  },
  {
    "label": "Italian ( ITA )",
    "code": "ITA",
    "countryName": "Italian"
  },
  {
    "label": "Jamaican ( JAM )",
    "code": "JAM",
    "countryName": "Jamaican"
  },
  {
    "label": "Japanese ( JPN )",
    "code": "JPN",
    "countryName": "Japanese"
  },
  {
    "label": "Manx ( IMN )",
    "code": "IMN",
    "countryName": "Manx"
  },
  {
    "label": "Channel Island ( JEY )",
    "code": "JEY",
    "countryName": "Channel Island"
  },
  {
    "label": "Jordanian ( JOR )",
    "code": "JOR",
    "countryName": "Jordanian"
  },
  {
    "label": "Kazakhstani ( KAZ )",
    "code": "KAZ",
    "countryName": "Kazakhstani"
  },
  {
    "label": "Kenyan ( KEN )",
    "code": "KEN",
    "countryName": "Kenyan"
  },
  {
    "label": "I-Kiribati ( KIR )",
    "code": "KIR",
    "countryName": "I-Kiribati"
  },
  {
    "label": "North Korean ( PRK )",
    "code": "PRK",
    "countryName": "North Korean"
  },
  {
    "label": "South Korean ( KOR )",
    "code": "KOR",
    "countryName": "South Korean"
  },
  {
    "label": "Kuwaiti ( KWT )",
    "code": "KWT",
    "countryName": "Kuwaiti"
  },
  {
    "label": "Kyrgyzstani ( KGZ )",
    "code": "KGZ",
    "countryName": "Kyrgyzstani"
  },
  {
    "label": "Laotian ( LAO )",
    "code": "LAO",
    "countryName": "Laotian"
  },
  {
    "label": "Latvian ( LVA )",
    "code": "LVA",
    "countryName": "Latvian"
  },
  {
    "label": "Lebanese ( LBN )",
    "code": "LBN",
    "countryName": "Lebanese"
  },
  {
    "label": "Basotho ( LSO )",
    "code": "LSO",
    "countryName": "Basotho"
  },
  {
    "label": "Liberian ( LBR )",
    "code": "LBR",
    "countryName": "Liberian"
  },
  {
    "label": "Libyan ( LBY )",
    "code": "LBY",
    "countryName": "Libyan"
  },
  {
    "label": "Liechtenstein ( LIE )",
    "code": "LIE",
    "countryName": "Liechtenstein"
  },
  {
    "label": "Lithuanian ( LTU )",
    "code": "LTU",
    "countryName": "Lithuanian"
  },
  {
    "label": "Luxembourg ( LUX )",
    "code": "LUX",
    "countryName": "Luxembourg"
  },
  {
    "label": "Macanese ( MAC )",
    "code": "MAC",
    "countryName": "Macanese"
  },
  {
    "label": "Macedonian ( MKD )",
    "code": "MKD",
    "countryName": "Macedonian"
  },
  {
    "label": "Malagasy ( MDG )",
    "code": "MDG",
    "countryName": "Malagasy"
  },
  {
    "label": "Malawian ( MWI )",
    "code": "MWI",
    "countryName": "Malawian"
  },
  {
    "label": "Malaysian ( MYS )",
    "code": "MYS",
    "countryName": "Malaysian"
  },
  {
    "label": "Maldivian ( MDV )",
    "code": "MDV",
    "countryName": "Maldivian"
  },
  {
    "label": "Malian ( MLI )",
    "code": "MLI",
    "countryName": "Malian"
  },
  {
    "label": "Maltese ( MLT )",
    "code": "MLT",
    "countryName": "Maltese"
  },
  {
    "label": "Marshallese ( MHL )",
    "code": "MHL",
    "countryName": "Marshallese"
  },
  {
    "label": "Martinican ( MTQ )",
    "code": "MTQ",
    "countryName": "Martinican"
  },
  {
    "label": "Mauritanian ( MRT )",
    "code": "MRT",
    "countryName": "Mauritanian"
  },
  {
    "label": "Mauritian ( MUS )",
    "code": "MUS",
    "countryName": "Mauritian"
  },
  {
    "label": "Mahoran ( MYT )",
    "code": "MYT",
    "countryName": "Mahoran"
  },
  {
    "label": "Mexican ( MEX )",
    "code": "MEX",
    "countryName": "Mexican"
  },
  {
    "label": "Micronesian ( FSM )",
    "code": "FSM",
    "countryName": "Micronesian"
  },
  {
    "label": "Moldovan ( MDA )",
    "code": "MDA",
    "countryName": "Moldovan"
  },
  {
    "label": "Monacan ( MCO )",
    "code": "MCO",
    "countryName": "Monacan"
  },
  {
    "label": "Mongolian ( MNG )",
    "code": "MNG",
    "countryName": "Mongolian"
  },
  {
    "label": "Montenegrin ( MNE )",
    "code": "MNE",
    "countryName": "Montenegrin"
  },
  {
    "label": "Montserratian ( MSR )",
    "code": "MSR",
    "countryName": "Montserratian"
  },
  {
    "label": "Moroccan ( MAR )",
    "code": "MAR",
    "countryName": "Moroccan"
  },
  {
    "label": "Mozambican ( MOZ )",
    "code": "MOZ",
    "countryName": "Mozambican"
  },
  {
    "label": "Burmese ( MMR )",
    "code": "MMR",
    "countryName": "Burmese"
  },
  {
    "label": "Namibian ( NAM )",
    "code": "NAM",
    "countryName": "Namibian"
  },
  {
    "label": "Nauruan ( NRU )",
    "code": "NRU",
    "countryName": "Nauruan"
  },
  {
    "label": "Nepali ( NPL )",
    "code": "NPL",
    "countryName": "Nepali"
  },
  {
    "label": "Dutch ( NLD )",
    "code": "NLD",
    "countryName": "Dutch"
  },
  {
    "label": "New Caledonian ( NCL )",
    "code": "NCL",
    "countryName": "New Caledonian"
  },
  {
    "label": "New Zealand ( NZL )",
    "code": "NZL",
    "countryName": "New Zealand"
  },
  {
    "label": "Nicaraguan ( NIC )",
    "code": "NIC",
    "countryName": "Nicaraguan"
  },
  {
    "label": "Nigerien ( NER )",
    "code": "NER",
    "countryName": "Nigerien"
  },
  {
    "label": "Nigerian ( NGA )",
    "code": "NGA",
    "countryName": "Nigerian"
  },
  {
    "label": "Niuean ( NIU )",
    "code": "NIU",
    "countryName": "Niuean"
  },
  {
    "label": "Norfolk Island ( NFK )",
    "code": "NFK",
    "countryName": "Norfolk Island"
  },
  {
    "label": "Northern Marianan ( MNP )",
    "code": "MNP",
    "countryName": "Northern Marianan"
  },
  {
    "label": "Norwegian ( NOR )",
    "code": "NOR",
    "countryName": "Norwegian"
  },
  {
    "label": "Not defined ( NOT )",
    "code": "NOT",
    "countryName": "Not defined"
  },
  {
    "label": "Omani ( OMN )",
    "code": "OMN",
    "countryName": "Omani"
  },
  {
    "label": "Other nationalities (explain) ( OTH )",
    "code": "OTH",
    "countryName": "Other nationalities (explain)"
  },
  {
    "label": "Pakistani ( PAK )",
    "code": "PAK",
    "countryName": "Pakistani"
  },
  {
    "label": "Palauan ( PLW )",
    "code": "PLW",
    "countryName": "Palauan"
  },
  {
    "label": "Palestinian ( PSE )",
    "code": "PSE",
    "countryName": "Palestinian"
  },
  {
    "label": "Panamanian ( PAN )",
    "code": "PAN",
    "countryName": "Panamanian"
  },
  {
    "label": "Papua New Guinean ( PNG )",
    "code": "PNG",
    "countryName": "Papua New Guinean"
  },
  {
    "label": "Paraguayan ( PRY )",
    "code": "PRY",
    "countryName": "Paraguayan"
  },
  {
    "label": "Peruvian ( PER )",
    "code": "PER",
    "countryName": "Peruvian"
  },
  {
    "label": "Philippine ( PHL )",
    "code": "PHL",
    "countryName": "Philippine"
  },
  {
    "label": "Pitcairn Island ( PCN )",
    "code": "PCN",
    "countryName": "Pitcairn Island"
  },
  {
    "label": "Polish ( POL )",
    "code": "POL",
    "countryName": "Polish"
  },
  {
    "label": "Portuguese ( PRT )",
    "code": "PRT",
    "countryName": "Portuguese"
  },
  {
    "label": "Puerto Rican ( PRI )",
    "code": "PRI",
    "countryName": "Puerto Rican"
  },
  {
    "label": "Qatari ( QAT )",
    "code": "QAT",
    "countryName": "Qatari"
  },
  {
    "label": "Réunionese ( REU )",
    "code": "REU",
    "countryName": "Réunionese"
  },
  {
    "label": "Romanian ( ROU )",
    "code": "ROU",
    "countryName": "Romanian"
  },
  {
    "label": "Russian ( RUS )",
    "code": "RUS",
    "countryName": "Russian"
  },
  {
    "label": "Rwandan ( RWA )",
    "code": "RWA",
    "countryName": "Rwandan"
  },
  {
    "label": "Barthélemois ( BLM )",
    "code": "BLM",
    "countryName": "Barthélemois"
  },
  {
    "label": "Saint Helenian ( SHN )",
    "code": "SHN",
    "countryName": "Saint Helenian"
  },
  {
    "label": "Kittitian, Nevisian ( KNA )",
    "code": "KNA",
    "countryName": "Kittitian, Nevisian"
  },
  {
    "label": "Saint Lucian ( LCA )",
    "code": "LCA",
    "countryName": "Saint Lucian"
  },
  {
    "label": "Saint Martin French part ( MAF )",
    "code": "MAF",
    "countryName": "Saint Martin French part"
  },
  {
    "label": "French ( SPM )",
    "code": "SPM",
    "countryName": "French"
  },
  {
    "label": "Saint Vincentian ( VCT )",
    "code": "VCT",
    "countryName": "Saint Vincentian"
  },
  {
    "label": "Samoan ( WSM )",
    "code": "WSM",
    "countryName": "Samoan"
  },
  {
    "label": "Sammarinese ( SMR )",
    "code": "SMR",
    "countryName": "Sammarinese"
  },
  {
    "label": "São Toméan ( STP )",
    "code": "STP",
    "countryName": "São Toméan"
  },
  {
    "label": "Saudi ( SAU )",
    "code": "SAU",
    "countryName": "Saudi"
  },
  {
    "label": "Senegalese ( SEN )",
    "code": "SEN",
    "countryName": "Senegalese"
  },
  {
    "label": "Serbian ( SRB )",
    "code": "SRB",
    "countryName": "Serbian"
  },
  {
    "label": "Seychellois ( SYC )",
    "code": "SYC",
    "countryName": "Seychellois"
  },
  {
    "label": "Sierra Leonean ( SLE )",
    "code": "SLE",
    "countryName": "Sierra Leonean"
  },
  {
    "label": "Singaporean ( SGP )",
    "code": "SGP",
    "countryName": "Singaporean"
  },
  {
    "label": "Sint Maarten Dutch part ( SXM )",
    "code": "SXM",
    "countryName": "Sint Maarten Dutch part"
  },
  {
    "label": "Slovak ( SVK )",
    "code": "SVK",
    "countryName": "Slovak"
  },
  {
    "label": "Slovenian ( SVN )",
    "code": "SVN",
    "countryName": "Slovenian"
  },
  {
    "label": "Solomon Island ( SLB )",
    "code": "SLB",
    "countryName": "Solomon Island"
  },
  {
    "label": "Somali ( SOM )",
    "code": "SOM",
    "countryName": "Somali"
  },
  {
    "label": "South African ( ZAF )",
    "code": "ZAF",
    "countryName": "South African"
  },
  {
    "label": "South Georgia ( SGS )",
    "code": "SGS",
    "countryName": "South Georgia"
  },
  {
    "label": "South Sudanese ( SSD )",
    "code": "SSD",
    "countryName": "South Sudanese"
  },
  {
    "label": "Spanish ( ESP )",
    "code": "ESP",
    "countryName": "Spanish"
  },
  {
    "label": "Sri Lankan ( LKA )",
    "code": "LKA",
    "countryName": "Sri Lankan"
  },
  {
    "label": "Sudanese ( SDN )",
    "code": "SDN",
    "countryName": "Sudanese"
  },
  {
    "label": "Surinamese ( SUR )",
    "code": "SUR",
    "countryName": "Surinamese"
  },
  {
    "label": "Svalbard and Jan Mayen ( SJM )",
    "code": "SJM",
    "countryName": "Svalbard and Jan Mayen"
  },
  {
    "label": "Swazi ( SWZ )",
    "code": "SWZ",
    "countryName": "Swazi"
  },
  {
    "label": "Swedish ( SWE )",
    "code": "SWE",
    "countryName": "Swedish"
  },
  {
    "label": "Swiss ( CHE )",
    "code": "CHE",
    "countryName": "Swiss"
  },
  {
    "label": "Syrian ( SYR )",
    "code": "SYR",
    "countryName": "Syrian"
  },
  {
    "label": "Taiwanese ( TWN )",
    "code": "TWN",
    "countryName": "Taiwanese"
  },
  {
    "label": "Tajikistani ( TJK )",
    "code": "TJK",
    "countryName": "Tajikistani"
  },
  {
    "label": "Tanzanian ( TZA )",
    "code": "TZA",
    "countryName": "Tanzanian"
  },
  {
    "label": "Thai ( THA )",
    "code": "THA",
    "countryName": "Thai"
  },
  {
    "label": "Timorese ( TLS )",
    "code": "TLS",
    "countryName": "Timorese"
  },
  {
    "label": "Togolese ( TGO )",
    "code": "TGO",
    "countryName": "Togolese"
  },
  {
    "label": "Tokelauan ( TKL )",
    "code": "TKL",
    "countryName": "Tokelauan"
  },
  {
    "label": "Tongan ( TON )",
    "code": "TON",
    "countryName": "Tongan"
  },
  {
    "label": "Trinidadian, Tobagonian ( TTO )",
    "code": "TTO",
    "countryName": "Trinidadian, Tobagonian"
  },
  {
    "label": "Tunisian ( TUN )",
    "code": "TUN",
    "countryName": "Tunisian"
  },
  {
    "label": "Turkish ( TUR )",
    "code": "TUR",
    "countryName": "Turkish"
  },
  {
    "label": "Turkmen ( TKM )",
    "code": "TKM",
    "countryName": "Turkmen"
  },
  {
    "label": "Turks and Caicos Island ( TCA )",
    "code": "TCA",
    "countryName": "Turks and Caicos Island"
  },
  {
    "label": "Tuvaluan ( TUV )",
    "code": "TUV",
    "countryName": "Tuvaluan"
  },
  {
    "label": "Ugandan ( UGA )",
    "code": "UGA",
    "countryName": "Ugandan"
  },
  {
    "label": "Ukrainian ( UKR )",
    "code": "UKR",
    "countryName": "Ukrainian"
  },
  {
    "label": "Emirati ( ARE )",
    "code": "ARE",
    "countryName": "Emirati"
  },
  {
    "label": "British ( GBR )",
    "code": "GBR",
    "countryName": "British"
  },
  {
    "label": "United States Minor Outlying Islands ( UMI )",
    "code": "UMI",
    "countryName": "United States Minor Outlying Islands"
  },
  {
    "label": "American ( USA )",
    "code": "USA",
    "countryName": "American"
  },
  {
    "label": "Uruguayan ( URY )",
    "code": "URY",
    "countryName": "Uruguayan"
  },
  {
    "label": "Uzbekistani ( UZB )",
    "code": "UZB",
    "countryName": "Uzbekistani"
  },
  {
    "label": "Vanuatuan ( VUT )",
    "code": "VUT",
    "countryName": "Vanuatuan"
  },
  {
    "label": "Venezuelan ( VEN )",
    "code": "VEN",
    "countryName": "Venezuelan"
  },
  {
    "label": "Vietnamese ( VNM )",
    "code": "VNM",
    "countryName": "Vietnamese"
  },
  {
    "label": "British Virgin Island ( VGB )",
    "code": "VGB",
    "countryName": "British Virgin Island"
  },
  {
    "label": "U.S. Virgin Island ( VIR )",
    "code": "VIR",
    "countryName": "U.S. Virgin Island"
  },
  {
    "label": "Wallis and Futuna ( WLF )",
    "code": "WLF",
    "countryName": "Wallis and Futuna"
  },
  {
    "label": "Sahrawi ( ESH )",
    "code": "ESH",
    "countryName": "Sahrawi"
  },
  {
    "label": "Yemeni ( YEM )",
    "code": "YEM",
    "countryName": "Yemeni"
  },
  {
    "label": "Zambian ( ZMB )",
    "code": "ZMB",
    "countryName": "Zambian"
  },
  {
    "label": "Zimbabwean ( ZWE )",
    "code": "ZWE",
    "countryName": "Zimbabwean"
  }
];

export const SIMPLEX_ROLES_CATALOG: SimplexRoleCatalogItem[] = [
  {
    "label": "ACCOUNTANT TWO",
    "code": "ACCT",
    "category": "General Access"
  },
  {
    "label": "ACCUMED",
    "code": "ACCUMED",
    "category": "General Access"
  },
  {
    "label": "Admin",
    "code": "Admin",
    "category": "System Administration"
  },
  {
    "label": "APPOINTMENT ROLE",
    "code": "APPOINTMEN",
    "category": "Front Desk & Appointments"
  },
  {
    "label": "APPOINTMENT VIEW",
    "code": "APPVIEW",
    "category": "Front Desk & Appointments"
  },
  {
    "label": "Appointment",
    "code": "APT",
    "category": "Front Desk & Appointments"
  },
  {
    "label": "BILLING SUPER USER",
    "code": "BILL",
    "category": "Billing & Finance"
  },
  {
    "label": "INVENTORY BILLING ROLE",
    "code": "BILLINROLE",
    "category": "Billing & Finance"
  },
  {
    "label": "BILL NO EDIT",
    "code": "BILLNOEDI",
    "category": "Billing & Finance"
  },
  {
    "label": "BILLPRINT",
    "code": "BILLPRINT",
    "category": "Billing & Finance"
  },
  {
    "label": "BILL REOPEN",
    "code": "BILLREOPEN",
    "category": "Billing & Finance"
  },
  {
    "label": "CLINICIAN CMO",
    "code": "CLINCIAN02",
    "category": "Doctors / Clinicians"
  },
  {
    "label": "CLINICIANS",
    "code": "CLINIC",
    "category": "Doctors / Clinicians"
  },
  {
    "label": "COMPANY WISE PRICE UPDATION",
    "code": "COMPPRICE",
    "category": "Billing & Finance"
  },
  {
    "label": "CONSENT",
    "code": "CONS",
    "category": "General Access"
  },
  {
    "label": "DENTAL",
    "code": "DENT",
    "category": "Doctors / Clinicians"
  },
  {
    "label": "DISCOUNT APPROVE",
    "code": "DISCOUNTAP",
    "category": "Front Desk & Appointments"
  },
  {
    "label": "DISCOUNT REQUEST",
    "code": "DISCOUNTRE",
    "category": "General Access"
  },
  {
    "label": "DOCUMENT FULL ACCESS",
    "code": "DOCFULLACC",
    "category": "Doctors / Clinicians"
  },
  {
    "label": "DOCTOR SCHEDULE",
    "code": "DOCSCH",
    "category": "Doctors / Clinicians"
  },
  {
    "label": "DOCUMENTS UPLOAD AND VIEW",
    "code": "DOCUMENTS",
    "category": "Doctors / Clinicians"
  },
  {
    "label": "DOCTOR REPORT",
    "code": "DRREPORT",
    "category": "Doctors / Clinicians"
  },
  {
    "label": "SYSTEM ADMINISTRATOR",
    "code": "EMR",
    "category": "System Administration"
  },
  {
    "label": "EMR DENTAL",
    "code": "EMRDENT",
    "category": "Doctors / Clinicians"
  },
  {
    "label": "EMR READ ONLY",
    "code": "EMRREADONL",
    "category": "General Access"
  },
  {
    "label": "FINANCE MANAGER",
    "code": "FINMAN",
    "category": "Billing & Finance"
  },
  {
    "label": "FRONT DESK MANAGER",
    "code": "FOMANAG",
    "category": "Front Desk & Appointments"
  },
  {
    "label": "FRONT DESK VIEW",
    "code": "FV001",
    "category": "Front Desk & Appointments"
  },
  {
    "label": "Himes Appointment",
    "code": "Himes_App",
    "category": "Front Desk & Appointments"
  },
  {
    "label": "Himes Billing",
    "code": "Himes_Bil",
    "category": "Billing & Finance"
  },
  {
    "label": "Himes Clinic Admin",
    "code": "Himes_Cli",
    "category": "Doctors / Clinicians"
  },
  {
    "label": "Himes Doctor",
    "code": "Himes_Doc",
    "category": "Doctors / Clinicians"
  },
  {
    "label": "Himes Insurance",
    "code": "Himes_Ins",
    "category": "Insurance"
  },
  {
    "label": "Himes Inventory",
    "code": "Himes_Inv",
    "category": "Inventory & Procurement"
  },
  {
    "label": "Himes LIS",
    "code": "Himes_LIS",
    "category": "Laboratory"
  },
  {
    "label": "Himes Nurse",
    "code": "Himes_Nur",
    "category": "Nursing"
  },
  {
    "label": "Himes Pharmacy",
    "code": "Himes_Pha",
    "category": "Pharmacy"
  },
  {
    "label": "Himes Procurement",
    "code": "Himes_Pro",
    "category": "Inventory & Procurement"
  },
  {
    "label": "Himes Registration",
    "code": "Himes_Reg",
    "category": "Front Desk & Appointments"
  },
  {
    "label": "Himes Reports",
    "code": "Himes_Rep",
    "category": "Records & Reports"
  },
  {
    "label": "Himes RIS",
    "code": "Himes_RIS",
    "category": "Radiology"
  },
  {
    "label": "INSURANCE",
    "code": "INS",
    "category": "Insurance"
  },
  {
    "label": "INSURANCE PLANS",
    "code": "INSURPLAN",
    "category": "Insurance"
  },
  {
    "label": "INVENTORY MANAGER",
    "code": "INV",
    "category": "Inventory & Procurement"
  },
  {
    "label": "INVENTORY MASTERS",
    "code": "INVMASTER",
    "category": "Inventory & Procurement"
  },
  {
    "label": "INVOICE CANCEL REQUEST",
    "code": "INVOICECAN",
    "category": "Inventory & Procurement"
  },
  {
    "label": "ITADMIN",
    "code": "ITADMIN",
    "category": "System Administration"
  },
  {
    "label": "LIS ADMIN",
    "code": "LIS",
    "category": "Laboratory"
  },
  {
    "label": "LIS TECHNICIANS",
    "code": "LISEU",
    "category": "Laboratory"
  },
  {
    "label": "LIS PATHOLOGIST",
    "code": "LISPATH",
    "category": "Laboratory"
  },
  {
    "label": "LIS PHLEBOTOMY",
    "code": "LISPHLEB",
    "category": "Laboratory"
  },
  {
    "label": "LAB REGISTER",
    "code": "LR",
    "category": "Laboratory"
  },
  {
    "label": "MARKETING",
    "code": "MARKETING",
    "category": "General Access"
  },
  {
    "label": "SYSTEM ADMIN LEVEL ONE",
    "code": "MASTER01",
    "category": "System Administration"
  },
  {
    "label": "MASTER PRICE EDIT",
    "code": "MASTER02",
    "category": "Billing & Finance"
  },
  {
    "label": "MATERIAL AND PR",
    "code": "MATPR",
    "category": "Inventory & Procurement"
  },
  {
    "label": "MATERIAL REQUEST AND CONSUMPTION END USERS",
    "code": "MATREQ",
    "category": "Inventory & Procurement"
  },
  {
    "label": "MRD",
    "code": "MRD001",
    "category": "Records & Reports"
  },
  {
    "label": "NURSING",
    "code": "NUR",
    "category": "Nursing"
  },
  {
    "label": "OPERATING ROOM",
    "code": "OR",
    "category": "General Access"
  },
  {
    "label": "OPERATING ROOM WITH SCHEDULER",
    "code": "ORSCHED",
    "category": "General Access"
  },
  {
    "label": "MASTER PRICE LIST",
    "code": "PH002",
    "category": "Laboratory"
  },
  {
    "label": "PHARMACY",
    "code": "PHAR",
    "category": "Pharmacy"
  },
  {
    "label": "PHARMACY MANAGER",
    "code": "PHARMAINC",
    "category": "Pharmacy"
  },
  {
    "label": "PROCUREMENT",
    "code": "PRO",
    "category": "Inventory & Procurement"
  },
  {
    "label": "PURCHASE",
    "code": "PURCHASE",
    "category": "Inventory & Procurement"
  },
  {
    "label": "RADIOLOGY",
    "code": "RADIOLOGY",
    "category": "Radiology"
  },
  {
    "label": "FRONT DESK",
    "code": "REG",
    "category": "Front Desk & Appointments"
  },
  {
    "label": "REPORTS",
    "code": "REPORTS",
    "category": "Records & Reports"
  },
  {
    "label": "REVENUE REPORT",
    "code": "REVENUEREP",
    "category": "Billing & Finance"
  },
  {
    "label": "RIS",
    "code": "RIS",
    "category": "Radiology"
  },
  {
    "label": "SHOWALLUSERS",
    "code": "SHOWALLUSE",
    "category": "General Access"
  },
  {
    "label": "STOCK CONSUMPTION REPORT",
    "code": "STOCKCONSU",
    "category": "Records & Reports"
  },
  {
    "label": "TRIAL ROLE",
    "code": "TRIALROLE",
    "category": "General Access"
  },
  {
    "label": "VISIT REPORTS",
    "code": "VISITREPOR",
    "category": "Records & Reports"
  }
];

export const SIMPLEX_SPECIALTIES_CATALOG: SimplexSpecialtyCatalogItem[] = [
  {
    "specialty": "Cardiology",
    "department": "Cardiology Dept",
    "eclaimCode": "CARDIO"
  },
  {
    "specialty": "Neurology",
    "department": "Neurology Dept",
    "eclaimCode": "NEURO"
  },
  {
    "specialty": "Orthopedics",
    "department": "Orthopedic Surgery",
    "eclaimCode": "ORTHO"
  },
  {
    "specialty": "Pediatrics",
    "department": "Pediatrics Dept",
    "eclaimCode": "PEDIA"
  },
  {
    "specialty": "Radiology",
    "department": "Diagnostic Radiology",
    "eclaimCode": "RAD"
  },
  {
    "specialty": "General Surgery",
    "department": "Surgical Suite",
    "eclaimCode": "GENSURG"
  },
  {
    "specialty": "Internal Medicine",
    "department": "Internal Medicine",
    "eclaimCode": "INTMED"
  },
  {
    "specialty": "Emergency Medicine",
    "department": "Emergency Department",
    "eclaimCode": "EMERG"
  },
  {
    "specialty": "Obstetrics & Gynecology",
    "department": "Women Care / OB-GYN",
    "eclaimCode": "OBGYN"
  },
  {
    "specialty": "Dermatology",
    "department": "Dermatology Clinic",
    "eclaimCode": "DERM"
  },
  {
    "specialty": "Ophthalmology",
    "department": "Eye Clinic / Ophthalmology",
    "eclaimCode": "OPHTH"
  },
  {
    "specialty": "ENT / Otorhinolaryngology",
    "department": "ENT Clinic",
    "eclaimCode": "ENT"
  },
  {
    "specialty": "Anesthesiology",
    "department": "Anesthesia & ICU",
    "eclaimCode": "ANESTH"
  },
  {
    "specialty": "Psychiatry",
    "department": "Behavioral Health",
    "eclaimCode": "PSYCH"
  },
  {
    "specialty": "Urology",
    "department": "Urology Clinic",
    "eclaimCode": "UROL"
  },
  {
    "specialty": "Gastroenterology",
    "department": "Digestive Health",
    "eclaimCode": "GASTRO"
  },
  {
    "specialty": "Pulmonology",
    "department": "Respiratory Medicine",
    "eclaimCode": "PULM"
  },
  {
    "specialty": "Nephrology",
    "department": "Renal Care / Dialysis",
    "eclaimCode": "NEPHRO"
  },
  {
    "specialty": "Endocrinology",
    "department": "Endocrine & Diabetes",
    "eclaimCode": "ENDO"
  },
  {
    "specialty": "Oncology",
    "department": "Cancer Care",
    "eclaimCode": "ONCO"
  },
  {
    "specialty": "Pathology & Laboratory",
    "department": "Central Laboratory",
    "eclaimCode": "PATH"
  },
  {
    "specialty": "Family Medicine",
    "department": "Primary Care Clinics",
    "eclaimCode": "FAMMED"
  },
  {
    "specialty": "Physiotherapy & Rehabilitation",
    "department": "Rehabilitation Dept",
    "eclaimCode": "PHYSIO"
  },
  {
    "specialty": "Dental / Oral Surgery",
    "department": "Dental Clinic",
    "eclaimCode": "DENTAL"
  },
  {
    "specialty": "General Practice (GP)",
    "department": "Outpatient Clinics",
    "eclaimCode": "GP"
  },
  {
    "specialty": "Plastic Surgery",
    "department": "Aesthetics & Reconstruction",
    "eclaimCode": "PLAST"
  },
  {
    "specialty": "Rheumatology",
    "department": "Joint & Arthritis Care",
    "eclaimCode": "RHEUM"
  },
  {
    "specialty": "Vascular Surgery",
    "department": "Vascular Health",
    "eclaimCode": "VASCSURG"
  }
];

export const SIMPLEX_DEPARTMENTS_CATALOG = [
  {
    "department": "Cardiology Dept",
    "code": "CARD",
    "description": "Adult & Pediatric Cardiovascular Care"
  },
  {
    "department": "Neurology Dept",
    "code": "NEUR",
    "description": "Brain, Spine & Nervous System Disorders"
  },
  {
    "department": "Orthopedic Surgery",
    "code": "ORTH",
    "description": "Musculoskeletal Trauma & Joint Replacement"
  },
  {
    "department": "Pediatrics Dept",
    "code": "PED",
    "description": "Comprehensive Child Healthcare"
  },
  {
    "department": "Diagnostic Radiology",
    "code": "RAD",
    "description": "Medical Imaging & Interventional Radiology"
  },
  {
    "department": "Surgical Suite",
    "code": "SURG",
    "description": "General & Laparoscopic Surgical Care"
  },
  {
    "department": "Internal Medicine",
    "code": "IM",
    "description": "Adult General Medicine & Chronic Disease"
  },
  {
    "department": "Emergency Department",
    "code": "ER",
    "description": "24/7 Emergency & Acute Trauma Resuscitation"
  },
  {
    "department": "Outpatient Clinics",
    "code": "OPD",
    "description": "Multi-Specialty Ambulatory Outpatient Care"
  },
  {
    "department": "Inpatient Ward",
    "code": "IPD",
    "description": "Post-Surgical & General Medical Inpatient Care"
  },
  {
    "department": "Operation Theatres",
    "code": "OT",
    "description": "Sterile Operating Theatres & Minor Procedure Rooms"
  },
  {
    "department": "Central Laboratory",
    "code": "LAB",
    "description": "Clinical Pathology, Hematology & Biochemistry"
  },
  {
    "department": "Pharmacy Department",
    "code": "PHARM",
    "description": "Inpatient & Outpatient Medication Dispensing"
  },
  {
    "department": "Rehabilitation Dept",
    "code": "REHAB",
    "description": "Physiotherapy, Occupational & Speech Therapy"
  }
];

export const SIMPLEX_SERVICES_CATALOG = [
  {
    "service": "Cardiology Consultation",
    "code": "SRV-CARD-01",
    "department": "Cardiology Dept"
  },
  {
    "service": "Echocardiogram (2D Echo)",
    "code": "SRV-CARD-02",
    "department": "Cardiology Dept"
  },
  {
    "service": "Treadmill Exercise Stress Test",
    "code": "SRV-CARD-03",
    "department": "Cardiology Dept"
  },
  {
    "service": "MRI Scan with Contrast",
    "code": "SRV-RAD-01",
    "department": "Diagnostic Radiology"
  },
  {
    "service": "CT Scan (Brain / Thorax / Abdomen)",
    "code": "SRV-RAD-02",
    "department": "Diagnostic Radiology"
  },
  {
    "service": "Ultrasound Abdomen & Pelvis",
    "code": "SRV-RAD-03",
    "department": "Diagnostic Radiology"
  },
  {
    "service": "Digital Chest X-Ray",
    "code": "SRV-RAD-04",
    "department": "Diagnostic Radiology"
  },
  {
    "service": "General Consultation (GP)",
    "code": "SRV-OPD-01",
    "department": "Outpatient Clinics"
  },
  {
    "service": "Specialist Medical Consultation",
    "code": "SRV-OPD-02",
    "department": "Outpatient Clinics"
  },
  {
    "service": "Routine Health Check Package",
    "code": "SRV-OPD-03",
    "department": "Outpatient Clinics"
  },
  {
    "service": "Inpatient Room Daily Care",
    "code": "SRV-IPD-01",
    "department": "Inpatient Ward"
  },
  {
    "service": "Physical Rehabilitation Session",
    "code": "SRV-REHAB-01",
    "department": "Rehabilitation Dept"
  }
];
