import * as readline from 'readline';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import { AppDataSource } from '../data-source.js';
import { ApplicationUser } from '../entities/application-user.entity.js';
import { Role } from '../entities/role.entity.js';
import { AuditLog } from '../entities/audit-log.entity.js';
import { SYSTEM_ROLES } from '@hmc/shared';

function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Mask output during password entry
    let isMasking = true;
    (rl as any)._writeToOutput = function _writeToOutput(stringToWrite: string) {
      if (isMasking && stringToWrite !== '\r\n' && stringToWrite !== '\n' && stringToWrite !== query) {
        (rl as any).output.write('*');
      } else {
        (rl as any).output.write(stringToWrite);
      }
    };

    rl.question(query, (value) => {
      isMasking = false;
      rl.close();
      console.log('');
      resolve(value);
    });
  });
}

function promptText(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (value) => {
      rl.close();
      resolve(value.trim());
    });
  });
}

function validatePasswordPolicy(password: string): { valid: boolean; reason?: string } {
  if (password.length < 10) {
    return { valid: false, reason: 'Password must be at least 10 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one uppercase letter (A-Z)' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one lowercase letter (a-z)' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one numeric digit (0-9)' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one special character' };
  }
  return { valid: true };
}

export async function bootstrapAdmin() {
  console.log('================================================================');
  console.log('      HMC Central Operations Console - Super Admin Bootstrap    ');
  console.log('================================================================');
  console.log('This utility securely initializes or resets the root Super Administrator.');
  console.log('No default passwords exist. You must configure a secure master password.\n');

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const userRepo = AppDataSource.getRepository(ApplicationUser);
  const roleRepo = AppDataSource.getRepository(Role);
  const auditRepo = AppDataSource.getRepository(AuditLog);

  const superAdminRole = await roleRepo.findOne({ where: { name: SYSTEM_ROLES.SUPER_ADMIN } });
  if (!superAdminRole) {
    console.error('[ERROR] Super Admin role not found. Please run "pnpm db:seed" first.');
    process.exit(1);
  }

  const usernameInput = await promptText('Enter Super Admin username (default: superadmin): ');
  const username = usernameInput || 'superadmin';

  const existingUser = await userRepo.findOne({
    where: { username },
    relations: ['roles'],
  });

  if (existingUser) {
    console.log(`\n[WARNING] An administrator account with username "${username}" already exists.`);
    const confirmOverwrite = await promptText('Do you want to securely reset this administrator password? (y/N): ');
    if (confirmOverwrite.toLowerCase() !== 'y' && confirmOverwrite.toLowerCase() !== 'yes') {
      console.log('Operation aborted. No changes were made.');
      process.exit(0);
    }
  }

  let email = 'admin@hmc-central.local';
  if (!existingUser) {
    const emailInput = await promptText('Enter Super Admin email (default: admin@hmc-central.local): ');
    email = emailInput || 'admin@hmc-central.local';
  }

  let password = '';
  let isValid = false;

  while (!isValid) {
    password = await promptHidden('Enter Super Admin password: ');
    const check = validatePasswordPolicy(password);
    if (!check.valid) {
      console.log(`[POLICY REJECTED] ${check.reason}. Please try again.\n`);
      continue;
    }

    const confirmPassword = await promptHidden('Confirm Super Admin password: ');
    if (password !== confirmPassword) {
      console.log('[ERROR] Passwords do not match. Please try again.\n');
      continue;
    }

    isValid = true;
  }

  console.log('\nHashing credential with Argon2id (memoryCost=64MB, timeCost=3, parallelism=4)...');
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const correlationId = crypto.randomUUID();

  if (existingUser) {
    existingUser.passwordHash = passwordHash;
    existingUser.status = 'ACTIVE';
    existingUser.failedAttempts = 0;
    existingUser.lockoutUntil = null;
    existingUser.refreshTokenHash = null; // Revoke all sessions
    existingUser.requirePasswordChange = false;
    existingUser.updatedBy = 'CLI_BOOTSTRAP';

    // Ensure role is assigned
    if (!existingUser.roles.some((r) => r.name === SYSTEM_ROLES.SUPER_ADMIN)) {
      existingUser.roles.push(superAdminRole);
    }

    await userRepo.save(existingUser);

    const auditEntry = auditRepo.create({
      action: 'ADMIN_CREDENTIAL_RESET_BOOTSTRAP',
      actorUserId: existingUser.id,
      actorUsername: existingUser.username,
      entityType: 'APPLICATION_USER',
      entityId: existingUser.id,
      result: 'SUCCESS',
      detailsJson: JSON.stringify({ message: 'Super Admin password reset via CLI bootstrap' }),
      correlationId,
    });
    await auditRepo.save(auditEntry);

    console.log(`[SUCCESS] Super Admin account "${username}" password has been securely reset.`);
    console.log('[AUDIT] Reset event recorded in audit_logs with correlation ID:', correlationId);
  } else {
    const newUser = userRepo.create({
      username,
      email,
      fullName: 'System Super Administrator',
      passwordHash,
      status: 'ACTIVE',
      roles: [superAdminRole],
      requirePasswordChange: false,
      createdBy: 'CLI_BOOTSTRAP',
    });
    await userRepo.save(newUser);

    const auditEntry = auditRepo.create({
      action: 'ADMIN_ACCOUNT_BOOTSTRAP',
      actorUserId: newUser.id,
      actorUsername: newUser.username,
      entityType: 'APPLICATION_USER',
      entityId: newUser.id,
      result: 'SUCCESS',
      detailsJson: JSON.stringify({ message: 'Initial Super Admin account created via CLI bootstrap' }),
      correlationId,
    });
    await auditRepo.save(auditEntry);

    console.log(`[SUCCESS] Super Admin account "${username}" has been successfully created.`);
    console.log('[AUDIT] Bootstrap event recorded in audit_logs with correlation ID:', correlationId);
  }

  console.log('\nBootstrap complete. You may now log in to the console.\n');
  process.exit(0);
}

if (require.main === module) {
  bootstrapAdmin().catch((err) => {
    console.error('[FATAL] Bootstrap failed:', err);
    process.exit(1);
  });
}
