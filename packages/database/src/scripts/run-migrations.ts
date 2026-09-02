import 'reflect-metadata';
import { AppDataSource } from '../data-source.js';
import { InitialSchema1700000000000 } from '../migrations/1700000000000-InitialSchema.js';

export async function runMigrations(): Promise<void> {
  console.log('[MIGRATION] Initializing DataSource for migrations...');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();

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

    const existing: any[] = await queryRunner.query(
      "SELECT * FROM migrations WHERE name = 'InitialSchema1700000000000'"
    );

    if (existing.length === 0) {
      console.log('[MIGRATION] Executing InitialSchema1700000000000 migration...');
      const migration = new InitialSchema1700000000000();
      await migration.up(queryRunner);

      await queryRunner.query(
        "INSERT INTO migrations (timestamp, name) VALUES (1700000000000, 'InitialSchema1700000000000')"
      );
      console.log('[MIGRATION] Migration InitialSchema1700000000000 applied successfully.');
    } else {
      console.log('[MIGRATION] InitialSchema1700000000000 already applied.');
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
