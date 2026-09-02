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

  public static validateMasterKeyEntropy(keyHex: string): void {
    if (!keyHex || typeof keyHex !== 'string') {
      throw new Error('ENCRYPTION_MASTER_KEY is not defined or is not a string');
    }
    const cleanHex = keyHex.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
      throw new Error('ENCRYPTION_MASTER_KEY must be exactly 64 hexadecimal characters (256-bit key)');
    }

    // Entropy check: unique character count and byte diversity
    const uniqueChars = new Set(cleanHex.toLowerCase());
    if (uniqueChars.size < 8) {
      throw new Error('ENCRYPTION_MASTER_KEY fails entropy threshold (insufficient character diversity)');
    }

    const keyBuf = Buffer.from(cleanHex, 'hex');
    const uniqueBytes = new Set(keyBuf);
    if (uniqueBytes.size < 12) {
      throw new Error('ENCRYPTION_MASTER_KEY fails entropy threshold (insufficient byte diversity)');
    }
  }

  private static getMasterKey(): Buffer {
    const keyHex = process.env.ENCRYPTION_MASTER_KEY;
    if (!keyHex) {
      throw new Error('ENCRYPTION_MASTER_KEY environment variable is not defined.');
    }
    this.validateMasterKeyEntropy(keyHex);
    return Buffer.from(keyHex.trim(), 'hex');
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
