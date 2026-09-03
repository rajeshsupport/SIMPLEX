import {
  LoginRequestSchema,
  CreateClientSchema,
  ServiceMasterRowSchema,
  UserImportRowSchema,
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

  console.log('All shared schema tests passed successfully!');
}

runSchemaTests();
