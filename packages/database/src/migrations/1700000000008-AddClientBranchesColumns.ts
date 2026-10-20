import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientBranchesColumns1700000000008 implements MigrationInterface {
  name = 'AddClientBranchesColumns1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'clients'
    `);
    if (tableExists.length === 0) {
      return;
    }

    await queryRunner.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.clients') AND name = 'branchName'
      )
      BEGIN
        ALTER TABLE dbo.clients ADD branchName NVARCHAR(255) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.clients') AND name = 'branchesJson'
      )
      BEGIN
        ALTER TABLE dbo.clients ADD branchesJson NVARCHAR(MAX) NULL;
      END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      IF EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.clients') AND name = 'branchesJson'
      )
      BEGIN
        ALTER TABLE dbo.clients DROP COLUMN branchesJson;
      END
    `);

    await queryRunner.query(`
      IF EXISTS (
        SELECT 1 FROM sys.columns 
        WHERE object_id = OBJECT_ID('dbo.clients') AND name = 'branchName'
      )
      BEGIN
        ALTER TABLE dbo.clients DROP COLUMN branchName;
      END
    `);
  }
}
