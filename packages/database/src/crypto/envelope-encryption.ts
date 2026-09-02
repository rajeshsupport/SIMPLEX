import * as crypto from 'crypto';

export interface EncryptedPayload {
  cipherText: string; // Base64
  iv: string;         // Base64 (12 bytes)
  tag: string;        // Base64 (16 bytes)
  keyVersion: number;
}

export class EnvelopeEncryption {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12; // 96 bits for GCM
  private static readonly TAG_LENGTH = 16;
  private static readonly CURRENT_KEY_VERSION = 1;

  private static getMasterKey(): Buffer {
    const keyHex = process.env.ENCRYPTION_MASTER_KEY;
    if (!keyHex) {
      throw new Error('ENCRYPTION_MASTER_KEY environment variable is not defined.');
    }
    const key = Buffer.from(keyHex.trim(), 'hex');
    if (key.length !== 32) {
      // Fallback: If provided as raw utf8 string or base64
      if (Buffer.from(keyHex, 'utf8').length === 32) {
        return Buffer.from(keyHex, 'utf8');
      }
      const base64Key = Buffer.from(keyHex, 'base64');
      if (base64Key.length === 32) {
        return base64Key;
      }
      throw new Error(`ENCRYPTION_MASTER_KEY must be a 32-byte (256-bit) hex key. Current length: ${key.length} bytes.`);
    }
    return key;
  }

  /**
   * Encrypts plaintext string using AES-256-GCM
   */
  public static encrypt(plainText: string): EncryptedPayload {
    if (plainText === undefined || plainText === null) {
      throw new Error('Cannot encrypt undefined or null payload');
    }

    const masterKey = this.getMasterKey();
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, masterKey, iv, {
      authTagLength: this.TAG_LENGTH,
    });

    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      cipherText: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      keyVersion: this.CURRENT_KEY_VERSION,
    };
  }

  /**
   * Decrypts encrypted payload using AES-256-GCM
   */
  public static decrypt(payload: { cipherText: string; iv: string; tag: string; keyVersion?: number }): string {
    const masterKey = this.getMasterKey();
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const encryptedText = Buffer.from(payload.cipherText, 'base64');

    const decipher = crypto.createDecipheriv(this.ALGORITHM, masterKey, iv, {
      authTagLength: this.TAG_LENGTH,
    });
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Masks a credential (username or secret) for safe display in UI/Logs
   */
  public static maskSecret(value: string | undefined | null): string {
    if (!value) return '********';
    if (value.length <= 4) return '****';
    return value.substring(0, 2) + '****' + value.substring(value.length - 2);
  }
}
