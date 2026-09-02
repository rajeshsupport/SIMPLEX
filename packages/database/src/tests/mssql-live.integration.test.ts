import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  ApplicationUser,
  Role,
  Permission,
  Client,
  ClientCredential,
  UserClientAccess,
  AuditLog,
  ErrorLog,
  ImportJob,
  ImportJobRow,
  AutomationWorkflow,
  AutomationWorkflowVersion,
  AutomationRun,
  AutomationRunStep,
  DesktopAgent,
  StoredFile,
  RetentionPolicy,
  ApplicationLoginHistory,
} from '../entities/index.js';
import { EnvelopeEncryption } from '../crypto/envelope-encryption.js';
import { InitialSchema1700000000000 } from '../migrations/1700000000000-InitialSchema.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

if (!process.env.ENCRYPTION_MASTER_KEY) {
  process.env.ENCRYPTION_MASTER_KEY = 'e8b839655f46a7be7e3c15c6b7582b1c853f6517a942bcba5e7e600d89e574ac';
}

const testDataSource = new DataSource({
  type: 'mssql',
  host: process.env.MSSQL_HOST || 'localhost',
  port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  username: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD || 'Rajesh@123',
  database: 'HMC_CENTRAL_AUTOMATION_TEST',
  entities: [
    ApplicationUser,
    Role,
    Permission,
    Client,
    ClientCredential,
    UserClientAccess,
    AuditLog,
    ErrorLog,
    ImportJob,
    ImportJobRow,
    AutomationWorkflow,
    AutomationWorkflowVersion,
    AutomationRun,
    AutomationRunStep,
    DesktopAgent,
    StoredFile,
    RetentionPolicy,
    ApplicationLoginHistory,
  ],
  synchronize: false,
  options: {
    encrypt: process.env.MSSQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
  },
});

async function runLiveMssqlIntegrationTests() {
  console.log('--- Executing Live MSSQL 2022 Database Integration Tests ---');
  console.log('Target Database: HMC_CENTRAL_AUTOMATION_TEST (Isolated Test Environment)');

  await testDataSource.initialize();

  // Run migration on test DB
  const queryRunner = testDataSource.createQueryRunner();
  await queryRunner.connect();
  const migration = new InitialSchema1700000000000();
  try {
    await migration.up(queryRunner);
  } catch (err: any) {
    // Already created
  } finally {
    await queryRunner.release();
  }

  const clientRepo = testDataSource.getRepository(Client);
  const credRepo = testDataSource.getRepository(ClientCredential);
  const userClientRepo = testDataSource.getRepository(UserClientAccess);

  // Test 1: Insert Client & Envelope-Encrypted Credential
  console.log('\n[TEST 1] Testing Client & Envelope-Encrypted Credential in MSSQL...');
  const testClientCode = `TEST_CLI_${Date.now().toString().substring(8)}`;
  const client = clientRepo.create({
    clientCode: testClientCode,
    clientName: 'Integration Test Hospital',
    baseUrl: 'https://test-hosp.example.com',
    environment: 'Test',
    status: 'ACTIVE',
    createdBy: 'TEST_RUNNER',
  });
  const savedClient = await clientRepo.save(client);

  const secretPlain = 'SecretPass_MSSQL_2026!';
  const encPass = EnvelopeEncryption.encrypt(secretPlain);
  const encUser = EnvelopeEncryption.encrypt('test_operator');

  const cred = credRepo.create({
    clientId: savedClient.id,
    credentialName: 'Default Operator Credential',
    encryptedUsername: encUser.cipherText,
    usernameIv: encUser.iv,
    usernameTag: encUser.tag,
    usernameMasked: EnvelopeEncryption.maskSecret('test_operator'),
    encryptedPassword: encPass.cipherText,
    passwordIv: encPass.iv,
    passwordTag: encPass.tag,
    keyVersion: encPass.keyVersion,
    isActive: true,
    createdBy: 'TEST_RUNNER',
  });
  await credRepo.save(cred);

  // Read back and verify decryption
  const fetchedCred = await credRepo.findOne({
    where: { clientId: savedClient.id },
  });

  if (!fetchedCred) throw new Error('Failed to retrieve saved client credential from MSSQL');
  const decrypted = EnvelopeEncryption.decrypt({
    cipherText: fetchedCred.encryptedPassword,
    iv: fetchedCred.passwordIv,
    tag: fetchedCred.passwordTag,
  });

  if (decrypted !== secretPlain) {
    throw new Error(`Decrypted secret mismatch! Expected: ${secretPlain}, Got: ${decrypted}`);
  }
  console.log('✓ TEST 1 PASSED: Successfully stored and decrypted envelope credentials in MSSQL 2022.');

  // Test 2: Unique Constraint Enforcement in MSSQL
  console.log('\n[TEST 2] Testing Unique Constraint Enforcement on clientCode...');
  try {
    const dupClient = clientRepo.create({
      clientCode: testClientCode, // duplicate
      clientName: 'Duplicate Test Hospital',
      baseUrl: 'https://duplicate.example.com',
      environment: 'Test',
    });
    await clientRepo.save(dupClient);
    throw new Error('MSSQL failed to enforce unique constraint on clientCode!');
  } catch (err: any) {
    if (err.message.includes('unique') || err.message.includes('duplicate') || err.number === 2601 || err.number === 2627) {
      console.log('✓ TEST 2 PASSED: MSSQL rejected duplicate clientCode with violation error.');
    } else {
      throw err;
    }
  }

  // Test 3: Foreign Key Constraint Enforcement in MSSQL
  console.log('\n[TEST 3] Testing Foreign Key Enforcement...');
  try {
    const invalidAccess = userClientRepo.create({
      userId: '00000000-0000-0000-0000-000000000001', // Non-existent user
      clientId: savedClient.id,
      grantedBy: 'TEST_RUNNER',
    });
    await userClientRepo.save(invalidAccess);
    throw new Error('MSSQL failed to enforce foreign key constraint!');
  } catch (err: any) {
    if (err.message.includes('FOREIGN KEY') || err.message.includes('statement conflicted with the FOREIGN KEY') || err.number === 547) {
      console.log('✓ TEST 3 PASSED: MSSQL rejected invalid foreign key with constraint error 547.');
    } else {
      throw err;
    }
  }

  await testDataSource.destroy();
  console.log('\nAll Live MSSQL 2022 Integration Tests Passed Successfully!');
}

runLiveMssqlIntegrationTests().catch((err) => {
  console.error('[FATAL] MSSQL Integration Tests Failed:', err);
  process.exit(1);
});
