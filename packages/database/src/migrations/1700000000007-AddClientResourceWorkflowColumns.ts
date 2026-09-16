import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientResourceWorkflowColumns1700000000007 implements MigrationInterface {
  name = 'AddClientResourceWorkflowColumns1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Check table existence
    const tableExists = await queryRunner.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'client_resource_snapshots'
    `);
    if (tableExists.length === 0) {
      return;
    }

    // 2. Additive, idempotent column additions (strictly nullable, zero fabricated backfill)
    await queryRunner.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.client_resource_snapshots') AND name = 'workflowStage'
      )
      BEGIN
        ALTER TABLE dbo.client_resource_snapshots ADD workflowStage NVARCHAR(50) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.client_resource_snapshots') AND name = 'eclaimStatus'
      )
      BEGIN
        ALTER TABLE dbo.client_resource_snapshots ADD eclaimStatus NVARCHAR(50) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.client_resource_snapshots') AND name = 'eclaimConfigJson'
      )
      BEGIN
        ALTER TABLE dbo.client_resource_snapshots ADD eclaimConfigJson NVARCHAR(MAX) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.client_resource_snapshots') AND name = 'emrFormsJson'
      )
      BEGIN
        ALTER TABLE dbo.client_resource_snapshots ADD emrFormsJson NVARCHAR(MAX) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.client_resource_snapshots') AND name = 'transferConfigJson'
      )
      BEGIN
        ALTER TABLE dbo.client_resource_snapshots ADD transferConfigJson NVARCHAR(MAX) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.client_resource_snapshots') AND name = 'retryResumeState'
      )
      BEGIN
        ALTER TABLE dbo.client_resource_snapshots ADD retryResumeState NVARCHAR(50) NULL;
      END
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Non-destructive down policy: preserve all data in place to prevent data loss
  }
}
