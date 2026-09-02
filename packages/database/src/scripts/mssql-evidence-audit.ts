import { AppDataSource } from '../data-source.js';

async function runMssqlAudit() {
  console.log('================================================================');
  console.log('            MICROSOFT SQL SERVER 2022 EVIDENCE AUDIT            ');
  console.log('================================================================\n');

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  // 1. Version Check
  const versionRes: any[] = await AppDataSource.query('SELECT @@VERSION as version');
  const fullVersion = versionRes[0].version;
  console.log('[1. DATABASE ENGINE VERSION]');
  console.log(fullVersion.split('\n')[0]);

  // 2. Database Inventory Check (Verify HR_MSSQL untouched)
  console.log('\n[2. DATABASE ISOLATION & INVENTORY]');
  const dbRes: any[] = await AppDataSource.query(`
    SELECT name, create_date, state_desc 
    FROM sys.databases 
    WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
    ORDER BY name
  `);
  console.table(dbRes);

  // 3. Ensure HMC_CENTRAL_AUTOMATION_TEST exists
  console.log('\n[3. TEST DATABASE INITIALIZATION]');
  await AppDataSource.query(`
    IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'HMC_CENTRAL_AUTOMATION_TEST')
    BEGIN
      CREATE DATABASE HMC_CENTRAL_AUTOMATION_TEST;
    END
  `);
  console.log('✓ HMC_CENTRAL_AUTOMATION_TEST verified and ready.');

  // 4. Schema & Migrations
  console.log('\n[4. HMC_CENTRAL_AUTOMATION SCHEMA & MIGRATIONS]');
  const migrationRes: any[] = await AppDataSource.query('SELECT * FROM migrations ORDER BY timestamp ASC');
  console.log('Applied Migrations:');
  console.table(migrationRes);

  // Table count
  const tablesRes: any[] = await AppDataSource.query(`
    SELECT name, create_date 
    FROM sys.tables 
    WHERE is_ms_shipped = 0 
    ORDER BY name
  `);
  console.log(`Created Tables Count: ${tablesRes.length}`);
  console.table(tablesRes.map((t: any) => ({ TableName: t.name, CreatedAt: t.create_date })));

  // Seeded Roles & Permissions
  const roleCountRes: any[] = await AppDataSource.query('SELECT COUNT(*) as count FROM roles');
  const permCountRes: any[] = await AppDataSource.query('SELECT COUNT(*) as count FROM permissions');
  console.log(`\n[5. SEEDED SYSTEM METADATA]`);
  console.log(`- Seeded Roles: ${roleCountRes[0].count}`);
  console.log(`- Seeded Permissions: ${permCountRes[0].count}`);

  // Foreign Keys & Constraints
  console.log('\n[6. FOREIGN KEYS & CONSTRAINTS]');
  const fkRes: any[] = await AppDataSource.query(`
    SELECT 
      fk.name AS ForeignKeyName,
      OBJECT_NAME(fk.parent_object_id) AS ParentTable,
      OBJECT_NAME(fk.referenced_object_id) AS ReferencedTable
    FROM sys.foreign_keys fk
    ORDER BY ParentTable, ForeignKeyName
  `);
  console.log(`Total Foreign Keys: ${fkRes.length}`);
  console.table(fkRes);

  // Key & Unique Constraints
  const uniqueRes: any[] = await AppDataSource.query(`
    SELECT 
      name AS ConstraintName,
      OBJECT_NAME(parent_object_id) AS TableName,
      type_desc AS ConstraintType
    FROM sys.key_constraints
    WHERE type IN ('UQ', 'PK')
    ORDER BY TableName, ConstraintName
  `);
  console.log(`Total Key & Unique Constraints: ${uniqueRes.length}`);

  // 7. Audit Log of Revoked Account
  console.log('\n[7. REMEDIATION AUDIT LOG VERIFICATION]');
  const auditRes: any[] = await AppDataSource.query(`
    SELECT TOP 5 id, timestamp, actorUsername, action, result, correlationId, detailsJson 
    FROM audit_logs 
    ORDER BY timestamp DESC
  `);
  console.table(auditRes);

  await AppDataSource.destroy();
  console.log('\n✓ MSSQL Evidence Audit Completed Successfully.');
}

runMssqlAudit().catch((err) => {
  console.error('[FATAL] MSSQL Audit failed:', err);
  process.exit(1);
});
