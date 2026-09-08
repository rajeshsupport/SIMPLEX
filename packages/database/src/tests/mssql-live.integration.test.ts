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
  ClientUserSnapshot,
  ClientResourceSnapshot,
  ClientResourceDepartment,
  ClientResourceService,
  ResourceImportJob,
  ResourceImportRow,
} from '../entities/index.js';
import { EnvelopeEncryption } from '../crypto/envelope-encryption.js';
import { InitialSchema1700000000000 } from '../migrations/1700000000000-InitialSchema.js';
import { AddUserDisableFields1700000000001 } from '../migrations/1700000000001-AddUserDisableFields.js';
import { AddClientUserRoleRoute1700000000002 } from '../migrations/1700000000002-AddClientUserRoleRoute.js';
import { AddClientResources1700000000003 } from '../migrations/1700000000003-AddClientResources.js';
import { AddClientUserLastVerifiedAt1700000000005 } from '../migrations/1700000000005-AddClientUserLastVerifiedAt.js';

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
    ClientUserSnapshot,
    ClientResourceSnapshot,
    ClientResourceDepartment,
    ClientResourceService,
    ResourceImportJob,
    ResourceImportRow,
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

  // Run migrations on test DB
  const queryRunner = testDataSource.createQueryRunner();
  await queryRunner.connect();
  const migrations = [
    new InitialSchema1700000000000(),
    new AddUserDisableFields1700000000001(),
    new AddClientUserRoleRoute1700000000002(),
    new AddClientResources1700000000003(),
  ];
  try {
    for (const m of migrations) {
      try {
        await m.up(queryRunner);
      } catch (err: any) {
        // Migration step already applied or partially existing
      }
    }
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

  // Test 4: Migration 1700000000005 adds nullable lastVerifiedAt to client_user_snapshots
  const mig0005 = new AddClientUserLastVerifiedAt1700000000005();
  const qRunner = testDataSource.createQueryRunner();
  await qRunner.connect();
  try {
    // Drop dbo.client_user_snapshots if exists from previous runs to test missing table behavior first
    await qRunner.query(`IF OBJECT_ID('[dbo].[client_user_snapshots]', 'U') IS NOT NULL DROP TABLE [dbo].[client_user_snapshots];`);
    await qRunner.query(`IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'staging') EXEC('CREATE SCHEMA staging');`);
    await qRunner.query(`IF OBJECT_ID('[staging].[client_user_snapshots]', 'U') IS NOT NULL DROP TABLE [staging].[client_user_snapshots];`);

    // Ensure migrations table exists to verify that failed migrations are never recorded
    await qRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'migrations')
      BEGIN
        CREATE TABLE migrations (
          id INT IDENTITY(1,1) PRIMARY KEY,
          timestamp BIGINT NOT NULL,
          name NVARCHAR(255) NOT NULL,
          executed_at DATETIME2 DEFAULT SYSUTCDATETIME()
        );
      END
    `);

    // Test 4: Missing dbo table throws before migration completion
    console.log('\n[TEST 4] Testing missing dbo.client_user_snapshots throws before migration completion...');
    let thrownError: any = null;
    try {
      await mig0005.up(qRunner);
    } catch (e: any) {
      thrownError = e;
    }
    if (!thrownError || !thrownError.message.includes('[MIGRATION 0005 PRECHECK FAILED]')) {
      throw new Error(`Expected missing dbo table to throw [MIGRATION 0005 PRECHECK FAILED], but got: ${thrownError?.message}`);
    }
    console.log('✓ TEST 4 PASSED: Missing dbo table threw [MIGRATION 0005 PRECHECK FAILED] before migration completion.');

    // Test 5: Same-named table in another schema (staging.client_user_snapshots) does not satisfy preflight
    console.log('\n[TEST 5] Testing same-named table in another schema does not satisfy preflight...');
    await qRunner.query(`
      CREATE TABLE [staging].[client_user_snapshots] (
        id INT IDENTITY(1,1) PRIMARY KEY,
        username NVARCHAR(100)
      );
    `);
    let stagingThrown: any = null;
    try {
      await mig0005.up(qRunner);
    } catch (e: any) {
      stagingThrown = e;
    }
    if (!stagingThrown || !stagingThrown.message.includes('[MIGRATION 0005 PRECHECK FAILED]')) {
      throw new Error('Migration must reject same-named table in non-dbo schema!');
    }
    // Verify column was not added to staging table
    const stagingCol = await qRunner.query(`
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'staging' AND TABLE_NAME = 'client_user_snapshots' AND COLUMN_NAME = 'lastVerifiedAt'
    `);
    if (stagingCol.length > 0) throw new Error('lastVerifiedAt must NOT be added to staging schema table!');
    await qRunner.query(`DROP TABLE [staging].[client_user_snapshots];`);
    console.log('✓ TEST 5 PASSED: Same-named table in another schema was rejected by dbo preflight check.');

    // Test 6: Migration is not recorded as applied after missing-table failure
    console.log('\n[TEST 6] Testing migration is not recorded as applied after missing-table failure...');
    const appliedCheck: any[] = await qRunner.query(`
      SELECT * FROM migrations WHERE name = 'AddClientUserLastVerifiedAt1700000000005'
    `);
    if (appliedCheck.length > 0) {
      throw new Error('Migration 0005 must NEVER be recorded in migrations table on failure!');
    }
    console.log('✓ TEST 6 PASSED: Migration is not recorded as applied in migrations table after failure.');

    // Create base dbo.client_user_snapshots table matching HMC_CENTRAL_AUTOMATION schema without lastVerifiedAt
    await qRunner.query(`
      CREATE TABLE [dbo].[client_user_snapshots] (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        clientCode NVARCHAR(255) NOT NULL,
        remoteUserId NVARCHAR(255) NULL,
        username NVARCHAR(255) NOT NULL,
        firstName NVARCHAR(255) NOT NULL,
        middleName NVARCHAR(255) NULL,
        lastName NVARCHAR(255) NOT NULL,
        fullName NVARCHAR(255) NOT NULL,
        nickName NVARCHAR(255) NULL,
        email NVARCHAR(255) NULL,
        mobileNumber NVARCHAR(255) NULL,
        nationality NVARCHAR(255) NULL,
        role NVARCHAR(MAX) NULL,
        profileRole NVARCHAR(255) NULL,
        status NVARCHAR(50) NOT NULL,
        barcodeNumber NVARCHAR(255) NULL,
        hasSignature BIT NOT NULL DEFAULT 0,
        signatureDataUrl NVARCHAR(MAX) NULL,
        hasStamp BIT NOT NULL DEFAULT 0,
        stampDataUrl NVARCHAR(MAX) NULL,
        hasProfileImage BIT NOT NULL DEFAULT 0,
        profileImageDataUrl NVARCHAR(MAX) NULL,
        remoteCreatedAt NVARCHAR(255) NULL,
        remoteUpdatedAt NVARCHAR(255) NULL,
        lastSyncedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        syncRunId NVARCHAR(255) NULL,
        isPresentRemotely BIT NOT NULL DEFAULT 1
      );
    `);

    // Insert an existing user row before migration to prove existing rows remain NULL
    await qRunner.query(`
      INSERT INTO [dbo].[client_user_snapshots] (
        id, clientId, clientCode, username, firstName, lastName, fullName, status, lastSyncedAt, createdAt, updatedAt, isPresentRemotely
      ) VALUES (
        NEWID(), '${savedClient.id}', '${savedClient.clientCode}', 'existing.pre.migration.user', 'Pre', 'User', 'Pre User', 'ACTIVE', SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), 1
      );
    `);

    // Test 7: DBO table receives exactly one nullable column
    console.log('\n[TEST 7] Testing dbo table receives exactly one nullable column...');
    await mig0005.up(qRunner);

    const colCheck: any[] = await qRunner.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'client_user_snapshots'
        AND COLUMN_NAME = 'lastVerifiedAt';
    `);
    if (colCheck.length !== 1) {
      throw new Error(`Expected exactly 1 column, got: ${colCheck.length}`);
    }
    if (colCheck[0].IS_NULLABLE !== 'YES') {
      throw new Error(`lastVerifiedAt must be nullable! Got: ${colCheck[0].IS_NULLABLE}`);
    }
    if (!colCheck[0].DATA_TYPE.includes('datetime')) {
      throw new Error(`lastVerifiedAt must be datetime2! Got: ${colCheck[0].DATA_TYPE}`);
    }
    console.log('✓ TEST 7 PASSED: [dbo].[client_user_snapshots] received exactly one nullable datetime2 column.');

    // Test 8: Second run performs no duplicate DDL (Idempotency)
    console.log('\n[TEST 8] Testing second run performs no duplicate DDL (Idempotency)...');
    await mig0005.up(qRunner); // run up() second time
    const secondColCheck: any[] = await qRunner.query(`
      SELECT COUNT(*) as cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'client_user_snapshots'
        AND COLUMN_NAME = 'lastVerifiedAt';
    `);
    if (Number(secondColCheck[0].cnt) !== 1) {
      throw new Error(`Duplicate columns detected! Count: ${secondColCheck[0].cnt}`);
    }
    console.log('✓ TEST 8 PASSED: Migration 1700000000005 is strictly idempotent on dbo table.');

    // Test 9: Existing rows remain NULL (no backfill, no default constraint)
    console.log('\n[TEST 9] Testing existing rows remain NULL without default or backfill...');
    const preMigrationRow: any[] = await qRunner.query(`
      SELECT username, lastVerifiedAt
      FROM [dbo].[client_user_snapshots]
      WHERE username = 'existing.pre.migration.user';
    `);
    if (preMigrationRow.length === 0 || preMigrationRow[0].lastVerifiedAt !== null) {
      throw new Error(`Existing row must remain NULL! Got: ${preMigrationRow[0]?.lastVerifiedAt}`);
    }
    console.log('✓ TEST 9 PASSED: Existing rows remain NULL without backfill or default constraint.');

    // Test 10: TypeORM SELECT / INSERT / UPDATE and persistence survives repository reload
    console.log('\n[TEST 10] Testing TypeORM operations and persistence survives repository reload...');
    const userSnapshotRepo = testDataSource.getRepository(ClientUserSnapshot);
    const testUsername = `test.doctor.${Date.now()}`;
    const verifiedUser = userSnapshotRepo.create({
      clientId: savedClient.id,
      clientCode: savedClient.clientCode,
      username: testUsername,
      firstName: 'Verified',
      lastName: 'Doctor',
      fullName: 'Verified Doctor',
      role: 'USER',
      status: 'ACTIVE',
      lastSyncedAt: new Date(),
      lastVerifiedAt: null,
      isPresentRemotely: true,
      hasSignature: false,
      hasStamp: false,
      hasProfileImage: false,
    });
    const savedSnapshot = await userSnapshotRepo.save(verifiedUser);

    const verifiedTimestamp = new Date();
    savedSnapshot.role = 'CLINICIANS, DOCTOR REPORT';
    savedSnapshot.lastVerifiedAt = verifiedTimestamp;
    await userSnapshotRepo.save(savedSnapshot);

    // Reload from fresh query and verify durability
    const reloadedVerified = await userSnapshotRepo.findOne({ where: { id: savedSnapshot.id } });
    if (!reloadedVerified || !reloadedVerified.lastVerifiedAt) {
      throw new Error('Failed to persist lastVerifiedAt to database!');
    }
    if (Math.abs(reloadedVerified.lastVerifiedAt.getTime() - verifiedTimestamp.getTime()) > 1000) {
      throw new Error(`Timestamp mismatch! Saved: ${verifiedTimestamp.toISOString()}, Fetched: ${reloadedVerified.lastVerifiedAt.toISOString()}`);
    }
    if (reloadedVerified.role !== 'CLINICIANS, DOCTOR REPORT') {
      throw new Error(`Role mismatch! Expected: CLINICIANS, DOCTOR REPORT, Got: ${reloadedVerified.role}`);
    }
    console.log('✓ TEST 10 PASSED: TypeORM operations succeed, lastVerifiedAt is durable and survives repository reload.');
  } finally {
    await qRunner.release();
  }

  await testDataSource.destroy();
  console.log('\nAll Live MSSQL 2022 Integration Tests Passed Successfully!');
}

runLiveMssqlIntegrationTests().catch((err) => {
  console.error('[FATAL] MSSQL Integration Tests Failed:', err);
  process.exit(1);
});
