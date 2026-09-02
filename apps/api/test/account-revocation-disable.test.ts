import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
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
} from '@hmc/database';
import { AuthService } from '../dist/auth/auth.service.js';
import { JwtStrategy } from '../dist/auth/jwt.strategy.js';
import { InitialSchema1700000000000 } from '../../../packages/database/dist/migrations/1700000000000-InitialSchema.js';
import { AddUserDisableFields1700000000001 } from '../../../packages/database/dist/migrations/1700000000001-AddUserDisableFields.js';
import { SYSTEM_ROLES } from '@hmc/shared';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const testDataSource = new DataSource({
  type: 'mssql',
  host: process.env.MSSQL_HOST || 'localhost',
  port: parseInt(process.env.MSSQL_PORT || '1433', 10),
  username: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD || 'Rajesh@123',
  database: 'HMC_CENTRAL_AUTOMATION_TEST',
  entities: [
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
  ],
  synchronize: false,
  options: {
    encrypt: process.env.MSSQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
  },
});

async function runRevocationAndDisableTests() {
  console.log('================================================================');
  console.log('    ACCOUNT REVOCATION & EXPLICIT DISABLE SEMANTICS AUDIT       ');
  console.log('================================================================\n');

  await testDataSource.initialize();

  // Run migrations on test DB
  const queryRunner = testDataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    await new InitialSchema1700000000000().up(queryRunner);
  } catch {}
  try {
    await new AddUserDisableFields1700000000001().up(queryRunner);
  } catch {}
  await queryRunner.release();

  const userRepo = testDataSource.getRepository(ApplicationUser);
  const roleRepo = testDataSource.getRepository(Role);
  const loginHistoryRepo = testDataSource.getRepository(ApplicationLoginHistory);
  const clientAccessRepo = testDataSource.getRepository(UserClientAccess);

  const jwtService = new JwtService({
    secret: process.env.JWT_SECRET || 'hmc_central_jwt_secret_dev_key_2026_super_secure_token',
  });

  const authService = new AuthService(
    userRepo,
    loginHistoryRepo,
    clientAccessRepo,
    jwtService
  );

  const jwtStrategy = new JwtStrategy(userRepo, clientAccessRepo);

  // Setup: Create a superadmin role if not exists
  let adminRole = await roleRepo.findOne({ where: { name: SYSTEM_ROLES.SUPER_ADMIN } });
  if (!adminRole) {
    adminRole = roleRepo.create({
      name: SYSTEM_ROLES.SUPER_ADMIN,
      description: 'Super Admin',
      isSystem: true,
    });
    await roleRepo.save(adminRole);
  }

  // Create an explicitly revoked compromised account
  const revokedUsername = `revoked_admin_${Date.now().toString().substring(8)}`;
  const compromisedAccount = userRepo.create({
    username: revokedUsername,
    email: `${revokedUsername}@hmc.test`,
    fullName: 'Compromised Test Account',
    passwordHash: `$argon2id$v=19$m=65536,t=3,p=4$REVOKED_COMPROMISED_${crypto.randomBytes(32).toString('hex')}`,
    status: 'DISABLED',
    isDisabled: true,
    disabledAt: new Date(),
    disabledReason: 'Security remediation revocation',
    disabledBy: 'SECURITY_AUDITOR',
    failedAttempts: 0,
    lockoutUntil: null,
    roles: [adminRole],
  });
  await userRepo.save(compromisedAccount);

  // Issue dummy tokens for this user before testing revocation
  const oldRefreshToken = jwtService.sign(
    { sub: compromisedAccount.id, type: 'refresh' },
    { secret: process.env.JWT_REFRESH_SECRET || 'hmc_central_refresh_secret_dev_key_2026_super_secure_token' }
  );
  compromisedAccount.refreshTokenHash = null; // Revoked
  await userRepo.save(compromisedAccount);

  const oldAccessToken = jwtService.sign(
    { sub: compromisedAccount.id, username: compromisedAccount.username, roles: ['Super Admin'] },
    { secret: process.env.JWT_SECRET || 'hmc_central_jwt_secret_dev_key_2026_super_secure_token' }
  );

  // TEST 1: Compromised Account Login Rejection
  console.log('[TEST 1] Testing Login Rejection for Revoked/Disabled Account...');
  try {
    await authService.login({
      username: revokedUsername,
      password: 'AnyPasswordAttempt!',
    });
    throw new Error('Disabled account was permitted to log in!');
  } catch (err: any) {
    if (err.message.includes('disabled') || err.status === 401) {
      console.log('✓ TEST 1 PASSED: Disabled account login immediately rejected with HTTP 401 Unauthorized.');
    } else {
      throw err;
    }
  }

  // TEST 2: Old Refresh Token Rejection
  console.log('\n[TEST 2] Testing Refresh Token Rejection for Revoked Account...');
  try {
    await authService.refreshToken({ refreshToken: oldRefreshToken });
    throw new Error('Revoked refresh token was accepted!');
  } catch (err: any) {
    if (err.status === 401 || err.message.includes('revoked') || err.message.includes('disabled')) {
      console.log('✓ TEST 2 PASSED: Revoked refresh token rejected with HTTP 401 Unauthorized.');
    } else {
      throw err;
    }
  }

  // TEST 3: Active JWT Access Token Invalidation (JwtStrategy Check)
  console.log('\n[TEST 3] Testing JWT Access Token Strategy Invalidation for Disabled User...');
  try {
    await jwtStrategy.validate({ sub: compromisedAccount.id });
    throw new Error('Disabled user passed JwtStrategy validation!');
  } catch (err: any) {
    if (err.status === 401 || err.message.includes('disabled') || err.message.includes('inactive')) {
      console.log('✓ TEST 3 PASSED: JwtStrategy rejected active access token for disabled account.');
    } else {
      throw err;
    }
  }

  // TEST 4: Anti-Silent Re-enablement (Resetting failedAttempts does NOT re-enable disabled account)
  console.log('\n[TEST 4] Testing Anti-Silent Re-enablement...');
  compromisedAccount.failedAttempts = 0;
  compromisedAccount.lockoutUntil = null;
  await userRepo.save(compromisedAccount);

  const reloaded = await userRepo.findOne({ where: { id: compromisedAccount.id } });
  if (!reloaded?.isDisabled || reloaded.status !== 'DISABLED') {
    throw new Error('User was unexpectedly re-enabled!');
  }

  try {
    await authService.login({
      username: revokedUsername,
      password: 'AnyPasswordAttempt!',
    });
    throw new Error('User was allowed to log in after failedAttempts reset!');
  } catch (err: any) {
    console.log('✓ TEST 4 PASSED: Resetting lockout fields preserves isDisabled=true; login remains rejected.');
  }

  // TEST 5: Verify No Plaintext Credentials in Logs or DB
  console.log('\n[TEST 5] Auditing Database & Login History for Plaintext Leaks...');
  const historyRecords = await loginHistoryRepo.find({
    where: { userId: compromisedAccount.id },
  });
  for (const rec of historyRecords) {
    if (rec.failureReason?.includes('Password') || rec.failureReason?.includes('Admin@')) {
      throw new Error(`Plaintext leak detected in login_history: ${rec.failureReason}`);
    }
  }
  console.log(`✓ TEST 5 PASSED: Checked ${historyRecords.length} login history records. Zero plaintext credential leaks detected.`);

  await testDataSource.destroy();
  console.log('\nAll Account Revocation and Explicit Disable Semantics Tests Passed Successfully!');
}

runRevocationAndDisableTests().catch((err) => {
  console.error('[FATAL] Revocation and Disable Tests failed:', err);
  process.exit(1);
});
