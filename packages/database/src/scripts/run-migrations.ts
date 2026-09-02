import 'reflect-metadata';
import { AppDataSource } from '../data-source.js';
import { InitialSchema1700000000000 } from '../migrations/1700000000000-InitialSchema.js';

export async function runMigrations(): Promise<void> {
  console.log('[MIGRATION] Initializing DataSource for migrations...');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  console.log('[MIGRATION] Executing InitialSchema1700000000000 migration...');
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();

  const migration = new InitialSchema1700000000000();
  try {
    await migration.up(queryRunner);
    console.log('[MIGRATION] Migration InitialSchema1700000000000 applied successfully.');
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
