import crypto from 'node:crypto';
import {
  LoginRequestSchema,
  CreateClientSchema,
  ServiceMasterRowSchema,
  UserImportRowSchema,
  resolveClientRoute,
  resolveClientRoleUrl,
  normalizeClientBaseUrl,
  validateRedirectHost,
  parseAndValidateRoles,
  assertValidOneTimeEventId,
  isValidOneTimeEventId,
  computeOneTimeEventIdHash,
  SHA256_EMPTY_DIGEST,
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

  console.log('\nAll shared schema, URL architecture, Role Parser & Event-ID cryptographic tests passed successfully!');
}

runSchemaTests();
