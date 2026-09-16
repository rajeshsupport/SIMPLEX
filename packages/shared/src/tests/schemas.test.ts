import crypto from 'node:crypto';
import {
  LoginRequestSchema,
  CreateClientSchema,
  ServiceMasterRowSchema,
  UserImportRowSchema,
  CreateClientResourceSchema,
  UpdateClientResourceSchema,
  SetClientResourceStatusSchema,
  MapResourceUserSchema,
  SyncClientResourcesSchema,
  resolveClientRoute,
  resolveClientRoleUrl,
  resolveClientResourceUrl,
  resolveClientResourceUserMappingUrl,
  resolveClientEmrPanelUrl,
  resolveClientEclaimUserUrl,
  normalizeClientBaseUrl,
  ensureTrailingSlash,
  DEFAULT_ROLE_MAPPING_ROUTE,
  validateRedirectHost,
  parseAndValidateRoles,
  assertValidOneTimeEventId,
  isValidOneTimeEventId,
  computeOneTimeEventIdHash,
  SHA256_EMPTY_DIGEST,
  PERMISSIONS,
  generateResourceImportWorkbook,
  parseAndValidateResourceWorkbook,
} from '../index.js';

function runSchemaTests() {

  console.log('--- Testing Zod Validation Schemas ---');

  // 1. Login Schema
  const validLogin = LoginRequestSchema.safeParse({ username: 'superadmin', password: 'Password123!' });
  if (!validLogin.success) throw new Error('Valid login failed validation');

  const invalidLogin = LoginRequestSchema.safeParse({ username: 'a', password: '1' });
  if (invalidLogin.success) throw new Error('Invalid login passed validation unexpectedly');
  console.log('✓ LoginRequestSchema validated.');

  // 2. Client Schema
  const validClient = CreateClientSchema.safeParse({
    clientCode: 'HMC_METRO',
    clientName: 'Metro General Hospital',
    baseUrl: 'https://metro.hmc.example.com',
    environment: 'Staging',
  });
  if (!validClient.success) throw new Error(`Valid client failed: ${JSON.stringify(validClient.error)}`);

  const validLocalClient = CreateClientSchema.safeParse({
    clientCode: 'HMC_LOCAL',
    clientName: 'Local Hospital Dev',
    baseUrl: 'http://localhost:3000',
    environment: 'Local',
  });
  if (!validLocalClient.success) throw new Error(`Valid local client failed: ${JSON.stringify(validLocalClient.error)}`);

  const invalidClient = CreateClientSchema.safeParse({
    clientCode: '!',
    clientName: 'Test',
    baseUrl: 'not-a-valid-url',
    environment: 'InvalidEnv',
  });
  if (invalidClient.success) throw new Error('Invalid client passed validation unexpectedly');
  console.log('✓ CreateClientSchema validated.');

  // 3. Service Master Row Schema
  const validService = ServiceMasterRowSchema.safeParse({
    serviceCode: 'SRV-100',
    serviceName: 'Cardiology Consultation',
    category: 'Consultation',
    department: 'Cardiology',
    unitPrice: 250.00,
    isActive: true,
  });
  if (!validService.success) throw new Error(`Valid service row failed: ${JSON.stringify(validService.error)}`);

  const invalidService = ServiceMasterRowSchema.safeParse({
    serviceCode: '',
    serviceName: '',
    category: '',
    department: '',
    unitPrice: -50,
  });
  if (invalidService.success) throw new Error('Negative price / empty service passed unexpectedly');
  console.log('✓ ServiceMasterRowSchema validated.');

  // 4. URL Resolver & Dynamic Client Role Architecture Tests
  console.log('--- Testing Dynamic Client Role URL Architecture & Normalization ---');

  // Test 1: Base URL without trailing slash
  const roleUrl1 = resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3' });
  if (roleUrl1 !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 1 Failed: Expected https://staging.simplexworld.com/MasterV9.3/addUserRole, got ${roleUrl1}`);
  }
  console.log('✓ TEST 1: Base URL without trailing slash resolves correctly.');

  // Test 2: Base URL with trailing slash
  const roleUrl2 = resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3/' });
  if (roleUrl2 !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 2 Failed: Expected https://staging.simplexworld.com/MasterV9.3/addUserRole, got ${roleUrl2}`);
  }
  console.log('✓ TEST 2: Base URL with trailing slash removes trailing slash safely.');

  // Test 3: URL already ending in /addUserRole
  const roleUrl3 = resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3/addUserRole' });
  if (roleUrl3 !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 3 Failed: Duplicate route appended: ${roleUrl3}`);
  }
  console.log('✓ TEST 3: URL already ending in /addUserRole is not duplicated.');

  // Test 4: Client-specific version such as MasterV10.18
  const roleUrl4 = resolveClientRoleUrl({ baseUrl: 'https://client1.example.com/MasterV10.18' });
  if (roleUrl4 !== 'https://client1.example.com/MasterV10.18/addUserRole') {
    throw new Error(`Test 4 Failed: Expected https://client1.example.com/MasterV10.18/addUserRole, got ${roleUrl4}`);
  }
  console.log('✓ TEST 4: Client-specific version MasterV10.18 preserved.');

  // Test 5: URL containing a port
  const roleUrl5 = resolveClientRoleUrl({ baseUrl: 'http://192.168.1.100:8080/MasterV9.3' });
  if (roleUrl5 !== 'http://192.168.1.100:8080/MasterV9.3/addUserRole') {
    throw new Error(`Test 5 Failed: Port not preserved: ${roleUrl5}`);
  }
  console.log('✓ TEST 5: Custom port (8080) preserved correctly.');

  // Test 6: URL containing an additional application context
  const roleUrl6 = resolveClientRoleUrl({ baseUrl: 'https://hospital.example.com/HMC/MasterV9.4' });
  if (roleUrl6 !== 'https://hospital.example.com/HMC/MasterV9.4/addUserRole') {
    throw new Error(`Test 6 Failed: Context path not preserved: ${roleUrl6}`);
  }
  console.log('✓ TEST 6: Application context (/HMC/MasterV9.4) preserved.');

  // Test 7: Client-specific route override
  const roleUrl7 = resolveClientRoleUrl({
    baseUrl: 'https://staging.simplexworld.com/MasterV9.3',
    userRoleRoute: '/customRoleMaster',
  });
  if (roleUrl7 !== 'https://staging.simplexworld.com/MasterV9.3/customRoleMaster') {
    throw new Error(`Test 7 Failed: Custom route override not applied: ${roleUrl7}`);
  }
  console.log('✓ TEST 7: Client-specific route override (/customRoleMaster) applied.');

  // Test 8: Missing base URL
  let missingError = false;
  try {
    resolveClientRoleUrl({ baseUrl: '' });
  } catch (err: any) {
    if (err.message.includes('MISSING_CLIENT_URL')) missingError = true;
  }
  if (!missingError) throw new Error('Test 8 Failed: Expected MISSING_CLIENT_URL exception');
  console.log('✓ TEST 8: Missing base URL throws MISSING_CLIENT_URL.');

  // Test 9: Invalid URL
  let invalidError = false;
  try {
    resolveClientRoleUrl({ baseUrl: 'not-a-valid-url' });
  } catch (err: any) {
    if (err.message.includes('INVALID_CLIENT_URL')) invalidError = true;
  }
  if (!invalidError) throw new Error('Test 9 Failed: Expected INVALID_CLIENT_URL exception');
  console.log('✓ TEST 9: Invalid URL throws INVALID_CLIENT_URL.');

  // Test 10: Host mismatch after redirect
  const redirectOk = validateRedirectHost('https://staging.simplexworld.com/MasterV9.3/login', 'https://staging.simplexworld.com/MasterV9.3/dashboard');
  if (!redirectOk.isValid) throw new Error('Test 10 Failed: Valid same-host redirect rejected');

  const redirectBad = validateRedirectHost('https://staging.simplexworld.com/MasterV9.3/login', 'https://evil-untrusted-host.com/login');
  if (redirectBad.isValid || !redirectBad.error?.includes('HOST_MISMATCH_AFTER_REDIRECT')) {
    throw new Error('Test 10 Failed: Untrusted cross-host redirect was not rejected');
  }
  console.log('✓ TEST 10: Host mismatch after redirect safely detected and rejected.');

  // Test 11: Login URL provided instead of application base URL
  const roleUrl11 = resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3/login' });
  if (roleUrl11 !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 11 Failed: Expected https://staging.simplexworld.com/MasterV9.3/addUserRole, got ${roleUrl11}`);
  }
  console.log('✓ TEST 11: Base URL derived safely from login URL.');

  // Test 12: Prevention of duplicate /addUserRole
  const roleUrl12 = resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3/addUserRole/' });
  if (roleUrl12 !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 12 Failed: Duplicate /addUserRole appended: ${roleUrl12}`);
  }
  console.log('✓ TEST 12: Prevention of duplicate /addUserRole validated.');

  // Test 13: Two different clients using different base URLs
  const clientA_Role = resolveClientRoleUrl({ baseUrl: 'https://clienta.hospital.com/MasterV9.3' });
  const clientB_Role = resolveClientRoleUrl({ baseUrl: 'https://clientb.clinic.org/MasterV10.2' });
  if (clientA_Role !== 'https://clienta.hospital.com/MasterV9.3/addUserRole' ||
      clientB_Role !== 'https://clientb.clinic.org/MasterV10.2/addUserRole') {
    throw new Error(`Test 13 Failed: clientA=${clientA_Role}, clientB=${clientB_Role}`);
  }
  if ((clientA_Role as string) === (clientB_Role as string)) throw new Error('Test 13 Failed: Client A and Client B URLs must never match');
  console.log('✓ TEST 13: Distinct clients resolve isolated Role Master URLs.');

  // Test 13A: Base URL without context path
  const noContextRole = resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com' });
  if (noContextRole !== 'https://staging.simplexworld.com/addUserRole') {
    throw new Error(`Test 13A Failed: Expected https://staging.simplexworld.com/addUserRole, got ${noContextRole}`);
  }
  console.log('✓ TEST 13A: Base URL without context path resolves endpoint correctly.');

  // Test 13B: Base URL with context path
  const withContextRole = resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3' });
  if (withContextRole !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 13B Failed: Expected https://staging.simplexworld.com/MasterV9.3/addUserRole, got ${withContextRole}`);
  }
  console.log('✓ TEST 13B: Base URL with context path preserves context and appends endpoint.');

  // Test 13C: Base URL with trailing slash (without context and with context)
  const noContextTrailing = resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/' });
  const withContextTrailing = resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3/' });
  if (noContextTrailing !== 'https://staging.simplexworld.com/addUserRole' ||
      withContextTrailing !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 13C Failed: trailing slash handling failed: noContext=${noContextTrailing}, withContext=${withContextTrailing}`);
  }
  console.log('✓ TEST 13C: Trailing slash stripped safely with or without context path.');

  // Test 13D: Base URL without trailing slash
  const withoutTrailing = resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3' });
  if (withoutTrailing !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 13D Failed: Expected https://staging.simplexworld.com/MasterV9.3/addUserRole, got ${withoutTrailing}`);
  }
  console.log('✓ TEST 13D: Base URL without trailing slash appends endpoint exactly once.');

  // Test 13E: Prevention of duplicate /MasterV9.3/MasterV9.3/... when route specifies context path
  const duplicateContextRoute1 = resolveClientRoleUrl({
    baseUrl: 'https://staging.simplexworld.com/MasterV9.3',
    userRoleRoute: '/MasterV9.3/addUserRole',
  });
  const duplicateContextRoute2 = resolveClientRoleUrl({
    baseUrl: 'https://staging.simplexworld.com/MasterV9.3/',
    userRoleRoute: 'https://staging.simplexworld.com/MasterV9.3/addUserRole',
  });
  if (duplicateContextRoute1 !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole' ||
      duplicateContextRoute2 !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 13E Failed: Duplicate context generated: r1=${duplicateContextRoute1}, r2=${duplicateContextRoute2}`);
  }
  console.log('✓ TEST 13E: Prevention of duplicate /MasterV9.3/MasterV9.3/... validated.');

  // Test 13F: Targeted URL Resolution with exact baseUrl & route /addUserRole
  const t13fBaseUrl = 'https://staging.simplexworld.com/MasterV9.3';
  const t13fRoute = '/addUserRole';
  const t13fConstructed = new URL('addUserRole', ensureTrailingSlash(t13fBaseUrl)).toString();
  const t13fResolved = resolveClientRoleUrl({ baseUrl: t13fBaseUrl, userRoleRoute: t13fRoute });
  if (t13fConstructed !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 13F Failed: Expected https://staging.simplexworld.com/MasterV9.3/addUserRole from new URL, got ${t13fConstructed}`);
  }
  if (t13fResolved !== 'https://staging.simplexworld.com/MasterV9.3/addUserRole') {
    throw new Error(`Test 13F Failed: Expected https://staging.simplexworld.com/MasterV9.3/addUserRole from resolveClientRoleUrl, got ${t13fResolved}`);
  }
  if (DEFAULT_ROLE_MAPPING_ROUTE !== '/addUserRole') {
    throw new Error(`Test 13F Failed: Expected DEFAULT_ROLE_MAPPING_ROUTE to be /addUserRole, got ${DEFAULT_ROLE_MAPPING_ROUTE}`);
  }
  console.log('✓ TEST 13F: Direct proof: baseUrl = https://staging.simplexworld.com/MasterV9.3 + /addUserRole -> https://staging.simplexworld.com/MasterV9.3/addUserRole.');

  // Test 13G: Application of same endpoint-append rule to /userRole, /users, and /addUsers
  const t13gUserRole = resolveClientRoute({ baseUrl: t13fBaseUrl, route: '/userRole' });
  const t13gUsers = resolveClientRoute({ baseUrl: t13fBaseUrl, route: '/users' });
  const t13gAddUsers = resolveClientRoute({ baseUrl: t13fBaseUrl, route: '/addUsers' });
  if (t13gUserRole !== 'https://staging.simplexworld.com/MasterV9.3/userRole') {
    throw new Error(`Test 13G Failed: Expected /userRole endpoint, got ${t13gUserRole}`);
  }
  if (t13gUsers !== 'https://staging.simplexworld.com/MasterV9.3/users') {
    throw new Error(`Test 13G Failed: Expected /users endpoint, got ${t13gUsers}`);
  }
  if (t13gAddUsers !== 'https://staging.simplexworld.com/MasterV9.3/addUsers') {
    throw new Error(`Test 13G Failed: Expected /addUsers endpoint, got ${t13gAddUsers}`);
  }
  console.log('✓ TEST 13G: Endpoint-append rule verified for /userRole, /users, and /addUsers.');

  // Test 13H: Rejection tests proving /MasterV9.3/MasterV9.3/ never appears under any combination
  const t13hUrlsToTest = [
    resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3', userRoleRoute: '/addUserRole' }),
    resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3', userRoleRoute: '/MasterV9.3/addUserRole' }),
    resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3/', userRoleRoute: '/MasterV9.3/addUserRole' }),
    resolveClientRoleUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3', applicationPath: '/MasterV9.3', userRoleRoute: '/addUserRole' }),
    resolveClientRoute({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3', route: '/MasterV9.3/addUserRole' }),
    resolveClientRoute({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3', applicationPath: '/MasterV9.3', route: '/addUserRole' }),
    resolveClientRoute({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3', route: '/MasterV9.3/users' }),
    resolveClientRoute({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3', route: '/MasterV9.3/addUsers' }),
    resolveClientRoute({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3', route: '/MasterV9.3/userRole' }),
  ];

  for (const url of t13hUrlsToTest) {
    if (url.includes('/MasterV9.3/MasterV9.3/')) {
      throw new Error(`Test 13H Rejection Test Failed: Duplicate /MasterV9.3/MasterV9.3/ detected in '${url}'`);
    }
    const versionCount = (url.match(/\/MasterV9\.3/g) || []).length;
    if (versionCount > 1) {
      throw new Error(`Test 13H Rejection Test Failed: /MasterV9.3 appeared ${versionCount} times in '${url}'`);
    }
  }
  console.log('✓ TEST 13H: Strict rejection test passed: /MasterV9.3/MasterV9.3/ never appears under any permutation.');

  // 5. Shared Role Parser Architecture & Comma-Separated Multi-Role Tests
  console.log('--- Testing Shared Role Parser Architecture & Multi-Role Validation ---');
  const liveRoles = ['ACCUMED', 'FRONT DESK', 'REPORTS', 'ADMIN', 'DOCTOR', 'NURSE'];

  // Test 14: Single role
  const r14 = parseAndValidateRoles('ACCUMED', liveRoles);
  if (!r14.isValid || r14.validRoles.length !== 1 || r14.validRoles[0] !== 'ACCUMED') {
    throw new Error(`Test 14 Failed: ${JSON.stringify(r14)}`);
  }
  console.log('✓ TEST 14: Single role parsed and validated correctly.');

  // Test 15: Plain comma-separated text without spaces (The exact reported defect: ACCUMED,FRONT DESK,REPORTS)
  const r15 = parseAndValidateRoles('ACCUMED,FRONT DESK,REPORTS', liveRoles);
  if (!r15.isValid || r15.validRoles.length !== 3 || r15.invalidRoles.length !== 0 ||
      r15.validRoles[0] !== 'ACCUMED' || r15.validRoles[1] !== 'FRONT DESK' || r15.validRoles[2] !== 'REPORTS') {
    throw new Error(`Test 15 Failed: ${JSON.stringify(r15)}`);
  }
  console.log('✓ TEST 15: Plain comma-separated text (ACCUMED,FRONT DESK,REPORTS) parsed into 3 distinct roles.');

  // Test 16: Comma-separated text with spaces
  const r16 = parseAndValidateRoles('ACCUMED, FRONT DESK, REPORTS', liveRoles);
  if (!r16.isValid || r16.validRoles.length !== 3 || r16.validRoles[1] !== 'FRONT DESK') {
    throw new Error(`Test 16 Failed: ${JSON.stringify(r16)}`);
  }
  console.log('✓ TEST 16: Comma-separated text with spaces trimmed and validated.');

  // Test 17: Comma-separated text with double quotes
  const r17 = parseAndValidateRoles('"ACCUMED","FRONT DESK","REPORTS"', liveRoles);
  if (!r17.isValid || r17.validRoles.length !== 3 || r17.validRoles[0] !== 'ACCUMED') {
    throw new Error(`Test 17 Failed: ${JSON.stringify(r17)}`);
  }
  console.log('✓ TEST 17: Quoted comma-separated text parsed cleanly.');

  // Test 18: Comma-separated text with empty tokens and double commas
  const r18 = parseAndValidateRoles('ACCUMED,,FRONT DESK,,REPORTS', liveRoles);
  if (!r18.isValid || r18.validRoles.length !== 3) {
    throw new Error(`Test 18 Failed: ${JSON.stringify(r18)}`);
  }
  console.log('✓ TEST 18: Empty tokens and double commas safely filtered.');

  // Test 19: Case-insensitive canonical mapping
  const r19 = parseAndValidateRoles('accumed, front desk, reports', liveRoles);
  if (!r19.isValid || r19.validRoles[0] !== 'ACCUMED' || r19.validRoles[1] !== 'FRONT DESK') {
    throw new Error(`Test 19 Failed: Canonical casing not applied: ${JSON.stringify(r19)}`);
  }
  console.log('✓ TEST 19: Case-insensitive input mapped to canonical live role casing.');

  // Test 20: Invalid role among valid roles
  const r20 = parseAndValidateRoles('ACCUMED, INVALID_ROLE_NAME, REPORTS', liveRoles);
  if (r20.isValid || r20.invalidRoles.length !== 1 || r20.invalidRoles[0] !== 'INVALID_ROLE_NAME' || r20.validRoles.length !== 2) {
    throw new Error(`Test 20 Failed: Expected invalid role detection: ${JSON.stringify(r20)}`);
  }
  console.log('✓ TEST 20: Invalid role isolated without rejecting valid roles.');

  // Test 21: Duplicate tokens deduplicated preserving order
  const r21 = parseAndValidateRoles('ACCUMED, ACCUMED, FRONT DESK', liveRoles);
  if (!r21.isValid || r21.validRoles.length !== 2 || r21.validRoles[0] !== 'ACCUMED' || r21.validRoles[1] !== 'FRONT DESK') {
    throw new Error(`Test 21 Failed: Deduplication failed: ${JSON.stringify(r21)}`);
  }
  console.log('✓ TEST 21: Duplicate tokens deduplicated safely.');

  // Test 22: Null, undefined, empty string handling
  const r22a = parseAndValidateRoles('', liveRoles);
  const r22b = parseAndValidateRoles(null, liveRoles);
  const r22c = parseAndValidateRoles(undefined, liveRoles);
  if (!r22a.isValid || r22a.validRoles.length !== 0 || !r22b.isValid || !r22c.isValid) {
    throw new Error('Test 22 Failed: Empty inputs failed');
  }
  console.log('✓ TEST 22: Empty, null, and undefined inputs handled safely.');

  // --- Testing Cryptographic Event ID Validation and SHA-256 Hashing ---
  console.log('\n--- Testing Cryptographic Event ID Validation & SHA-256 Hashing ---');

  // Test 23: Valid 64-character hex event ID
  const validEventId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  if (!isValidOneTimeEventId(validEventId)) {
    throw new Error('Test 23 Failed: Valid 64-hex event ID returned false');
  }
  assertValidOneTimeEventId(validEventId);
  const validHash = computeOneTimeEventIdHash(validEventId);
  if (validHash.length !== 64 || validHash === SHA256_EMPTY_DIGEST || validHash === validEventId) {
    throw new Error(`Test 23 Failed: Invalid hash computed: ${validHash}`);
  }
  console.log('✓ TEST 23: Valid 64-hex event ID passes validation and computes non-empty SHA-256 hash.');

  // Test 24: Rejection of invalid inputs (empty, whitespace, non-hex, wrong length, all-zero)
  const invalidInputs = [
    undefined,
    null,
    '',
    '   ',
    'a1b2c3d4e5f60718293a4b5c6d7e8f90', // 32 chars
    'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9', // 63 chars
    'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f900', // 65 chars
    'g'.repeat(64), // non-hex
    '0'.repeat(64), // all-zero
    'job-uuid-12345-not-an-event-id',
    12345,
    true,
    {},
  ];

  for (const inv of invalidInputs) {
    if (isValidOneTimeEventId(inv)) {
      throw new Error(`Test 24 Failed: Invalid input was accepted: ${JSON.stringify(inv)}`);
    }
    let threw = false;
    try {
      assertValidOneTimeEventId(inv);
    } catch (err: any) {
      if (err.message === 'EPHEMERAL_EVENT_ID_INVALID') threw = true;
    }
    if (!threw) {
      throw new Error(`Test 24 Failed: assertValidOneTimeEventId did not throw EPHEMERAL_EVENT_ID_INVALID for: ${JSON.stringify(inv)}`);
    }
  }
  console.log('✓ TEST 24: Invalid event ID inputs (undefined, null, empty, short, non-hex, all-zero, wrong type) strictly rejected.');

  // Test 25: Verification of SHA256_EMPTY_DIGEST constant
  if (SHA256_EMPTY_DIGEST !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') {
    throw new Error('Test 25 Failed: SHA256_EMPTY_DIGEST mismatch');
  }
  console.log('✓ TEST 25: SHA256_EMPTY_DIGEST constant strictly matches e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.');

  // Test 26: 10,000 generated event IDs for uniqueness and non-empty hash
  const genSet = new Set<string>();
  const hashSet = new Set<string>();

  for (let i = 0; i < 10000; i++) {
    const id = crypto.randomBytes(32).toString('hex');
    assertValidOneTimeEventId(id);
    if (genSet.has(id)) {
      throw new Error(`Test 26 Failed: Duplicate event ID generated at index ${i}`);
    }
    genSet.add(id);

    const h = computeOneTimeEventIdHash(id);
    if (h === SHA256_EMPTY_DIGEST) {
      throw new Error(`Test 26 Failed: SHA256_EMPTY_DIGEST generated for ID at index ${i}`);
    }
    if (h === id || h.length !== 64) {
      throw new Error(`Test 26 Failed: Invalid hash generated at index ${i}`);
    }
    hashSet.add(h);
  }
  if (genSet.size !== 10000 || hashSet.size !== 10000) {
    throw new Error('Test 26 Failed: Set size mismatch');
  }
  console.log('✓ TEST 26: 10,000 generated 256-bit event IDs verified (0 duplicates, 0 empty digests, 0 all-zeroes).');

  // --- Testing Client Resource URLs, Schemas & Permissions ---
  console.log('\n--- Testing Client Resource URLs, Schemas & Permissions ---');

  // Test 27: Resource URL Resolver (Defaults to /addResourceParentDetails)
  const resUrl1 = resolveClientResourceUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3' });
  if (resUrl1 !== 'https://staging.simplexworld.com/MasterV9.3/addResourceParentDetails') {
    throw new Error(`Test 27 Failed: Expected /addResourceParentDetails, got ${resUrl1}`);
  }
  const resUrl2 = resolveClientResourceUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3', quickResourceRoute: '/customResource' });
  if (resUrl2 !== 'https://staging.simplexworld.com/MasterV9.3/customResource') {
    throw new Error(`Test 27 Failed: Custom quickResourceRoute not resolved properly: ${resUrl2}`);
  }
  console.log('✓ TEST 27: resolveClientResourceUrl correctly resolves /addResourceParentDetails and custom routes.');

  // Test 28: Resource User Mapping URL Resolver (Defaults to /addParentResourceUser)
  const mapUrl1 = resolveClientResourceUserMappingUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3' });
  if (mapUrl1 !== 'https://staging.simplexworld.com/MasterV9.3/addParentResourceUser') {
    throw new Error(`Test 28 Failed: Expected /addParentResourceUser, got ${mapUrl1}`);
  }
  const mapUrl2 = resolveClientResourceUserMappingUrl({ baseUrl: 'https://staging.simplexworld.com/MasterV9.3', resourceUserRoute: '/customMapping' });
  if (mapUrl2 !== 'https://staging.simplexworld.com/MasterV9.3/customMapping') {
    throw new Error(`Test 28 Failed: Custom resourceUserRoute not resolved: ${mapUrl2}`);
  }
  console.log('✓ TEST 28: resolveClientResourceUserMappingUrl correctly resolves /addParentResourceUser and custom routes.');

  // Test 29: CreateQuickResourceSchema Validation
  const validResDto = CreateClientResourceSchema.safeParse({
    clientId: 'e6371c6d-3183-4a7b-a3d8-e3cf14a1a9e5',
    resourceName: 'Dr. Tariq Al-Mansoor',
    isResourceHuman: true,
    resourceType: 'Consultant Physician',
    specialty: 'Cardiology',
    departments: 'ALL',
    services: 'ALL',
  });
  if (!validResDto.success) throw new Error(`Test 29 Failed: Valid resource DTO rejected: ${JSON.stringify(validResDto.error)}`);

  const invalidResDto = CreateClientResourceSchema.safeParse({
    clientId: 'invalid',
    resourceName: '',
  });
  if (invalidResDto.success) throw new Error('Test 29 Failed: Invalid resource DTO accepted');
  console.log('✓ TEST 29: CreateClientResourceSchema validates valid and invalid payloads.');

  // Test 30: MapResourceUserSchema and SetClientResourceStatusSchema
  const validMap = MapResourceUserSchema.safeParse({
    clientId: 'e6371c6d-3183-4a7b-a3d8-e3cf14a1a9e5',
    remoteResourceId: 'REM-DOC-01',
    remoteUserId: 'REM-USR-01',
    username: 'dr_tariq',
    isShownInRegistration: true,
  });
  if (!validMap.success) throw new Error('Test 30 Failed: Valid user mapping rejected');
  const validStat = SetClientResourceStatusSchema.safeParse({
    clientId: 'e6371c6d-3183-4a7b-a3d8-e3cf14a1a9e5',
    remoteResourceId: 'REM-01',
    status: 'INACTIVE',
  });
  if (!validStat.success) throw new Error('Test 30 Failed: Valid status update rejected');
  console.log('✓ TEST 30: MapResourceUserSchema and SetClientResourceStatusSchema verified.');

  // Test 31: Resource Permissions Constant Check
  if (!PERMISSIONS.CLIENT_RESOURCES_VIEW || !PERMISSIONS.CLIENT_RESOURCES_CREATE || !PERMISSIONS.CLIENT_RESOURCES_SYNC || !PERMISSIONS.CLIENT_RESOURCE_USER_MAP) {
    throw new Error('Test 31 Failed: Resource permissions missing from PERMISSIONS constant');
  }
  console.log('✓ TEST 31: CLIENT_RESOURCES_* permissions constant correctly registered.');

  // Test 32: 10-Sheet Workbook Generation & Client Mismatch Protection
  console.log('\n--- Testing 10-Sheet Workbook Generation & Validation ---');
  const testClientId = 'e6371c6d-3183-4a7b-a3d8-e3cf14a1a9e5';
  const wbBuffer = generateResourceImportWorkbook({
    clientId: testClientId,
    clientCode: 'CLI_TEST',
    clientName: 'Test Hospital',
  });
  if (!wbBuffer || wbBuffer.length === 0) throw new Error('Test 32 Failed: Workbook generation failed');

  const parsedWb = parseAndValidateResourceWorkbook(wbBuffer, testClientId);
  if (!parsedWb.isValid || parsedWb.validRows.length !== 2) {
    throw new Error(`Test 32 Failed: Valid workbook failed validation (expected 2 valid rows): ${JSON.stringify(parsedWb)}`);
  }

  // Client Mismatch check
  const mismatchCheck = parseAndValidateResourceWorkbook(wbBuffer, 'different-client-id');
  if (!mismatchCheck.clientMismatch) {
    throw new Error('Test 32 Failed: Client mismatch was not detected');
  }
  // Test 33: EMR Panel URL Resolution across MasterV9.3, MasterV9.4, MasterV9.5, and HMC
  console.log('\n--- Testing EMR Panel and eClaim URL Dynamic Resolution ---');
  const emrHosts = [
    { base: 'https://staging.simplexworld.com/MasterV9.3', expected: 'https://staging.simplexworld.com/MasterV9.3/emrPanelSelection' },
    { base: 'https://hospital.example.com/HMC', expected: 'https://hospital.example.com/HMC/emrPanelSelection' },
    { base: 'https://hospital.example.com/MasterV9.4', expected: 'https://hospital.example.com/MasterV9.4/emrPanelSelection' },
    { base: 'https://hospital.example.com/MasterV9.5', expected: 'https://hospital.example.com/MasterV9.5/emrPanelSelection' },
  ];
  for (const item of emrHosts) {
    const res = resolveClientEmrPanelUrl({ baseUrl: item.base });
    if (res !== item.expected) {
      throw new Error(`Test 33 Failed: Expected ${item.expected}, got ${res}`);
    }
  }
  console.log('✓ TEST 33: resolveClientEmrPanelUrl dynamically resolves /emrPanelSelection correctly across MasterV9.3, HMC, MasterV9.4, and MasterV9.5.');

  // Test 34: eClaim User URL Resolution
  const eclaimHosts = [
    { base: 'https://staging.simplexworld.com/MasterV9.3', expected: 'https://staging.simplexworld.com/MasterV9.3/addUserEclaim' },
    { base: 'https://hospital.example.com/HMC', expected: 'https://hospital.example.com/HMC/addUserEclaim' },
  ];
  for (const item of eclaimHosts) {
    const res = resolveClientEclaimUserUrl({ baseUrl: item.base });
    if (res !== item.expected) {
      throw new Error(`Test 34 Failed: Expected ${item.expected}, got ${res}`);
    }
  }
  const customEclaim = resolveClientEclaimUserUrl({
    baseUrl: 'https://staging.simplexworld.com/MasterV9.3',
    eclaimUserRoute: '/eclaimUser',
  });
  if (customEclaim !== 'https://staging.simplexworld.com/MasterV9.3/eclaimUser') {
    throw new Error(`Test 34 Failed: Expected custom route /eclaimUser, got ${customEclaim}`);
  }
  console.log('✓ TEST 34: resolveClientEclaimUserUrl resolves default and client-specific routes safely.');

  // Test 35: All Six Stages Dynamic Routes Deduplication Invariant
  const baseStaging = 'https://staging.simplexworld.com/MasterV9.3';
  const stageEndpoints = [
    '/addResourceParentDetails',
    '/addUsers',
    '/addParentResourceUser',
    '/addUserRole',
    '/emrPanelSelection',
    '/addUserEclaim',
  ];
  for (const ep of stageEndpoints) {
    const resolved = resolveClientRoute({ baseUrl: baseStaging, route: ep });
    if (resolved.includes('/MasterV9.3/MasterV9.3/')) {
      throw new Error(`Test 35 Failed: Duplicated application context detected for ${ep}: ${resolved}`);
    }
    const expected = `${baseStaging}${ep}`;
    if (resolved !== expected) {
      throw new Error(`Test 35 Failed: Expected ${expected}, got ${resolved}`);
    }
  }
  console.log('✓ TEST 35: All six operational routes append cleanly with strictly zero application context duplication.');

  // Test 36: 6-Sheet Integrated Master Workbook Multi-Section Parsing
  console.log('\n--- Testing 6-Sheet Integrated Master Workbook Generation & Correlation ---');
  const integratedWb = generateResourceImportWorkbook({
    clientId: testClientId,
    clientCode: 'CLI_INTEGRATED',
    clientName: 'Integrated Clinic',
    format: '6-SHEET',
  });
  const parsedIntegrated = parseAndValidateResourceWorkbook(integratedWb, testClientId);
  if (!parsedIntegrated.isValid || parsedIntegrated.validRows.length !== 2) {
    throw new Error(`Test 36 Failed: Expected 2 valid rows in 6-sheet workbook: ${JSON.stringify(parsedIntegrated.invalidRows)}`);
  }
  const row1 = parsedIntegrated.validRows[0].data;
  if (!row1.username || row1.username !== 'dr_tariq_m') {
    throw new Error(`Test 36 Failed: Associated User data was not correlated properly: ${JSON.stringify(row1)}`);
  }
  console.log('✓ TEST 36: 6-Sheet Integrated Master Workbook generated and correlated across all sheets successfully.');

  console.log('\nAll shared schema, URL architecture, Role Parser, Resource & Event-ID cryptographic tests passed successfully!');
}

runSchemaTests();

