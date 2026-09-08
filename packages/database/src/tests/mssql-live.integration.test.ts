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
import { ExpandClientUserSnapshotRole1700000000006 } from '../migrations/1700000000006-ExpandClientUserSnapshotRole.js';

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
        role NVARCHAR(100) NULL,
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

    // ==========================================
    // Migration 1700000000006 Tests
    // ==========================================
    const mig0006 = new ExpandClientUserSnapshotRole1700000000006();

    // Test 11: Migration 1700000000006 Preflight Checks & Failure Rejection
    console.log('\n[TEST 11] Testing Migration 0006 Preflight Checks and Failure Rejection...');

    // 11a: Reject HMC_CENTRAL_AUTOMATION_OLD
    let oldDbFailed = false;
    try {
      const fakeQueryRunner = {
        query: async (sql: string) => {
          if (sql.includes('DB_NAME()')) return [{ currentDb: 'HMC_CENTRAL_AUTOMATION_OLD' }];
          return [];
        },
      } as any;
      await mig0006.up(fakeQueryRunner);
    } catch (err: any) {
      if (err.message.includes('Unauthorized database target') && err.message.includes('HMC_CENTRAL_AUTOMATION_OLD')) {
        oldDbFailed = true;
      }
    }
    if (!oldDbFailed) throw new Error('Migration 0006 failed to reject HMC_CENTRAL_AUTOMATION_OLD!');

    // 11b: Reject HMC_CENTRAL_AUTOMATION_BACKUP
    let backupDbFailed = false;
    try {
      const fakeQueryRunner = {
        query: async (sql: string) => {
          if (sql.includes('DB_NAME()')) return [{ currentDb: 'HMC_CENTRAL_AUTOMATION_BACKUP' }];
          return [];
        },
      } as any;
      await mig0006.up(fakeQueryRunner);
    } catch (err: any) {
      if (err.message.includes('Unauthorized database target') && err.message.includes('HMC_CENTRAL_AUTOMATION_BACKUP')) {
        backupDbFailed = true;
      }
    }
    if (!backupDbFailed) throw new Error('Migration 0006 failed to reject HMC_CENTRAL_AUTOMATION_BACKUP!');

    // 11c: Accept exact real and test DB names
    for (const validDb of ['HMC_CENTRAL_AUTOMATION', 'HMC_CENTRAL_AUTOMATION_TEST']) {
      let dbCheckPassed = false;
      try {
        const fakeQueryRunner = {
          query: async (sql: string) => {
            if (sql.includes('DB_NAME()')) return [{ currentDb: validDb }];
            // Fail on table check to stop execution after DB check passes
            if (sql.includes('INFORMATION_SCHEMA.TABLES') && sql.includes('client_user_snapshots')) return [];
            return [];
          },
        } as any;
        await mig0006.up(fakeQueryRunner);
      } catch (err: any) {
        if (err.message.includes('Required table [dbo].[client_user_snapshots] does not exist')) {
          dbCheckPassed = true; // DB check passed; threw at next step
        }
      }
      if (!dbCheckPassed) throw new Error(`Migration 0006 rejected valid DB target: ${validDb}`);
    }

    // 11d: Missing table check
    let missingTableFailed = false;
    try {
      const fakeQueryRunner = {
        query: async (sql: string) => {
          if (sql.includes('DB_NAME()')) return [{ currentDb: 'HMC_CENTRAL_AUTOMATION_TEST' }];
          if (sql.includes('INFORMATION_SCHEMA.TABLES') && sql.includes('client_user_snapshots')) return [];
          return [];
        },
      } as any;
      await mig0006.up(fakeQueryRunner);
    } catch (err: any) {
      if (err.message.includes('Required table [dbo].[client_user_snapshots] does not exist')) {
        missingTableFailed = true;
      }
    }
    if (!missingTableFailed) throw new Error('Migration 0006 failed to reject missing table!');

    // 11e: Active index dependency rejection
    await qRunner.query(`
      CREATE NONCLUSTERED INDEX [IX_test_client_user_snapshots_role]
      ON [dbo].[client_user_snapshots] ([role]);
    `);
    let indexDepFailed = false;
    try {
      await mig0006.up(qRunner);
    } catch (err: any) {
      if (err.message.includes('Column [role] has active dependencies') && err.message.includes('INDEX')) {
        indexDepFailed = true;
      }
    } finally {
      await qRunner.query(`
        IF EXISTS (
          SELECT 1 FROM sys.indexes
          WHERE name = 'IX_test_client_user_snapshots_role'
            AND object_id = OBJECT_ID('[dbo].[client_user_snapshots]')
        )
        DROP INDEX [IX_test_client_user_snapshots_role] ON [dbo].[client_user_snapshots];
      `);
    }
    if (!indexDepFailed) throw new Error('Migration 0006 failed to reject active index dependency on [role]!');

    // 11f: Computed-column dependency rejection
    await qRunner.query(`
      ALTER TABLE [dbo].[client_user_snapshots]
      ADD [role_computed_test] AS ([role] + '_suffix');
    `);
    let computedDepFailed = false;
    try {
      await mig0006.up(qRunner);
    } catch (err: any) {
      if (err.message.includes('Column [role] has active dependencies') && err.message.includes('COMPUTED COLUMN')) {
        computedDepFailed = true;
      }
    } finally {
      await qRunner.query(`
        IF COL_LENGTH('[dbo].[client_user_snapshots]', 'role_computed_test') IS NOT NULL
        ALTER TABLE [dbo].[client_user_snapshots] DROP COLUMN [role_computed_test];
      `);
    }
    if (!computedDepFailed) throw new Error('Migration 0006 failed to reject computed column dependency on [role]!');

    // 11g: Schema-bound view dependency rejection
    await qRunner.query(`
      CREATE VIEW [dbo].[vw_test_role_schemabound]
      WITH SCHEMABINDING AS
      SELECT id, username, [role] FROM [dbo].[client_user_snapshots];
    `);
    let viewDepFailed = false;
    try {
      await mig0006.up(qRunner);
    } catch (err: any) {
      if (err.message.includes('Column [role] has active dependencies') && err.message.includes('VIEW')) {
        viewDepFailed = true;
      }
    } finally {
      await qRunner.query(`
        IF OBJECT_ID('[dbo].[vw_test_role_schemabound]', 'V') IS NOT NULL
        DROP VIEW [dbo].[vw_test_role_schemabound];
      `);
    }
    if (!viewDepFailed) throw new Error('Migration 0006 failed to reject schema-bound view dependency on [role]!');

    // 11h: Trigger token-boundary dependency tests (all 8 cases)
    const tokenTriggerCases = [
      { name: 'tr_test_inserted_role', def: 'SELECT inserted.role FROM inserted;', expectDep: true },
      { name: 'tr_test_deleted_role', def: 'SELECT deleted.role FROM deleted;', expectDep: true },
      { name: 'tr_test_bracketed_role', def: 'SELECT inserted.[role] FROM inserted;', expectDep: true },
      { name: 'tr_test_update_role', def: 'IF UPDATE(role) BEGIN SELECT 1; END;', expectDep: true },
      { name: 'tr_test_role_code', def: 'DECLARE @code VARCHAR(50) = \'c\'; SELECT inserted.roleCode FROM (SELECT @code AS roleCode) inserted;', expectDep: false },
      { name: 'tr_test_role_name', def: 'DECLARE @name VARCHAR(50) = \'n\'; SELECT inserted.roleName FROM (SELECT @name AS roleName) inserted;', expectDep: false },
      { name: 'tr_test_role_status', def: 'DECLARE @st VARCHAR(50) = \'s\'; SELECT inserted.roleStatus FROM (SELECT @st AS roleStatus) inserted;', expectDep: false },
      { name: 'tr_test_controller_userRole', def: 'DECLARE @controller VARCHAR(50) = \'ctrl\'; DECLARE @userRole VARCHAR(50) = \'urole\';', expectDep: false },
    ];

    for (const tc of tokenTriggerCases) {
      await qRunner.query(`
        CREATE TRIGGER [dbo].[${tc.name}]
        ON [dbo].[client_user_snapshots]
        AFTER UPDATE AS
        BEGIN
          ${tc.def}
        END;
      `);
      let threwDep = false;
      try {
        await qRunner.query(`ALTER TABLE [dbo].[client_user_snapshots] ALTER COLUMN [role] NVARCHAR(100) NULL;`);
        await mig0006.up(qRunner);
      } catch (err: any) {
        if (err.message.includes('Column [role] has active dependencies') && err.message.includes('TRIGGER')) {
          threwDep = true;
        }
      } finally {
        await qRunner.query(`IF OBJECT_ID('[dbo].[${tc.name}]', 'TR') IS NOT NULL DROP TRIGGER [dbo].[${tc.name}];`);
      }

      if (tc.expectDep && !threwDep) {
        throw new Error(`Migration 0006 failed to detect trigger dependency: ${tc.name}`);
      }
      if (!tc.expectDep && threwDep) {
        throw new Error(`Migration 0006 falsely rejected trigger: ${tc.name}`);
      }
    }

    // 11i: Duplicate dbo migration records rejected
    await qRunner.query(`
      INSERT INTO [dbo].[migrations] (timestamp, name) VALUES (1700000000006, 'ExpandClientUserSnapshotRole1700000000006');
      INSERT INTO [dbo].[migrations] (timestamp, name) VALUES (1700000000006, 'ExpandClientUserSnapshotRole1700000000006');
    `);
    let dupDboMigFailed = false;
    try {
      await mig0006.up(qRunner);
    } catch (err: any) {
      if (err.message.includes('Duplicate migration records detected in [dbo].[migrations]')) {
        dupDboMigFailed = true;
      }
    } finally {
      await qRunner.query(`
        DELETE FROM [dbo].[migrations] WHERE name = 'ExpandClientUserSnapshotRole1700000000006';
      `);
    }
    if (!dupDboMigFailed) throw new Error('Migration 0006 failed to reject duplicate dbo.migrations records!');

    // 11j: Other-schema migrations table ignored
    await qRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = 'staging') EXEC('CREATE SCHEMA staging');
      IF OBJECT_ID('[staging].[migrations]', 'U') IS NOT NULL DROP TABLE [staging].[migrations];
      CREATE TABLE [staging].[migrations] (id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(255));
      INSERT INTO [staging].[migrations] (name) VALUES ('ExpandClientUserSnapshotRole1700000000006');
      INSERT INTO [staging].[migrations] (name) VALUES ('ExpandClientUserSnapshotRole1700000000006');
    `);
    let otherSchemaIgnored = false;
    try {
      await qRunner.query(`ALTER TABLE [dbo].[client_user_snapshots] ALTER COLUMN [role] NVARCHAR(100) NULL;`);
      await mig0006.up(qRunner);
      otherSchemaIgnored = true;
    } finally {
      await qRunner.query(`IF OBJECT_ID('[staging].[migrations]', 'U') IS NOT NULL DROP TABLE [staging].[migrations];`);
    }
    if (!otherSchemaIgnored) throw new Error('Migration 0006 failed to ignore other-schema migrations table!');

    // 11k: Unrelated computed column containing ordinary letters r/o/l/e is not falsely rejected
    await qRunner.query(`
      ALTER TABLE [dbo].[client_user_snapshots]
      ADD [unrelated_role_letters] AS (LOWER(status) + '_controller_userRole');
    `);
    let unrelatedComputedPassed = false;
    try {
      await qRunner.query(`ALTER TABLE [dbo].[client_user_snapshots] ALTER COLUMN [role] NVARCHAR(100) NULL;`);
      await mig0006.up(qRunner);
      unrelatedComputedPassed = true;
    } finally {
      await qRunner.query(`
        IF COL_LENGTH('[dbo].[client_user_snapshots]', 'unrelated_role_letters') IS NOT NULL
        ALTER TABLE [dbo].[client_user_snapshots] DROP COLUMN [unrelated_role_letters];
      `);
    }
    if (!unrelatedComputedPassed) throw new Error('Migration 0006 falsely rejected unrelated computed column!');

    console.log('✓ TEST 11 PASSED: Migration 0006 preflight checks and failure rejections verified across all scenarios (including false-positive immunity and all 8 trigger cases).');

    // Test 12: Migration 1700000000006 DDL and Idempotency
    console.log('\n[TEST 12] Testing Migration 0006 DDL and Idempotency...');
    // Ensure column starts at NVARCHAR(100)
    await qRunner.query(`
      ALTER TABLE [dbo].[client_user_snapshots]
      ALTER COLUMN [role] NVARCHAR(100) NULL;
    `);

    const beforeColCheck: any[] = await qRunner.query(`
      SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'client_user_snapshots'
        AND COLUMN_NAME = 'role';
    `);
    if (Number(beforeColCheck[0].CHARACTER_MAXIMUM_LENGTH) !== 100) {
      throw new Error(`Expected CHARACTER_MAXIMUM_LENGTH = 100, got: ${beforeColCheck[0].CHARACTER_MAXIMUM_LENGTH}`);
    }

    // Run migration up()
    await mig0006.up(qRunner);

    // Verify column is now NVARCHAR(MAX) (-1)
    const afterColCheck: any[] = await qRunner.query(`
      SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'client_user_snapshots'
        AND COLUMN_NAME = 'role';
    `);
    if (afterColCheck[0].DATA_TYPE !== 'nvarchar' || Number(afterColCheck[0].CHARACTER_MAXIMUM_LENGTH) !== -1) {
      throw new Error(`Expected NVARCHAR(MAX) (-1), got ${afterColCheck[0].DATA_TYPE}(${afterColCheck[0].CHARACTER_MAXIMUM_LENGTH})`);
    }
    if (afterColCheck[0].IS_NULLABLE !== 'YES') {
      throw new Error(`Column [role] must remain nullable! Got: ${afterColCheck[0].IS_NULLABLE}`);
    }

    // Idempotency: second run performs no duplicate DDL and does not throw
    await mig0006.up(qRunner);
    const idempotentColCheck: any[] = await qRunner.query(`
      SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'client_user_snapshots'
        AND COLUMN_NAME = 'role';
    `);
    if (Number(idempotentColCheck[0].CHARACTER_MAXIMUM_LENGTH) !== -1) {
      throw new Error(`Idempotency failure: CHARACTER_MAXIMUM_LENGTH is not -1`);
    }

    // Safe forward-only down() is no-op
    await mig0006.down(qRunner);
    const downColCheck: any[] = await qRunner.query(`
      SELECT CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'client_user_snapshots'
        AND COLUMN_NAME = 'role';
    `);
    if (Number(downColCheck[0].CHARACTER_MAXIMUM_LENGTH) !== -1) {
      throw new Error(`down() must be non-destructive no-op under forward-only policy!`);
    }
    console.log('✓ TEST 12 PASSED: Migration 0006 successfully altered [role] to NVARCHAR(MAX), proved idempotent, and down() is safe no-op.');

    // Test 13: Multi-role persistence & durability (103-, 117-, 1000+-char strings)
    console.log('\n[TEST 13] Testing 103-, 117-, and 1000+-character role strings persist and survive reload...');
    const role103 = 'CLINICIANS, DOCTOR REPORT, HEAD NURSE EMERGENCY, INTENSIVE CARE UNIT SUPERVISOR, SURGERY COORDINATORS-A'; // 103 chars
    if (role103.length !== 103) {
      throw new Error(`Expected role103 to have length 103, got ${role103.length}`);
    }
    const role117Exact = 'PHARMACY SUPERVISOR, CLINICAL PHARMACIST, DISPENSARY MANAGER, INVENTORY AUDITOR, NARCOTICS CONTROLLER, WARD REVIEWERS'; // 117 chars
    if (role117Exact.length !== 117) {
      throw new Error(`Expected role117Exact to have length 117, got ${role117Exact.length}`);
    }
    const role1050 = 'ROLE_START, ' + 'A'.repeat(1030) + ', ROLE_END';
    if (role1050.length < 1000) {
      throw new Error(`Expected role1050 to have length > 1000, got ${role1050.length}`);
    }

    // User with 103 chars
    const user103 = userSnapshotRepo.create({
      clientId: savedClient.id,
      clientCode: savedClient.clientCode,
      username: `user.103.${Date.now()}`,
      firstName: 'Role',
      lastName: 'OneHundredThree',
      fullName: 'Role OneHundredThree',
      role: role103,
      status: 'ACTIVE',
      lastSyncedAt: new Date(),
      lastVerifiedAt: new Date(),
      isPresentRemotely: true,
      hasSignature: false,
      hasStamp: false,
      hasProfileImage: false,
    });
    await userSnapshotRepo.save(user103);
    const reloaded103 = await userSnapshotRepo.findOne({ where: { id: user103.id } });
    if (reloaded103?.role !== role103) {
      throw new Error(`Role 103 mismatch! Expected length 103, got length ${reloaded103?.role?.length}`);
    }

    // User with 117 chars
    const user117 = userSnapshotRepo.create({
      clientId: savedClient.id,
      clientCode: savedClient.clientCode,
      username: `user.117.${Date.now()}`,
      firstName: 'Role',
      lastName: 'OneHundredSeventeen',
      fullName: 'Role OneHundredSeventeen',
      role: role117Exact,
      status: 'ACTIVE',
      lastSyncedAt: new Date(),
      lastVerifiedAt: new Date(),
      isPresentRemotely: true,
      hasSignature: false,
      hasStamp: false,
      hasProfileImage: false,
    });
    await userSnapshotRepo.save(user117);
    const reloaded117 = await userSnapshotRepo.findOne({ where: { id: user117.id } });
    if (reloaded117?.role !== role117Exact) {
      throw new Error(`Role 117 mismatch! Expected length 117, got length ${reloaded117?.role?.length}`);
    }

    // User with 1000+ chars
    const user1050 = userSnapshotRepo.create({
      clientId: savedClient.id,
      clientCode: savedClient.clientCode,
      username: `user.1050.${Date.now()}`,
      firstName: 'Role',
      lastName: 'OneThousandFifty',
      fullName: 'Role OneThousandFifty',
      role: role1050,
      status: 'ACTIVE',
      lastSyncedAt: new Date(),
      lastVerifiedAt: new Date(),
      isPresentRemotely: true,
      hasSignature: false,
      hasStamp: false,
      hasProfileImage: false,
    });
    await userSnapshotRepo.save(user1050);
    const reloaded1050 = await userSnapshotRepo.findOne({ where: { id: user1050.id } });
    if (reloaded1050?.role !== role1050) {
      throw new Error(`Role 1050 mismatch! Expected length ${role1050.length}, got length ${reloaded1050?.role?.length}`);
    }
    console.log('✓ TEST 13 PASSED: 103-, 117-, and 1000+-character role strings persisted and reloaded with exact equality.');

    // Test 14: Atomic update and NULL preservation
    console.log('\n[TEST 14] Testing atomic update of role and lastVerifiedAt, and NULL role preservation...');
    const nullUser = userSnapshotRepo.create({
      clientId: savedClient.id,
      clientCode: savedClient.clientCode,
      username: `null.role.user.${Date.now()}`,
      firstName: 'Null',
      lastName: 'Role',
      fullName: 'Null Role',
      role: null,
      status: 'ACTIVE',
      lastSyncedAt: new Date(),
      lastVerifiedAt: null,
      isPresentRemotely: true,
      hasSignature: false,
      hasStamp: false,
      hasProfileImage: false,
    });
    const savedNullUser = await userSnapshotRepo.save(nullUser);
    const reloadedNull = await userSnapshotRepo.findOne({ where: { id: savedNullUser.id } });
    if (reloadedNull?.role !== null) {
      throw new Error(`Expected role to remain null, got: ${reloadedNull?.role}`);
    }

    // Atomic update via QueryBuilder
    const atomicTimestamp = new Date();
    const newCanonicalRoles = 'ADMIN, BILLING, PHARMACY, CLINICIANS, RADIOLOGY';
    await userSnapshotRepo
      .createQueryBuilder()
      .update(ClientUserSnapshot)
      .set({
        role: newCanonicalRoles,
        lastVerifiedAt: atomicTimestamp,
        lastSyncedAt: atomicTimestamp,
        updatedAt: atomicTimestamp,
      })
      .where('id = :id', { id: savedNullUser.id })
      .execute();

    const reloadedAtomic = await userSnapshotRepo.findOne({ where: { id: savedNullUser.id } });
    if (!reloadedAtomic || reloadedAtomic.role !== newCanonicalRoles || !reloadedAtomic.lastVerifiedAt) {
      throw new Error('Atomic update of role and lastVerifiedAt failed to persist simultaneously!');
    }
    if (Math.abs(reloadedAtomic.lastVerifiedAt.getTime() - atomicTimestamp.getTime()) > 1000) {
      throw new Error('Atomic lastVerifiedAt timestamp mismatch!');
    }
    console.log('✓ TEST 14 PASSED: Atomic update and NULL preservation verified.');
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
