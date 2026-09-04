import {
  LoginRequestSchema,
  CreateClientSchema,
  ServiceMasterRowSchema,
  UserImportRowSchema,
  resolveClientRoute,
  resolveClientRoleUrl,
  normalizeClientBaseUrl,
  validateRedirectHost,
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

  console.log('All shared schema & URL architecture tests passed successfully!');
}

runSchemaTests();
