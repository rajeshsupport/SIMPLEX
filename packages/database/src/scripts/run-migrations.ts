import 'reflect-metadata';
import { AppDataSource } from '../data-source.js';
import { InitialSchema1700000000000 } from '../migrations/1700000000000-InitialSchema.js';
import { AddUserDisableFields1700000000001 } from '../migrations/1700000000001-AddUserDisableFields.js';
import { AddClientUserRoleRoute1700000000002 } from '../migrations/1700000000002-AddClientUserRoleRoute.js';
import { AddClientResources1700000000003 } from '../migrations/1700000000003-AddClientResources.js';
import { AlignClientResourceSnapshotsSchema1700000000004 } from '../migrations/1700000000004-AlignClientResourceSnapshotsSchema.js';

export async function runMigrations(): Promise<void> {
  console.log('[MIGRATION] Initializing DataSource for migrations...');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();

  const migrationsList = [
    { timestamp: 1700000000000, name: 'InitialSchema1700000000000', instance: new InitialSchema1700000000000() },
    { timestamp: 1700000000001, name: 'AddUserDisableFields1700000000001', instance: new AddUserDisableFields1700000000001() },
    { timestamp: 1700000000002, name: 'AddClientUserRoleRoute1700000000002', instance: new AddClientUserRoleRoute1700000000002() },
    { timestamp: 1700000000003, name: 'AddClientResources1700000000003', instance: new AddClientResources1700000000003() },
    { timestamp: 1700000000004, name: 'AlignClientResourceSnapshotsSchema1700000000004', instance: new AlignClientResourceSnapshotsSchema1700000000004() },
  ];

  try {
    // Create migrations table if not exists
    await queryRunner.query(`
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

    for (const mig of migrationsList) {
      const existing: any[] = await queryRunner.query(
        'SELECT * FROM migrations WHERE name = @0',
        [mig.name]
      );

      if (existing.length === 0) {
        console.log(`[MIGRATION] Executing ${mig.name}...`);
        await mig.instance.up(queryRunner);
        await queryRunner.query(
          'INSERT INTO migrations (timestamp, name) VALUES (@0, @1)',
          [mig.timestamp, mig.name]
        );
        console.log(`[MIGRATION] Migration ${mig.name} applied successfully.`);
      } else {
        console.log(`[MIGRATION] ${mig.name} already applied.`);
      }
    }
  } finally {
    await queryRunner.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('[MIGRATION] Process finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[MIGRATION] Migration error:', err);
      process.exit(1);
    });
}
