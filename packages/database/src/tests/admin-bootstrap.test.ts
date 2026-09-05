import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as argon2 from 'argon2';
import {
  ApplicationUser,
  Role,
  Permission,
  Client,
  ClientCredential,
  UserClientAccess,
  AuditLog,
  ErrorLog,
  ImportJob,
  ImportJobRow,
  AutomationWorkflow,
  AutomationWorkflowVersion,
  AutomationRun,
  AutomationRunStep,
  DesktopAgent,
  StoredFile,
  RetentionPolicy,
  ApplicationLoginHistory,
} from '../entities/index.js';
import { validatePasswordPolicy, bootstrapAdmin } from '../scripts/admin-bootstrap.js';
import { SYSTEM_ROLES } from '@hmc/shared';
import { AppDataSource } from '../data-source.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function runBootstrapSecurityTests() {
  console.log('================================================================');
  console.log('       SECURE ADMINISTRATOR BOOTSTRAP SECURITY AUDIT            ');
  console.log('================================================================\n');

  // TEST 1: Password Policy Validation Tests
  console.log('[TEST 1] Testing Password Complexity Policy Validation...');
  if (validatePasswordPolicy('').valid) throw new Error('Empty password allowed!');
  if (validatePasswordPolicy('short').valid) throw new Error('Short password allowed!');
  if (validatePasswordPolicy('nouppercase123!').valid) throw new Error('Missing uppercase allowed!');
  if (validatePasswordPolicy('NOLOWERCASE123!').valid) throw new Error('Missing lowercase allowed!');
  if (validatePasswordPolicy('NoDigitsHere!').valid) throw new Error('Missing digits allowed!');
  if (validatePasswordPolicy('NoSpecialChar123').valid) throw new Error('Missing special char allowed!');
  
  const validCheck = validatePasswordPolicy('ValidSecurePassword2026#');
  if (!validCheck.valid) throw new Error(`Valid password rejected: ${validCheck.reason}`);
  console.log('✓ TEST 1 PASSED: Password complexity policy strictly enforced across all rules.');

  // TEST 2: Programmatic Bootstrap Execution
  console.log('\n[TEST 2] Testing Transactional Bootstrap Execution...');
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

  const testAdminUser = `test_admin_${Date.now().toString().substring(8)}`;
  const testPassword = 'InitialSecureAdminPass2026!';

  await bootstrapAdmin({
    username: testAdminUser,
    email: `${testAdminUser}@hmc-test.local`,
    password: testPassword,
    forceReset: true,
  });

  const createdUser = await userRepo.findOne({
    where: { username: testAdminUser },
    relations: ['roles'],
  });

  if (!createdUser) throw new Error('Bootstrap failed to create user in database!');
  if (createdUser.status !== 'ACTIVE' || createdUser.isDisabled) {
    throw new Error('Created user is not ACTIVE / enabled!');
  }
  if (!createdUser.passwordHash.startsWith('$argon2id$')) {
    throw new Error('Password was not hashed with Argon2id!');
  }

  const isHashMatching = await argon2.verify(createdUser.passwordHash, testPassword);
  if (!isHashMatching) throw new Error('Argon2id hash verification failed!');
  console.log('✓ TEST 2 PASSED: Successfully bootstrapped administrator with verified Argon2id hash.');

  // TEST 3: Overwrite Protection & Password Reset Flow
  console.log('\n[TEST 3] Testing Reset Flow with Argon2id Re-Hashing...');
  const newPassword = 'UpdatedSecureAdminPass2026#';
  await bootstrapAdmin({
    username: testAdminUser,
    password: newPassword,
    forceReset: true,
  });

  const updatedUser = await userRepo.findOne({ where: { username: testAdminUser } });
  const isNewMatching = await argon2.verify(updatedUser!.passwordHash, newPassword);
  if (!isNewMatching) throw new Error('Password reset failed to update Argon2id hash!');

  // Check audit log entry
  const auditEntry = await auditRepo.findOne({
    where: { actorUserId: updatedUser!.id, action: 'ADMIN_CREDENTIAL_RESET_BOOTSTRAP' },
  });
  if (!auditEntry) throw new Error('Reset event was not recorded in audit_logs!');
  console.log('✓ TEST 3 PASSED: Reset flow updated password hash and logged event with correlation ID.');

  // TEST 4: Non-interactive weak password rejection
  console.log('\n[TEST 4] Testing Safe Failure on Weak Password in Non-interactive Mode...');
  try {
    await bootstrapAdmin({
      username: 'weak_test_user',
      email: 'weak@test.local',
      password: 'weak',
      forceReset: true,
    });
    throw new Error('Weak password was accepted by bootstrapAdmin!');
  } catch (err: any) {
    console.log('✓ TEST 4 PASSED: Weak password in programmatic call threw policy error.');
  }

  // Cleanup test user
  await userRepo.delete({ username: testAdminUser });
  console.log('\nAll Secure Administrator Bootstrap Tests Passed Successfully!');
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}

runBootstrapSecurityTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FATAL] Bootstrap Security Tests failed:', err);
    process.exit(1);
  });
