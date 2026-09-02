import * as crypto from 'crypto';
import { AppDataSource } from '../data-source.js';
import { ApplicationUser } from '../entities/application-user.entity.js';
import { AuditLog } from '../entities/audit-log.entity.js';

export async function revokeCompromisedAccount() {
  console.log('--- Revoking Compromised Default Administrator Account ---');

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const userRepo = AppDataSource.getRepository(ApplicationUser);
  const auditRepo = AppDataSource.getRepository(AuditLog);

  const existingUsers = await userRepo.find({
    where: [{ username: 'superadmin' }, { email: 'admin@hmc-central.local' }],
  });

  const correlationId = crypto.randomUUID();

  if (existingUsers.length === 0) {
    console.log('[INFO] No existing default administrator account found in database.');
    return;
  }

  for (const user of existingUsers) {
    // 1. Invalidate password hash with unusable random string
    user.passwordHash = `$argon2id$v=19$m=65536,t=3,p=4$REVOKED_COMPROMISED_${crypto.randomBytes(32).toString('hex')}`;
    // 2. Lock account
    user.status = 'LOCKED';
    user.failedAttempts = 999;
    user.lockoutUntil = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000); // 100 years lock
    // 3. Invalidate refresh token
    user.refreshTokenHash = null;
    user.updatedBy = 'SECURITY_REMEDIATION';

    await userRepo.save(user);

    // 4. Record remediation in audit log without storing credential values
    const auditEntry = auditRepo.create({
      action: 'SECURITY_REMEDIATION_REVOKE_COMPROMISED_ACCOUNT',
      actorUserId: user.id,
      actorUsername: 'SECURITY_REMEDIATION_AGENT',
      entityType: 'APPLICATION_USER',
      entityId: user.id,
      result: 'SUCCESS',
      detailsJson: JSON.stringify({
        remediation: 'Compromised default administrator credential revoked, account permanently locked, sessions purged',
        targetUserId: user.id,
        targetUsername: user.username,
      }),
      correlationId,
    });
    await auditRepo.save(auditEntry);

    console.log(`[REVOKED] Account "${user.username}" (ID: ${user.id}) locked and credential invalidated.`);
  }

  console.log('[SUCCESS] All compromised default accounts revoked successfully. Audit logged with correlation ID:', correlationId);
}

if (require.main === module) {
  revokeCompromisedAccount()
    .then(() => {
      console.log('Revocation process finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Revocation process failed:', err);
      process.exit(1);
    });
}
