import * as crypto from 'crypto';
import {
  JwtPayload,
  CredentialDeliveryStatus,
  PERMISSIONS,
  assertValidOneTimeEventId,
  computeOneTimeEventIdHash,
} from '@hmc/shared';

export interface StoredEphemeralCredential {
  oneTimeEventId: string;
  oneTimeEventIdHash: string;
  initiatingOperatorId: string;
  initiatingSessionId?: string;
  clientId: string;
  jobId?: string;
  rowNumber?: number;
  username: string;
  fullName?: string;
  password?: string | null;
  createdAt: number;
  hardExpiresAt: number;
  displayDurationSeconds: number;
}

export class EphemeralCredentialStore {
  public static readonly store = new Map<string, StoredEphemeralCredential>();

  public static storeEphemeralCredential(payload: {
    initiatingOperatorId: string;
    initiatingSessionId?: string;
    clientId: string;
    jobId?: string;
    rowNumber?: number;
    username: string;
    fullName?: string;
    password?: string | null;
    user?: JwtPayload;
  }): { oneTimeEventId: string; oneTimeEventIdHash: string; credentialDeliveryStatus: CredentialDeliveryStatus } {
    // Purge expired entries
    const now = Date.now();
    for (const [id, item] of EphemeralCredentialStore.store.entries()) {
      if (now > item.hardExpiresAt) {
        EphemeralCredentialStore.store.delete(id);
      }
    }

    const hasCredentialViewPermission = Boolean(
      !payload.user ||
      payload.user.isSuperAdmin ||
      (payload.user.permissions && (
        payload.user.permissions.includes('client_user.credential_view') ||
        payload.user.permissions.includes(PERMISSIONS.CLIENT_USER_CREDENTIAL_VIEW as any) ||
        payload.user.permissions.includes('CLIENT_USER_CREDENTIAL_VIEW' as any)
      ))
    );

    const oneTimeEventId = crypto.randomBytes(32).toString('hex');
    assertValidOneTimeEventId(oneTimeEventId);
    const oneTimeEventIdHash = computeOneTimeEventIdHash(oneTimeEventId);

    if (!hasCredentialViewPermission) {
      return {
        oneTimeEventId,
        oneTimeEventIdHash,
        credentialDeliveryStatus: 'RESTRICTED',
      };
    }

    if (!payload.password) {
      return {
        oneTimeEventId,
        oneTimeEventIdHash,
        credentialDeliveryStatus: 'UNAVAILABLE',
      };
    }

    EphemeralCredentialStore.store.set(oneTimeEventId, {
      oneTimeEventId,
      oneTimeEventIdHash,
      initiatingOperatorId: payload.initiatingOperatorId,
      initiatingSessionId: payload.initiatingSessionId || payload.user?.sessionId,
      clientId: payload.clientId,
      jobId: payload.jobId,
      rowNumber: payload.rowNumber,
      username: payload.username,
      fullName: payload.fullName,
      password: payload.password,
      createdAt: now,
      hardExpiresAt: now + 300000, // 5 minutes hard expiry
      displayDurationSeconds: 60,
    });

    return {
      oneTimeEventId,
      oneTimeEventIdHash,
      credentialDeliveryStatus: 'DELIVERED',
    };
  }
}
