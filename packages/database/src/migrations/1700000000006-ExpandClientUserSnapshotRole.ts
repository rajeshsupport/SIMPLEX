import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandClientUserSnapshotRole1700000000006 implements MigrationInterface {
  name = 'ExpandClientUserSnapshotRole1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Verify DB target is an explicitly allowed central database
    const dbRes: any[] = await queryRunner.query('SELECT DB_NAME() AS currentDb;');
    const currentDb = dbRes?.[0]?.currentDb || '';
    const allowedDatabases = new Set([
      'HMC_CENTRAL_AUTOMATION',
      'HMC_CENTRAL_AUTOMATION_TEST',
    ]);

    if (!allowedDatabases.has(currentDb)) {
      throw new Error(
        `[MIGRATION 0006 PRECHECK FAILED] Unauthorized database target: '${currentDb}'. ` +
        `Migration 0006 may only be applied to authorized central databases: ${Array.from(allowedDatabases).join(', ')}.`
      );
    }

    // 2. Verify table [dbo].[client_user_snapshots] exists specifically in 'dbo' schema
    const tableCheck: any[] = await queryRunner.query(`
      SELECT 1
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'client_user_snapshots';
    `);

    if (!tableCheck || tableCheck.length === 0) {
      throw new Error(
        '[MIGRATION 0006 PRECHECK FAILED] Required table [dbo].[client_user_snapshots] does not exist. ' +
        'Cannot apply ExpandClientUserSnapshotRole1700000000006.'
      );
    }

    // 3. Verify [role] column exists in [dbo].[client_user_snapshots]
    const colCheck: any[] = await queryRunner.query(`
      SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'client_user_snapshots'
        AND COLUMN_NAME = 'role';
    `);

    if (!colCheck || colCheck.length === 0) {
      throw new Error(
        '[MIGRATION 0006 PRECHECK FAILED] Required column [role] does not exist on [dbo].[client_user_snapshots]. ' +
        'Cannot apply ExpandClientUserSnapshotRole1700000000006.'
      );
    }

    const currentType = String(colCheck[0].DATA_TYPE || '').toLowerCase();
    const currentMaxLength = Number(colCheck[0].CHARACTER_MAXIMUM_LENGTH);
    const currentNullable = String(colCheck[0].IS_NULLABLE || '').toUpperCase();

    // 4. Verify current type is NVARCHAR and nullable
    if (currentType !== 'nvarchar') {
      throw new Error(
        `[MIGRATION 0006 PRECHECK FAILED] Expected [role] data type to be nvarchar, got '${currentType}'.`
      );
    }

    if (currentNullable !== 'YES') {
      throw new Error(
        `[MIGRATION 0006 PRECHECK FAILED] Expected [role] to be nullable (IS_NULLABLE = YES), got '${currentNullable}'.`
      );
    }

    // 5. Verify maximum length is either 100 (needs alter) or -1 (already MAX)
    if (currentMaxLength !== 100 && currentMaxLength !== -1) {
      throw new Error(
        `[MIGRATION 0006 PRECHECK FAILED] Unexpected CHARACTER_MAXIMUM_LENGTH for [role]: ${currentMaxLength}. ` +
        `Expected 100 or -1 (MAX).`
      );
    }

    // 6. Check migration 0006 is not already recorded and no duplicate records exist in [dbo].[migrations]
    const migTableCheck: any[] = await queryRunner.query(`
      SELECT 1
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'migrations';
    `);

    if (migTableCheck && migTableCheck.length > 0) {
      const existingMig: any[] = await queryRunner.query(
        `SELECT id, name FROM [dbo].[migrations] WHERE name = 'ExpandClientUserSnapshotRole1700000000006';`
      );
      if (existingMig.length > 1) {
        throw new Error(
          `[MIGRATION 0006 PRECHECK FAILED] Duplicate migration records detected in [dbo].[migrations] for ExpandClientUserSnapshotRole1700000000006.`
        );
      }
      if (existingMig.length > 0 && currentMaxLength === 100) {
        throw new Error(
          `[MIGRATION 0006 PRECHECK FAILED] Migration ExpandClientUserSnapshotRole1700000000006 is already recorded in [dbo].[migrations], but column [role] has not been expanded (still NVARCHAR(100)). Inconsistent migration state.`
        );
      }
    }

    // 7. Verify no index, unique constraint, computed column, schema-bound object, trigger, or foreign key depends on [role]
    const dependencyCheck: any[] = await queryRunner.query(`
      SELECT DISTINCT depName, depType
      FROM (
        -- 1. Indexes & Unique Constraints
        SELECT i.name AS depName, 'INDEX / CONSTRAINT' AS depType
        FROM sys.index_columns ic
        JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        JOIN sys.objects o ON ic.object_id = o.object_id
        WHERE o.name = 'client_user_snapshots' AND SCHEMA_NAME(o.schema_id) = 'dbo' AND c.name = 'role'

        UNION ALL

        -- 2. Foreign Keys
        SELECT fk.name AS depName, 'FOREIGN KEY' AS depType
        FROM sys.foreign_key_columns fkc
        JOIN sys.foreign_keys fk ON fkc.constraint_object_id = fk.object_id
        JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
        JOIN sys.objects o ON fkc.parent_object_id = o.object_id
        WHERE o.name = 'client_user_snapshots' AND SCHEMA_NAME(o.schema_id) = 'dbo' AND c.name = 'role'

        UNION ALL

        -- 3. Default Constraints
        SELECT d.name AS depName, 'DEFAULT CONSTRAINT' AS depType
        FROM sys.default_constraints d
        JOIN sys.columns c ON d.parent_object_id = c.object_id AND d.parent_column_id = c.column_id
        JOIN sys.objects o ON d.parent_object_id = o.object_id
        WHERE o.name = 'client_user_snapshots' AND SCHEMA_NAME(o.schema_id) = 'dbo' AND c.name = 'role'

        UNION ALL

        -- 4. Check Constraints
        SELECT chk.name AS depName, 'CHECK CONSTRAINT' AS depType
        FROM sys.check_constraints chk
        JOIN sys.columns c ON chk.parent_object_id = c.object_id AND chk.parent_column_id = c.column_id
        JOIN sys.objects o ON chk.parent_object_id = o.object_id
        WHERE o.name = 'client_user_snapshots' AND SCHEMA_NAME(o.schema_id) = 'dbo' AND c.name = 'role'

        UNION ALL

        -- 5. Computed Columns referencing role via exact IDs
        SELECT cc.name AS depName, 'COMPUTED COLUMN' AS depType
        FROM sys.computed_columns cc
        JOIN sys.sql_expression_dependencies sed
          ON sed.referencing_id = cc.object_id
         AND sed.referencing_minor_id = cc.column_id
        WHERE cc.object_id = OBJECT_ID(N'[dbo].[client_user_snapshots]')
          AND sed.referenced_id = OBJECT_ID(N'[dbo].[client_user_snapshots]')
          AND sed.referenced_minor_id =
              COLUMNPROPERTY(
                OBJECT_ID(N'[dbo].[client_user_snapshots]'),
                'role',
                'ColumnId'
              )

        UNION ALL

        -- 6. Schema-bound views/functions & Expression Dependencies
        SELECT OBJECT_NAME(sed.referencing_id) AS depName, o.type_desc AS depType
        FROM sys.sql_expression_dependencies sed
        JOIN sys.objects o ON sed.referencing_id = o.object_id
        WHERE sed.referenced_id = OBJECT_ID(N'[dbo].[client_user_snapshots]')
          AND sed.referenced_minor_id = COLUMNPROPERTY(OBJECT_ID(N'[dbo].[client_user_snapshots]'), 'role', 'ColumnId')

        UNION ALL

        -- 7. Triggers referencing role with token-boundary awareness
        SELECT t.name AS depName, 'TRIGGER' AS depType
        FROM sys.triggers t
        CROSS APPLY (SELECT OBJECT_DEFINITION(t.object_id) + ' ' AS def) defs
        WHERE t.parent_id = OBJECT_ID(N'[dbo].[client_user_snapshots]')
          AND (
            CHARINDEX(N'[role]', defs.def) > 0
            OR CHARINDEX(N'UPDATE(role)', REPLACE(defs.def, ' ', '')) > 0
            OR CHARINDEX(N'UPDATE([role])', REPLACE(defs.def, ' ', '')) > 0
            OR PATINDEX(N'%.role[^a-zA-Z0-9_]%', defs.def) > 0
            OR PATINDEX(N'%[^a-zA-Z0-9_]role[^a-zA-Z0-9_]%', defs.def) > 0
          )
      ) allDeps;
    `);

    if (dependencyCheck && dependencyCheck.length > 0) {
      throw new Error(
        `[MIGRATION 0006 PRECHECK FAILED] Column [role] has active dependencies (${dependencyCheck.map((d: any) => `${d.depType}: ${d.depName}`).join(', ')}). ` +
        `Cannot safely alter to NVARCHAR(MAX).`
      );
    }

    // 8. Idempotency: Alter only if currently NVARCHAR(100); if already NVARCHAR(MAX) (-1), perform no DDL
    if (currentMaxLength === 100) {
      await queryRunner.query(`
        ALTER TABLE [dbo].[client_user_snapshots]
        ALTER COLUMN [role] NVARCHAR(MAX) NULL;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Intentional no-op under forward-only migration safety policy.
    // Narrowing NVARCHAR(MAX) back to NVARCHAR(100) would cause silent truncation or DDL failure if multi-role strings exceed 100 characters.
  }
}
