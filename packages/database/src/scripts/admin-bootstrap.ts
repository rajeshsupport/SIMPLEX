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
    if (!process.stdin.isTTY) {
      // Non-interactive fallback
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        rl.close();
        resolve(line.trim());
      });
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

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

export function validatePasswordPolicy(password: string): { valid: boolean; reason?: string } {
  if (!password || password.length < 10) {
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

export async function bootstrapAdmin(options?: {
  username?: string;
  email?: string;
  password?: string;
  forceReset?: boolean;
}) {
  console.log('================================================================');
  console.log('      HMC Central Operations Console - Super Admin Bootstrap    ');
  console.log('================================================================');
  console.log('This utility securely initializes or resets the root Super Administrator.');
  console.log('No default passwords exist. You must configure a secure master password.\n');

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const roleRepo = AppDataSource.getRepository(Role);
  const superAdminRole = await roleRepo.findOne({ where: { name: SYSTEM_ROLES.SUPER_ADMIN } });
  if (!superAdminRole) {
    console.error('[ERROR] Super Admin role not found. Please run "pnpm db:seed" first.');
    process.exit(1);
  }

  const username = options?.username || (await promptText('Enter Super Admin username (default: superadmin): ')) || 'superadmin';

  const userRepo = AppDataSource.getRepository(ApplicationUser);
  const existingUser = await userRepo.findOne({
    where: { username },
    relations: ['roles'],
  });

  if (existingUser && !options?.forceReset) {
    console.log(`\n[WARNING] An administrator account with username "${username}" already exists.`);
    const confirmOverwrite = await promptText('Do you want to securely reset this administrator password? (y/N): ');
    if (confirmOverwrite.toLowerCase() !== 'y' && confirmOverwrite.toLowerCase() !== 'yes') {
      console.log('Operation aborted. No changes were made.');
      process.exit(0);
    }
  }

  let email = options?.email || 'admin@hmc-central.local';
  if (!existingUser && !options?.email) {
    const emailInput = await promptText('Enter Super Admin email (default: admin@hmc-central.local): ');
    email = emailInput || 'admin@hmc-central.local';
  }

  let password = options?.password || '';
  let isValid = false;

  while (!isValid) {
    if (!password) {
      password = await promptHidden('Enter Super Admin password: ');
    }
    const check = validatePasswordPolicy(password);
    if (!check.valid) {
      console.log(`[POLICY REJECTED] ${check.reason}. Please try again.\n`);
      password = '';
      if (options?.password) {
        throw new Error(`Password policy violation: ${check.reason}`);
      }
      continue;
    }

    if (!options?.password) {
      const confirmPassword = await promptHidden('Confirm Super Admin password: ');
      if (password !== confirmPassword) {
        console.log('[ERROR] Passwords do not match. Please try again.\n');
        password = '';
        continue;
      }
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

  // Execute in database transaction
  await AppDataSource.transaction(async (manager) => {
    const txUserRepo = manager.getRepository(ApplicationUser);
    const txAuditRepo = manager.getRepository(AuditLog);

    if (existingUser) {
      existingUser.passwordHash = passwordHash;
      existingUser.status = 'ACTIVE';
      existingUser.isDisabled = false;
      existingUser.disabledAt = null;
      existingUser.disabledReason = null;
      existingUser.disabledBy = null;
      existingUser.failedAttempts = 0;
      existingUser.lockoutUntil = null;
      existingUser.refreshTokenHash = null; // Revoke all sessions
      existingUser.requirePasswordChange = false;
      existingUser.updatedBy = 'CLI_BOOTSTRAP';

      if (!existingUser.roles.some((r) => r.name === SYSTEM_ROLES.SUPER_ADMIN)) {
        existingUser.roles.push(superAdminRole);
      }

      await txUserRepo.save(existingUser);

      const auditEntry = txAuditRepo.create({
        action: 'ADMIN_CREDENTIAL_RESET_BOOTSTRAP',
        actorUserId: existingUser.id,
        actorUsername: existingUser.username,
        entityType: 'APPLICATION_USER',
        entityId: existingUser.id,
        result: 'SUCCESS',
        detailsJson: JSON.stringify({ message: 'Super Admin password reset via CLI bootstrap' }),
        correlationId,
      });
      await txAuditRepo.save(auditEntry);

      console.log(`[SUCCESS] Super Admin account "${username}" password has been securely reset.`);
      console.log('[AUDIT] Reset event recorded in audit_logs with correlation ID:', correlationId);
    } else {
      const newUser = txUserRepo.create({
        username,
        email,
        fullName: 'System Super Administrator',
        passwordHash,
        status: 'ACTIVE',
        isDisabled: false,
        roles: [superAdminRole],
        requirePasswordChange: false,
        createdBy: 'CLI_BOOTSTRAP',
      });
      await txUserRepo.save(newUser);

      const auditEntry = txAuditRepo.create({
        action: 'ADMIN_ACCOUNT_BOOTSTRAP',
        actorUserId: newUser.id,
        actorUsername: newUser.username,
        entityType: 'APPLICATION_USER',
        entityId: newUser.id,
        result: 'SUCCESS',
        detailsJson: JSON.stringify({ message: 'Initial Super Admin account created via CLI bootstrap' }),
        correlationId,
      });
      await txAuditRepo.save(auditEntry);

      console.log(`[SUCCESS] Super Admin account "${username}" has been successfully created.`);
      console.log('[AUDIT] Bootstrap event recorded in audit_logs with correlation ID:', correlationId);
    }
  });

  console.log('\nBootstrap complete. You may now log in to the console.\n');
}

if (require.main === module) {
  bootstrapAdmin()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[FATAL] Bootstrap failed:', err);
      process.exit(1);
    });
}
