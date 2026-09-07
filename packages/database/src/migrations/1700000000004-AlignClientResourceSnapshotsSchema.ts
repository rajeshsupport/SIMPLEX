import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignClientResourceSnapshotsSchema1700000000004 implements MigrationInterface {
  name = 'AlignClientResourceSnapshotsSchema1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'client_resource_snapshots'
    `);
    if (tableExists.length === 0) {
      return;
    }

    // --------------------------------------------------------------------------
    // STEP 0: PRE-DDL GUARDS (RUNS BEFORE ANY DDL MUTATION)
    // --------------------------------------------------------------------------

    // Guard 1: Unknown legacy resourceType check
    const hasLegacyTypeCol = await queryRunner.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'client_resource_snapshots' AND COLUMN_NAME = 'resourceType'
    `);
    if (hasLegacyTypeCol.length > 0) {
      const unknownTypes: any[] = await queryRunner.query(`
        SELECT DISTINCT resourceType
        FROM client_resource_snapshots
        WHERE resourceType IS NOT NULL
          AND UPPER(LTRIM(RTRIM(resourceType))) NOT IN (
            'DOCTOR', 'PHYSICIAN', 'NURSE', 'THERAPIST', 'CONSULTANT', 'STAFF', 'HUMAN',
            'ROOM', 'EQUIPMENT', 'DEVICE', 'BED', 'FACILITY', 'MACHINE', 'NON_HUMAN', 'NON-HUMAN'
          );
      `);
      if (unknownTypes.length > 0) {
        const typeList = unknownTypes.map((r: any) => `'${r.resourceType}'`).join(', ');
        throw new Error(`[MIGRATION 0004 PRE-DDL REJECTED] Unrecognized legacy resourceType values detected: ${typeList}. Cannot safely determine isResourceHuman classification. Aborting before DDL.`);
      }
    }

    // Guard 2: Null lastSyncedAt preflight check
    const nullSyncedRows: any[] = await queryRunner.query(`
      SELECT COUNT_BIG(*) AS NullLastSyncedAtCount
      FROM dbo.client_resource_snapshots
      WHERE lastSyncedAt IS NULL;
    `);
    if (Number(nullSyncedRows[0]?.NullLastSyncedAtCount || 0) > 0) {
      throw new Error(`[MIGRATION 0004 PRE-DDL REJECTED] Found ${nullSyncedRows[0].NullLastSyncedAtCount} rows with NULL lastSyncedAt. Manual data classification required.`);
    }

    // Guard 3: Duplicate legacy resourceCode check
    const hasResourceCodeCol = await queryRunner.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'client_resource_snapshots' AND COLUMN_NAME = 'resourceCode'
    `);
    if (hasResourceCodeCol.length > 0) {
      const dupCodeTuples: any[] = await queryRunner.query(`
        SELECT clientId, resourceCode, COUNT_BIG(*) AS DuplicateCount
        FROM dbo.client_resource_snapshots
        GROUP BY clientId, resourceCode
        HAVING COUNT_BIG(*) > 1;
      `);
      if (dupCodeTuples.length > 0) {
        throw new Error(`[MIGRATION 0004 PRE-DDL REJECTED] Duplicate (clientId, resourceCode) tuples detected. Cannot preserve unique constraint.`);
      }
    }

    // Guard 4: Duplicate remoteResourceId check (for non-null, non-blank values)
    const dupRemoteTuples: any[] = await queryRunner.query(`
      SELECT clientId, remoteResourceId, COUNT_BIG(*) AS DuplicateCount
      FROM dbo.client_resource_snapshots
      WHERE remoteResourceId IS NOT NULL
        AND LTRIM(RTRIM(remoteResourceId)) <> ''
      GROUP BY clientId, remoteResourceId
      HAVING COUNT_BIG(*) > 1;
    `);
    if (dupRemoteTuples.length > 0) {
      throw new Error(`[MIGRATION 0004 PRE-DDL REJECTED] Duplicate (clientId, remoteResourceId) tuples detected. Cannot create unique index.`);
    }

    // Helper to safely add column if not existing
    const checkAndAddCol = async (colName: string, colDef: string) => {
      const col = await queryRunner.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'client_resource_snapshots' AND COLUMN_NAME = '${colName}'
      `);
      if (col.length === 0) {
        await queryRunner.query(`ALTER TABLE client_resource_snapshots ADD ${colName} ${colDef};`);
      }
    };

    // --------------------------------------------------------------------------
    // 16 MISSING COLUMNS ALIGNMENT
    // --------------------------------------------------------------------------

    // 1. remoteResourceTypeId (NVARCHAR(100) NULL)
    await checkAndAddCol('remoteResourceTypeId', 'NVARCHAR(100) NULL');

    // 2. resourceTypeName (NVARCHAR(150) NULL)
    await checkAndAddCol('resourceTypeName', 'NVARCHAR(150) NULL');
    if (hasLegacyTypeCol.length > 0) {
      await queryRunner.query(`
        UPDATE client_resource_snapshots
        SET resourceTypeName = resourceType
        WHERE resourceTypeName IS NULL AND resourceType IS NOT NULL;
      `);
    }

    // 3. remoteSpecialtyId (NVARCHAR(100) NULL)
    await checkAndAddCol('remoteSpecialtyId', 'NVARCHAR(100) NULL');

    // 4. specialtyName (NVARCHAR(150) NULL)
    await checkAndAddCol('specialtyName', 'NVARCHAR(150) NULL');
    const hasLegacySpecCol = await queryRunner.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'client_resource_snapshots' AND COLUMN_NAME = 'specialization'
    `);
    if (hasLegacySpecCol.length > 0) {
      await queryRunner.query(`
        UPDATE client_resource_snapshots
        SET specialtyName = specialization
        WHERE specialtyName IS NULL AND specialization IS NOT NULL;
      `);
    }

    // 5. colorIdentificationCode (NVARCHAR(10) NOT NULL DEFAULT 'FFFFFF')
    await checkAndAddCol('colorIdentificationCode', "NVARCHAR(10) NOT NULL CONSTRAINT DF_client_resource_snapshots_color DEFAULT 'FFFFFF'");

    // 6. operatingFrom (NVARCHAR(10) NOT NULL DEFAULT '00:00')
    await checkAndAddCol('operatingFrom', "NVARCHAR(10) NOT NULL CONSTRAINT DF_client_resource_snapshots_from DEFAULT '00:00'");

    // 7. operatingTo (NVARCHAR(10) NOT NULL DEFAULT '23:55')
    await checkAndAddCol('operatingTo', "NVARCHAR(10) NOT NULL CONSTRAINT DF_client_resource_snapshots_to DEFAULT '23:55'");

    // 8. selectAllDepartments (BIT NOT NULL DEFAULT 1)
    await checkAndAddCol('selectAllDepartments', 'BIT NOT NULL CONSTRAINT DF_client_resource_snapshots_allDepts DEFAULT 1');

    // 9. selectAllServices (BIT NOT NULL DEFAULT 1)
    await checkAndAddCol('selectAllServices', 'BIT NOT NULL CONSTRAINT DF_client_resource_snapshots_allServs DEFAULT 1');

    // 10. linkedRemoteUserId (NVARCHAR(100) NULL)
    await checkAndAddCol('linkedRemoteUserId', 'NVARCHAR(100) NULL');

    // 11. branchId (NVARCHAR(100) NULL)
    await checkAndAddCol('branchId', 'NVARCHAR(100) NULL');

    // 12. branchName (NVARCHAR(150) NULL)
    await checkAndAddCol('branchName', 'NVARCHAR(150) NULL');

    // 13. remoteStatus (NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE')
    const hasRemoteStatus = await queryRunner.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'client_resource_snapshots' AND COLUMN_NAME = 'remoteStatus'
    `);
    if (hasRemoteStatus.length === 0) {
      const hasLegacyStatus = await queryRunner.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'client_resource_snapshots' AND COLUMN_NAME = 'status'
      `);
      if (hasLegacyStatus.length > 0) {
        await queryRunner.query(`ALTER TABLE client_resource_snapshots ADD remoteStatus NVARCHAR(50) NULL;`);
        await queryRunner.query(`
          UPDATE client_resource_snapshots
          SET remoteStatus = ISNULL(status, 'ACTIVE')
          WHERE remoteStatus IS NULL;
        `);
        await queryRunner.query(`
          ALTER TABLE client_resource_snapshots
          ADD CONSTRAINT DF_client_resource_snapshots_remoteStatus DEFAULT 'ACTIVE' FOR remoteStatus;
        `);
        await queryRunner.query(`ALTER TABLE client_resource_snapshots ALTER COLUMN remoteStatus NVARCHAR(50) NOT NULL;`);
      } else {
        await queryRunner.query(`
          ALTER TABLE client_resource_snapshots
          ADD remoteStatus NVARCHAR(50) NOT NULL CONSTRAINT DF_client_resource_snapshots_remoteStatus DEFAULT 'ACTIVE';
        `);
      }
    }

    // 14. isResourceHuman (BIT NOT NULL)
    const hasHumanCol = await queryRunner.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'client_resource_snapshots' AND COLUMN_NAME = 'isResourceHuman'
    `);
    if (hasHumanCol.length === 0) {
      await queryRunner.query(`ALTER TABLE client_resource_snapshots ADD isResourceHuman BIT NULL;`);
      if (hasLegacyTypeCol.length > 0) {
        await queryRunner.query(`
          UPDATE client_resource_snapshots
          SET isResourceHuman = CASE
            WHEN UPPER(LTRIM(RTRIM(resourceType))) IN ('ROOM', 'EQUIPMENT', 'DEVICE', 'BED', 'FACILITY', 'MACHINE', 'NON_HUMAN', 'NON-HUMAN') THEN 0
            ELSE 1
          END
          WHERE isResourceHuman IS NULL;
        `);
      } else {
        await queryRunner.query(`UPDATE client_resource_snapshots SET isResourceHuman = 1 WHERE isResourceHuman IS NULL;`);
      }

      await queryRunner.query(`
        ALTER TABLE client_resource_snapshots
        ALTER COLUMN isResourceHuman BIT NOT NULL;
      `);
    }

    // 15. isShownInRegistration (BIT NOT NULL, conditional backfill: Human -> 1, Non-Human -> 0, NO permanent default)
    const hasShownRegCol = await queryRunner.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'client_resource_snapshots' AND COLUMN_NAME = 'isShownInRegistration'
    `);
    if (hasShownRegCol.length === 0) {
      await queryRunner.query(`ALTER TABLE client_resource_snapshots ADD isShownInRegistration BIT NULL;`);
      // Conditional backfill based on resolved isResourceHuman
      await queryRunner.query(`
        UPDATE client_resource_snapshots
        SET isShownInRegistration = CASE
          WHEN isResourceHuman = 1 THEN 1
          ELSE 0
        END
        WHERE isShownInRegistration IS NULL;
      `);
      // Validate no NULLs remain
      const nullRegs: any[] = await queryRunner.query(`
        SELECT COUNT_BIG(*) as cnt FROM client_resource_snapshots WHERE isShownInRegistration IS NULL;
      `);
      if (Number(nullRegs[0]?.cnt || 0) > 0) {
        throw new Error(`[MIGRATION 0004 REJECTED] Failed to backfill isShownInRegistration: ${nullRegs[0].cnt} rows remain NULL.`);
      }

      await queryRunner.query(`
        ALTER TABLE client_resource_snapshots
        ALTER COLUMN isShownInRegistration BIT NOT NULL;
      `);
    }

    // 16. lastVerifiedAt (DATETIME2 NOT NULL, Model A explicit lifecycle, strictly backfilled from lastSyncedAt)
    // NO permanent default added to ensure application explicitly supplies verification timestamp
    const hasVerifiedCol = await queryRunner.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'client_resource_snapshots' AND COLUMN_NAME = 'lastVerifiedAt'
    `);
    if (hasVerifiedCol.length === 0) {
      await queryRunner.query(`ALTER TABLE client_resource_snapshots ADD lastVerifiedAt DATETIME2 NULL;`);
      // Strict backfill from lastSyncedAt (historical verified observation). Zero fallback to current time or updatedAt.
      await queryRunner.query(`
        UPDATE client_resource_snapshots
        SET lastVerifiedAt = lastSyncedAt
        WHERE lastVerifiedAt IS NULL;
      `);
      const nullVerified: any[] = await queryRunner.query(`
        SELECT COUNT_BIG(*) as cnt FROM client_resource_snapshots WHERE lastVerifiedAt IS NULL;
      `);
      if (Number(nullVerified[0]?.cnt || 0) > 0) {
        throw new Error(`[MIGRATION 0004 REJECTED] Failed to backfill lastVerifiedAt: ${nullVerified[0].cnt} rows remain NULL.`);
      }

      await queryRunner.query(`
        ALTER TABLE client_resource_snapshots
        ALTER COLUMN lastVerifiedAt DATETIME2 NOT NULL;
      `);
    }

    // --------------------------------------------------------------------------
    // INDEX ALIGNMENT & PRESERVATION
    // --------------------------------------------------------------------------
    // 1. PRESERVE LEGACY UNIQUE INDEX: IDX_client_resource_snapshots_client_code
    // Legacy unique index on (clientId, resourceCode) remains intact!

    // 2. REMOTE-ID UNIQUE INDEX: IDX_client_resource_remote_id
    // Model A: Since MissingRemoteIdRows = 0 in real DB, enforce NOT NULL and standard unique index
    const remoteCol = await queryRunner.query(`
      SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'client_resource_snapshots' AND COLUMN_NAME = 'remoteResourceId'
    `);
    if (remoteCol.length > 0 && remoteCol[0].IS_NULLABLE === 'YES') {
      const missingRemote: any[] = await queryRunner.query(`
        SELECT COUNT_BIG(*) AS cnt
        FROM dbo.client_resource_snapshots
        WHERE remoteResourceId IS NULL OR LTRIM(RTRIM(remoteResourceId)) = '';
      `);
      if (Number(missingRemote[0]?.cnt || 0) === 0) {
        await queryRunner.query(`
          ALTER TABLE client_resource_snapshots
          ALTER COLUMN remoteResourceId NVARCHAR(100) NOT NULL;
        `);
      }
    }

    const hasNewRemoteIdx = await queryRunner.query(`
      SELECT name FROM sys.indexes
      WHERE name = 'IDX_client_resource_remote_id' AND object_id = OBJECT_ID('client_resource_snapshots')
    `);
    if (hasNewRemoteIdx.length === 0) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX IDX_client_resource_remote_id
        ON client_resource_snapshots(clientId, remoteResourceId);
      `);
    }

    // 3. Ensure Index IDX_client_resource_clientId exists
    const hasCliIdx = await queryRunner.query(`
      SELECT name FROM sys.indexes
      WHERE name = 'IDX_client_resource_clientId' AND object_id = OBJECT_ID('client_resource_snapshots')
    `);
    if (hasCliIdx.length === 0) {
      await queryRunner.query(`
        CREATE INDEX IDX_client_resource_clientId ON client_resource_snapshots(clientId);
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Intentional no-op to avoid destructive removal of populated columns.
    // Forward-only corrective migration: Rollback method is a new forward corrective migration.
  }
}
