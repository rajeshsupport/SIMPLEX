import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserDisableFields1700000000001 implements MigrationInterface {
  name = 'AddUserDisableFields1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add columns if they do not exist
    const table: any[] = await queryRunner.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'application_users' AND COLUMN_NAME = 'isDisabled'
    `);

    if (table.length === 0) {
      await queryRunner.query(`
        ALTER TABLE application_users 
        ADD isDisabled BIT NOT NULL CONSTRAINT DF_application_users_isDisabled DEFAULT 0,
            disabledAt DATETIME2 NULL,
            disabledReason NVARCHAR(500) NULL,
            disabledBy NVARCHAR(100) NULL;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE application_users DROP CONSTRAINT IF EXISTS DF_application_users_isDisabled;
      ALTER TABLE application_users DROP COLUMN IF EXISTS isDisabled;
      ALTER TABLE application_users DROP COLUMN IF EXISTS disabledAt;
      ALTER TABLE application_users DROP COLUMN IF EXISTS disabledReason;
      ALTER TABLE application_users DROP COLUMN IF EXISTS disabledBy;
    `);
  }
}
