import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as argon2 from 'argon2';
import { AppDataSource } from '../data-source.js';
import { ApplicationUser } from '../entities/application-user.entity.js';
import { AuditLog } from '../entities/audit-log.entity.js';
import { Role } from '../entities/role.entity.js';
import { bootstrapAdmin } from '../scripts/admin-bootstrap.js';
import { SYSTEM_ROLES } from '@hmc/shared';

async function runBootstrapLeakAudit() {
  console.log('================================================================');
  console.log('    BOOTSTRAP OUTPUT, LOG & PLAINTEXT LEAK INTEGRITY AUDIT      ');
  console.log('================================================================\n');

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const roleRepo = AppDataSource.getRepository(Role);
  const userRepo = AppDataSource.getRepository(ApplicationUser);
  const auditRepo = AppDataSource.getRepository(AuditLog);

  let superAdminRole = await roleRepo.findOne({ where: { name: SYSTEM_ROLES.SUPER_ADMIN } });
  if (!superAdminRole) {
    superAdminRole = roleRepo.create({
      name: SYSTEM_ROLES.SUPER_ADMIN,
      description: 'Super Admin',
      isSystem: true,
    });
    await roleRepo.save(superAdminRole);
  }

  const controlledSecret = 'ControlledSecret_LeakAudit_2026!';
  const controlledSecretSubstring1 = 'ControlledSecret';
  const controlledSecretSubstring2 = 'LeakAudit_2026';
  const testUsername = `leak_audit_admin_${Date.now().toString().substring(8)}`;

  // Capture buffers
  let capturedStdout = '';
  let capturedStderr = '';

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  // Hook stdout and stderr
  (process.stdout as any).write = (chunk: any, encoding?: any, callback?: any) => {
    capturedStdout += chunk.toString();
    return originalStdoutWrite(chunk, encoding, callback);
  };
  (process.stderr as any).write = (chunk: any, encoding?: any, callback?: any) => {
    capturedStderr += chunk.toString();
    return originalStderrWrite(chunk, encoding, callback);
  };

  try {
    console.log('[STEP 1] Executing Bootstrap with Controlled Test Password...');
    await bootstrapAdmin({
      username: testUsername,
      email: `${testUsername}@hmc-test.local`,
      password: controlledSecret,
      forceReset: true,
    });
  } finally {
    // Restore stdout/stderr
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  console.log('\n[STEP 2] Auditing Captured Output, Stderr, DB Fields, and Audit Logs for Leaks...');

  // 1. Audit stdout / stderr
  const stdoutHasSecret = capturedStdout.includes(controlledSecret) || capturedStdout.includes(controlledSecretSubstring1);
  const stderrHasSecret = capturedStderr.includes(controlledSecret) || capturedStderr.includes(controlledSecretSubstring1);

  if (stdoutHasSecret) throw new Error('CRITICAL LEAK: Controlled password leaked to stdout during bootstrap!');
  if (stderrHasSecret) throw new Error('CRITICAL LEAK: Controlled password leaked to stderr during bootstrap!');
  console.log('✓ stdout & stderr: 0 plaintext matches found.');

  // 2. Audit Database User Record
  const createdUser = await userRepo.findOne({ where: { username: testUsername } });
  if (!createdUser) throw new Error('Failed to find created test user in database!');

  if (createdUser.passwordHash.includes(controlledSecret) || createdUser.passwordHash.includes(controlledSecretSubstring1)) {
    throw new Error('CRITICAL LEAK: Plaintext password found in database user record!');
  }
  if (!createdUser.passwordHash.startsWith('$argon2id$')) {
    throw new Error('Password hash is not a valid Argon2id hash!');
  }
  const isHashValid = await argon2.verify(createdUser.passwordHash, controlledSecret);
  if (!isHashValid) throw new Error('Argon2id verification failed against controlled secret!');
  console.log('✓ Database User Record: Stored strictly as verified Argon2id hash (0 plaintext matches).');

  // 3. Audit Audit Log Details
  const auditEntries = await auditRepo.find({
    where: { actorUsername: testUsername },
  });
  for (const entry of auditEntries) {
    const detailsStr = entry.detailsJson || '';
    if (detailsStr.includes(controlledSecret) || detailsStr.includes(controlledSecretSubstring1)) {
      throw new Error(`CRITICAL LEAK: Plaintext password found in audit log entry ${entry.id}!`);
    }
  }
  console.log(`✓ Audit Logs: Checked ${auditEntries.length} audit records. 0 plaintext matches found in detailsJson.`);

  // 4. Audit Temporary Files
  const tempDir = os.tmpdir();
  const tempFiles = fs.readdirSync(tempDir);
  let tempLeaks = 0;
  for (const file of tempFiles) {
    if (file.startsWith('hmc-') && file.endsWith('.tmp')) {
      const content = fs.readFileSync(path.join(tempDir, file), 'utf8');
      if (content.includes(controlledSecret)) tempLeaks++;
    }
  }
  if (tempLeaks > 0) throw new Error('CRITICAL LEAK: Plaintext password found in temporary file!');
  console.log('✓ Temporary Files: 0 plaintext matches found.');

  // Clean up only temporary test records
  await userRepo.delete({ id: createdUser.id });
  await auditRepo.delete({ actorUsername: testUsername });

  console.log('\n✓ Bootstrap Output & Plaintext Leak Integrity Audit Passed: ZERO Plaintext Leaks Detected.');
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}

runBootstrapLeakAudit()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FATAL] Leak Audit failed:', err);
    process.exit(1);
  });
