/**
 * Central security redaction protection.
 * Automatically masks sensitive credential and password fields from any object or JSON string.
 */
import crypto from 'node:crypto';


const SENSITIVE_KEY_PATTERNS = [
  /^password$/i,
  /^defaultpassword$/i,
  /^generatedpassword$/i,
  /^temporarypassword$/i,
  /^initialpassword$/i,
  /^ephemeraldefaultpassword$/i,
  /^newpassword$/i,
  /^credential$/i,
  /^secret$/i,
  /password/i,
  /secret/i,
];

export function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactSensitiveData<T = any>(data: T, depth = 0): T {
  if (depth > 10 || data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item, depth + 1)) as unknown as T;
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED_SECRET]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redactSensitiveData(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}

export function safeJsonStringify(data: any, space?: number): string {
  try {
    return JSON.stringify(redactSensitiveData(data), null, space);
  } catch {
    return JSON.stringify({ error: 'FAILED_TO_SERIALIZE_OBJECT' });
  }
}

/**
 * SHA-256 digest of an empty byte sequence ("").
 * Explicitly forbidden in any valid acknowledgement or event hash.
 */
export const SHA256_EMPTY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Validates that a value is a cryptographically sound 256-bit hex event ID (64 characters, non-zero).
 */
export function isValidOneTimeEventId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 64 &&
    /^[a-f0-9]{64}$/i.test(value) &&
    value !== '0'.repeat(64)
  );
}

/**
 * Asserts that a value is a valid 64-hex-character one-time event ID. Throws EPHEMERAL_EVENT_ID_INVALID if invalid.
 */
export function assertValidOneTimeEventId(value: unknown): asserts value is string {
  if (!isValidOneTimeEventId(value)) {
    throw new Error('EPHEMERAL_EVENT_ID_INVALID');
  }
}

/**
 * Computes a SHA-256 hex digest over a validated 64-character hex event ID.
 * Strictly guarantees the hash is 64 characters, differs from the raw ID, and does not equal SHA256_EMPTY_DIGEST.
 */
export function computeOneTimeEventIdHash(oneTimeEventId: string): string {
  assertValidOneTimeEventId(oneTimeEventId);
  const hash = crypto.createHash('sha256').update(Buffer.from(oneTimeEventId, 'utf8')).digest('hex');
  if (hash === SHA256_EMPTY_DIGEST || hash === oneTimeEventId || hash.length !== 64) {
    throw new Error('EPHEMERAL_EVENT_ID_HASH_INVALID');
  }
  return hash;
}
