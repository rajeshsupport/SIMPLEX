import {
  LoginRequestSchema,
  CreateClientSchema,
  ServiceMasterRowSchema,
  UserImportRowSchema,
  resolveClientRoute,
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

  // 4. URL Resolver & Duplicate-Version Prevention
  console.log('--- Testing URL Resolver & Duplicate-Version Prevention ---');
  const r1 = resolveClientRoute({
    baseUrl: 'https://staging.simplexworld.com',
    applicationPath: '/MasterV9.4',
    route: '/users',
  });
  if (r1 !== 'https://staging.simplexworld.com/MasterV9.4/users') throw new Error(`URL mismatch: ${r1}`);

  const r2 = resolveClientRoute({
    baseUrl: 'https://staging.simplexworld.com',
    applicationPath: '/MasterV9.4',
    route: '/login',
  });
  if (r2 !== 'https://staging.simplexworld.com/MasterV9.4/login') throw new Error(`URL mismatch: ${r2}`);

  const r3 = resolveClientRoute({
    baseUrl: 'https://staging.simplexworld.com/MasterV9.3',
    applicationPath: '/MasterV9.4',
    route: '/users',
  });
  if (r3 !== 'https://staging.simplexworld.com/MasterV9.4/users') throw new Error(`Duplicate version concatenation in r3: ${r3}`);

  const r4 = resolveClientRoute({
    baseUrl: 'https://staging.simplexworld.com/MasterV9.3/',
    applicationPath: '/MasterV9.4/',
    route: '/MasterV9.4/users',
  });
  if (r4 !== 'https://staging.simplexworld.com/MasterV9.4/users') throw new Error(`Duplicate version concatenation in r4: ${r4}`);

  const r5 = resolveClientRoute({
    baseUrl: 'https://staging.simplexworld.com',
    applicationPath: '',
    route: 'https://staging.simplexworld.com/MasterV9.3/MasterV9.4/login',
  });
  if (r5 !== 'https://staging.simplexworld.com/MasterV9.4/login') throw new Error(`Duplicate version in full URL r5: ${r5}`);

  console.log('✓ URL Resolver tests validated (zero duplicate version routes).');

  console.log('All shared tests passed successfully!');
}

runSchemaTests();
