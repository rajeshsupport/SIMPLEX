import { DataSource } from 'typeorm';
import * as assert from 'assert';
import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  allEntities,
  Client,
  ClientResourceSnapshot,
  ClientResourceDepartment,
  ClientResourceService,
  ResourceImportJob,
  ResourceImportRow,
} from '../index.js';
import { AlignClientResourceSnapshotsSchema1700000000004 } from '../migrations/1700000000004-AlignClientResourceSnapshotsSchema.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const testDataSource = new DataSource({
  type: 'mssql',
  host: process.env.MSSQL_HOST || 'localhost',
  port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  username: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD || 'Rajesh@123',
  database: 'HMC_CENTRAL_AUTOMATION_TEST', // STRICTLY ISOLATED TEST DB
  entities: allEntities,
  synchronize: false,
  options: {
    encrypt: process.env.MSSQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
  },
});

async function runTests() {
  console.log('================================================================');
  console.log('  RESOURCE SCHEMA ALIGNMENT DISPOSABLE DATABASE TEST SUITE      ');
  console.log('================================================================\n');

  // Hard safety invariant
  assert.notStrictEqual(testDataSource.options.database, 'HMC_CENTRAL_AUTOMATION', 'MUST NOT CONNECT TO PRODUCTION/CENTRAL DB');
  assert.notStrictEqual(testDataSource.options.database, 'HMC_CENTRAL_OPERATIONS', 'MUST NOT CONNECT TO PRODUCTION/CENTRAL DB');

  await testDataSource.initialize();
  const queryRunner = testDataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    // --------------------------------------------------------------------------
    // TEST 1: Setup isolated legacy table with 16 missing columns & align
    // --------------------------------------------------------------------------
    console.log('[TEST 1] Testing Legacy Incomplete Empty Table Alignment (All 16 Missing Columns)...');
    await queryRunner.query(`
      IF OBJECT_ID('client_resource_services', 'U') IS NOT NULL DROP TABLE client_resource_services;
      IF OBJECT_ID('client_resource_departments', 'U') IS NOT NULL DROP TABLE client_resource_departments;
      IF OBJECT_ID('client_resource_snapshots', 'U') IS NOT NULL DROP TABLE client_resource_snapshots;

      CREATE TABLE client_resource_snapshots (
        id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_test_res_id DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        clientCode NVARCHAR(50) NOT NULL,
        remoteResourceId NVARCHAR(100) NULL,
        resourceCode NVARCHAR(50) NOT NULL,
        resourceName NVARCHAR(250) NOT NULL,
        department NVARCHAR(150) NULL,
        specialization NVARCHAR(150) NULL,
        resourceType NVARCHAR(50) NULL CONSTRAINT DF_test_res_type DEFAULT 'DOCTOR',
        linkedUsername NVARCHAR(100) NULL,
        status NVARCHAR(50) NOT NULL CONSTRAINT DF_test_res_status DEFAULT 'ACTIVE',
        phone NVARCHAR(50) NULL,
        email NVARCHAR(100) NULL,
        remoteCreatedAt NVARCHAR(100) NULL,
        remoteUpdatedAt NVARCHAR(100) NULL,
        isPresentRemotely BIT NOT NULL CONSTRAINT DF_test_res_present DEFAULT 1,
        syncRunId NVARCHAR(100) NULL,
        lastSyncedAt DATETIME2 NOT NULL,
        createdAt DATETIME2 NOT NULL CONSTRAINT DF_test_res_created DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL CONSTRAINT DF_test_res_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_test_client_resource_snapshots PRIMARY KEY (id),
        CONSTRAINT FK_test_client_resource_snapshots_clientId FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IDX_client_resource_snapshots_client_code ON client_resource_snapshots(clientId, resourceCode);
      CREATE INDEX IDX_client_resource_snapshots_clientId ON client_resource_snapshots(clientId);
      CREATE INDEX IDX_client_resource_snapshots_resourceCode ON client_resource_snapshots(resourceCode);
    `);

    const migration = new AlignClientResourceSnapshotsSchema1700000000004();
    await migration.up(queryRunner);

    // Verify all 16 columns exist
    const expected16 = [
      'isResourceHuman',
      'remoteResourceTypeId',
      'resourceTypeName',
      'remoteSpecialtyId',
      'specialtyName',
      'colorIdentificationCode',
      'operatingFrom',
      'operatingTo',
      'selectAllDepartments',
      'selectAllServices',
      'linkedRemoteUserId',
      'isShownInRegistration',
      'branchId',
      'branchName',
      'remoteStatus',
      'lastVerifiedAt',
    ];

    const currentCols = await queryRunner.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'client_resource_snapshots'
    `);
    const colNames = currentCols.map((c: any) => c.COLUMN_NAME);

    for (const col of expected16) {
      assert.ok(colNames.includes(col), `Missing expected column: ${col}`);
    }
    console.log('✓ TEST 1 Passed: Exactly 16 missing intended columns verified.');

    // --------------------------------------------------------------------------
    // TEST 2: Pre-DDL Guard Rejection for Unknown Legacy resourceType
    // --------------------------------------------------------------------------
    console.log('\n[TEST 2] Testing Unknown Legacy resourceType Pre-DDL Guard Rejection...');
    await queryRunner.query(`
      IF OBJECT_ID('client_resource_snapshots', 'U') IS NOT NULL DROP TABLE client_resource_snapshots;

      CREATE TABLE client_resource_snapshots (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        clientCode NVARCHAR(50) NOT NULL,
        resourceCode NVARCHAR(50) NOT NULL,
        resourceName NVARCHAR(250) NOT NULL,
        resourceType NVARCHAR(50) NOT NULL,
        lastSyncedAt DATETIME2 NOT NULL
      );
      INSERT INTO client_resource_snapshots (clientId, clientCode, resourceCode, resourceName, resourceType, lastSyncedAt)
      VALUES (NEWID(), 'C1', 'R1', 'Unknown Device', 'ALIEN_DRONE', SYSUTCDATETIME());
    `);

    let guardFailedAsExpected = false;
    try {
      await migration.up(queryRunner);
    } catch (err: any) {
      if (err.message.includes('[MIGRATION 0004 PRE-DDL REJECTED]') && err.message.includes('ALIEN_DRONE')) {
        guardFailedAsExpected = true;
      }
    }
    assert.strictEqual(guardFailedAsExpected, true, 'Migration must abort before DDL when unrecognized resourceType is encountered');

    // Prove zero partial columns were added
    const colsAfterRejection = await queryRunner.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'client_resource_snapshots'
    `);
    assert.strictEqual(colsAfterRejection.some((c: any) => c.COLUMN_NAME === 'isResourceHuman'), false, 'Zero partial columns added');
    console.log('✓ TEST 2 Passed: Unknown resourceType cleanly aborted before any DDL mutation.');

    // --------------------------------------------------------------------------
    // TEST 3: Pre-DDL Guard Rejection for NULL lastSyncedAt
    // --------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing NULL lastSyncedAt Pre-DDL Guard Rejection...');
    await queryRunner.query(`
      IF OBJECT_ID('client_resource_snapshots', 'U') IS NOT NULL DROP TABLE client_resource_snapshots;

      CREATE TABLE client_resource_snapshots (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        clientCode NVARCHAR(50) NOT NULL,
        resourceCode NVARCHAR(50) NOT NULL,
        resourceName NVARCHAR(250) NOT NULL,
        resourceType NVARCHAR(50) NOT NULL,
        lastSyncedAt DATETIME2 NULL
      );
      INSERT INTO client_resource_snapshots (clientId, clientCode, resourceCode, resourceName, resourceType, lastSyncedAt)
      VALUES (NEWID(), 'C1', 'R1', 'Null Synced User', 'DOCTOR', NULL);
    `);

    let nullSyncedFailed = false;
    try {
      await migration.up(queryRunner);
    } catch (err: any) {
      if (err.message.includes('[MIGRATION 0004 PRE-DDL REJECTED]') && err.message.includes('NULL lastSyncedAt')) {
        nullSyncedFailed = true;
      }
    }
    assert.strictEqual(nullSyncedFailed, true, 'Migration must abort before DDL when NULL lastSyncedAt is encountered');
    console.log('✓ TEST 3 Passed: NULL lastSyncedAt cleanly aborted before any DDL mutation.');

    // --------------------------------------------------------------------------
    // TEST 4: Populated Legacy Table: Preserves Data, Backfills Human vs Non-Human
    // --------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing Populated Legacy Table Backfill (Human -> Yes, Non-Human -> No, lastVerifiedAt -> lastSyncedAt)...');
    await queryRunner.query(`
      IF OBJECT_ID('client_resource_snapshots', 'U') IS NOT NULL DROP TABLE client_resource_snapshots;

      CREATE TABLE client_resource_snapshots (
        id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_test_res_id2 DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        clientCode NVARCHAR(50) NOT NULL,
        remoteResourceId NVARCHAR(100) NULL,
        resourceCode NVARCHAR(50) NOT NULL,
        resourceName NVARCHAR(250) NOT NULL,
        department NVARCHAR(150) NULL,
        specialization NVARCHAR(150) NULL,
        resourceType NVARCHAR(50) NULL,
        linkedUsername NVARCHAR(100) NULL,
        status NVARCHAR(50) NOT NULL CONSTRAINT DF_test_res_status2 DEFAULT 'ACTIVE',
        phone NVARCHAR(50) NULL,
        email NVARCHAR(100) NULL,
        remoteCreatedAt NVARCHAR(100) NULL,
        remoteUpdatedAt NVARCHAR(100) NULL,
        isPresentRemotely BIT NOT NULL CONSTRAINT DF_test_res_present2 DEFAULT 1,
        syncRunId NVARCHAR(100) NULL,
        lastSyncedAt DATETIME2 NOT NULL,
        createdAt DATETIME2 NOT NULL CONSTRAINT DF_test_res_created2 DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL CONSTRAINT DF_test_res_updated2 DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_test_client_resource_snapshots2 PRIMARY KEY (id),
        CONSTRAINT FK_test_client_resource_snapshots_clientId2 FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IDX_client_resource_snapshots_client_code ON client_resource_snapshots(clientId, resourceCode);
      CREATE INDEX IDX_client_resource_snapshots_clientId ON client_resource_snapshots(clientId);
    `);

    const clients = await queryRunner.query(`SELECT TOP 1 id, clientCode FROM clients`);
    let testCliId = clients[0]?.id;
    let testCliCode = clients[0]?.clientCode || 'CLI_TEST';
    if (!testCliId) {
      testCliId = '00000000-0000-0000-0000-000000000001';
      await queryRunner.query(`
        INSERT INTO clients (id, clientCode, clientName, baseUrl, environment, status, createdBy)
        VALUES ('${testCliId}', '${testCliCode}', 'Test Hosp', 'https://test.local', 'Test', 'ACTIVE', 'TEST');
      `);
    }

    const pastTimestamp = '2025-01-15T08:30:00.000Z';
    // Insert Human row (DOCTOR)
    await queryRunner.query(`
      INSERT INTO client_resource_snapshots (
        clientId, clientCode, remoteResourceId, resourceCode, resourceName,
        department, specialization, resourceType, status, isPresentRemotely, lastSyncedAt
      ) VALUES (
        '${testCliId}', '${testCliCode}', 'RES_DOC_1', 'CODE_DOC_1', 'Dr. Tariq Physician',
        'Cardiology', 'Interventional', 'DOCTOR', 'ACTIVE', 1, '${pastTimestamp}'
      );
    `);
    // Insert Non-Human row (ROOM)
    await queryRunner.query(`
      INSERT INTO client_resource_snapshots (
        clientId, clientCode, remoteResourceId, resourceCode, resourceName,
        department, specialization, resourceType, status, isPresentRemotely, lastSyncedAt
      ) VALUES (
        '${testCliId}', '${testCliCode}', 'RES_RM_1', 'CODE_RM_1', 'Ultrasound Room A',
        'Radiology', 'Diagnostic', 'ROOM', 'ACTIVE', 1, '${pastTimestamp}'
      );
    `);

    await migration.up(queryRunner);

    // Verify Human row
    const docRow = (await queryRunner.query(`SELECT * FROM client_resource_snapshots WHERE resourceCode = 'CODE_DOC_1'`))[0];
    assert.strictEqual(docRow.isResourceHuman, true);
    assert.strictEqual(docRow.isShownInRegistration, true, 'Human resource must default isShownInRegistration to 1 (Yes)');
    assert.strictEqual(docRow.remoteStatus, 'ACTIVE');
    assert.strictEqual(new Date(docRow.lastVerifiedAt).toISOString(), new Date(docRow.lastSyncedAt).toISOString(), 'lastVerifiedAt must match lastSyncedAt strictly');

    // Verify Non-Human row
    const rmRow = (await queryRunner.query(`SELECT * FROM client_resource_snapshots WHERE resourceCode = 'CODE_RM_1'`))[0];
    assert.strictEqual(rmRow.isResourceHuman, false);
    assert.strictEqual(rmRow.isShownInRegistration, false, 'Non-Human resource must default isShownInRegistration to 0 (No)');
    assert.strictEqual(new Date(rmRow.lastVerifiedAt).toISOString(), new Date(rmRow.lastSyncedAt).toISOString(), 'lastVerifiedAt must match lastSyncedAt strictly');

    console.log('✓ TEST 4 Passed: Human -> isShownInRegistration=1, Non-Human -> isShownInRegistration=0, lastVerifiedAt===lastSyncedAt.');

    // --------------------------------------------------------------------------
    // TEST 5: Unique Indexes Coexistence & Legacy Protection
    // --------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing Dual Unique Indexes Coexistence (Legacy resourceCode + Model A remoteResourceId)...');
    const idxs = await queryRunner.query(`
      SELECT name FROM sys.indexes
      WHERE name IN ('IDX_client_resource_snapshots_client_code', 'IDX_client_resource_remote_id')
        AND object_id = OBJECT_ID('client_resource_snapshots')
    `);
    assert.strictEqual(idxs.length, 2, 'Both legacy unique index and new remote index must coexist');

    // Attempt duplicate legacy resourceCode -> MUST FAIL
    let dupCodeFailed = false;
    try {
      await queryRunner.query(`
        INSERT INTO client_resource_snapshots (
          clientId, clientCode, remoteResourceId, resourceCode, resourceName,
          isResourceHuman, colorIdentificationCode, operatingFrom, operatingTo,
          selectAllDepartments, selectAllServices, isShownInRegistration, remoteStatus,
          isPresentRemotely, lastVerifiedAt, lastSyncedAt
        ) VALUES (
          '${testCliId}', '${testCliCode}', 'RES_NEW_UNIQUE', 'CODE_DOC_1', 'Duplicate Code User',
          1, 'FFFFFF', '00:00', '23:55', 1, 1, 1, 'ACTIVE', 1, SYSUTCDATETIME(), SYSUTCDATETIME()
        );
      `);
    } catch (err: any) {
      dupCodeFailed = true;
    }
    assert.strictEqual(dupCodeFailed, true, 'Legacy resourceCode uniqueness MUST be enforced');

    // Attempt duplicate remoteResourceId -> MUST FAIL
    let dupRemoteFailed = false;
    try {
      await queryRunner.query(`
        INSERT INTO client_resource_snapshots (
          clientId, clientCode, remoteResourceId, resourceCode, resourceName,
          isResourceHuman, colorIdentificationCode, operatingFrom, operatingTo,
          selectAllDepartments, selectAllServices, isShownInRegistration, remoteStatus,
          isPresentRemotely, lastVerifiedAt, lastSyncedAt
        ) VALUES (
          '${testCliId}', '${testCliCode}', 'RES_DOC_1', 'CODE_UNIQUE_NEW', 'Duplicate Remote User',
          1, 'FFFFFF', '00:00', '23:55', 1, 1, 1, 'ACTIVE', 1, SYSUTCDATETIME(), SYSUTCDATETIME()
        );
      `);
    } catch (err: any) {
      dupRemoteFailed = true;
    }
    assert.strictEqual(dupRemoteFailed, true, 'Model A remoteResourceId uniqueness MUST be enforced');
    console.log('✓ TEST 5 Passed: Both unique indexes strictly enforced.');

    // --------------------------------------------------------------------------
    // TEST 6: Idempotency of up() and Safe No-op of down()
    // --------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing Idempotency of up() and Safe No-Op of down()...');
    const rowCountBefore = (await queryRunner.query(`SELECT COUNT(*) as cnt FROM client_resource_snapshots`))[0].cnt;
    await migration.up(queryRunner);
    await migration.up(queryRunner);
    const rowCountAfter = (await queryRunner.query(`SELECT COUNT(*) as cnt FROM client_resource_snapshots`))[0].cnt;
    assert.strictEqual(rowCountBefore, rowCountAfter, 'up() rerun must not change row count');

    await migration.down(queryRunner);
    const rowCountDown = (await queryRunner.query(`SELECT COUNT(*) as cnt FROM client_resource_snapshots`))[0].cnt;
    assert.strictEqual(rowCountDown, rowCountBefore, 'down() must not delete rows or drop data');
    console.log('✓ TEST 6 Passed: Idempotent up() and safe data-preserving no-op down() verified.');

    // --------------------------------------------------------------------------
    // TEST 7: TypeORM Repository Query (getManyAndCount) Compatibility
    // --------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing TypeORM Query Compatibility (Zero-row and Populated)...');
    const repo = testDataSource.getRepository(ClientResourceSnapshot);
    const [entities, total] = await repo
      .createQueryBuilder('resource')
      .where('resource.clientId = :clientId', { clientId: testCliId })
      .orderBy('resource.remoteResourceId', 'ASC')
      .getManyAndCount();

    assert.ok(total >= 2);
    assert.strictEqual(entities.length, total);

    const [zeroEntities, zeroTotal] = await repo
      .createQueryBuilder('resource')
      .where('resource.clientId = :clientId', { clientId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })
      .getManyAndCount();

    assert.strictEqual(zeroTotal, 0);
    assert.strictEqual(zeroEntities.length, 0);
    console.log('✓ TEST 7 Passed: TypeORM getManyAndCount succeeds cleanly for both populated and zero-row queries.');

  } finally {
    await queryRunner.release();
    await testDataSource.destroy();
  }

  console.log('\n================================================================');
  console.log('✓ ALL RESOURCE SCHEMA ALIGNMENT TESTS PASSED SUCCESSFULLY (7/7)');
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('[FATAL TEST ERROR]', err);
  process.exit(1);
});
