import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientUserLastVerifiedAt1700000000005 implements MigrationInterface {
  name = 'AddClientUserLastVerifiedAt1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Verify dbo.client_user_snapshots exists specifically in 'dbo' schema
    const tableExists: any[] = await queryRunner.query(`
      SELECT 1
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'client_user_snapshots';
    `);

    if (!tableExists || tableExists.length === 0) {
      throw new Error(
        '[MIGRATION 0005 PRECHECK FAILED] Required table [dbo].[client_user_snapshots] does not exist. ' +
        'Cannot apply AddClientUserLastVerifiedAt1700000000005.'
      );
    }

    // 2. Check INFORMATION_SCHEMA with TABLE_SCHEMA = 'dbo' before alteration
    const colExists: any[] = await queryRunner.query(`
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'client_user_snapshots'
        AND COLUMN_NAME = 'lastVerifiedAt';
    `);

    // 3. Add [lastVerifiedAt] DATETIME2 NULL only when missing
    // Existing rows remain NULL (no backfill, no default constraint) because they have not been proven by the new live-role verification workflow.
    if (colExists.length === 0) {
      await queryRunner.query(`
        ALTER TABLE [dbo].[client_user_snapshots]
        ADD [lastVerifiedAt] DATETIME2 NULL;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Intentional no-op following forward-only safety policy.
    // Avoids destructive removal of populated verification data.
  }
}
