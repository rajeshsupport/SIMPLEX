import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientUserRoleRoute1700000000002 implements MigrationInterface {
  name = 'AddClientUserRoleRoute1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table: any[] = await queryRunner.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'clients' AND COLUMN_NAME = 'userRoleRoute'
    `);

    if (table.length === 0) {
      await queryRunner.query(`
        ALTER TABLE clients
        ADD userRoleRoute NVARCHAR(255) NULL CONSTRAINT DF_clients_userRoleRoute DEFAULT '/addUserRole';
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE clients DROP CONSTRAINT IF EXISTS DF_clients_userRoleRoute;
      ALTER TABLE clients DROP COLUMN IF EXISTS userRoleRoute;
    `);
  }
}
