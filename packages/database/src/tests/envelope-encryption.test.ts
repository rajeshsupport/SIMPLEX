import { EnvelopeEncryption } from '../crypto/envelope-encryption.js';

// Setup dev master key for test
process.env.ENCRYPTION_MASTER_KEY = 'e8b839655f46a7be7e3c15c6b7582b1c853f6517a942bcba5e7e600d89e574ac';

function runEncryptionTests() {
  console.log('--- Testing AES-256-GCM Envelope Encryption ---');

  const secretPlaintext = 'SuperSecretClientDatabasePassword#2026!';
  const encrypted = EnvelopeEncryption.encrypt(secretPlaintext);

  if (!encrypted.cipherText || !encrypted.iv || !encrypted.tag) {
    throw new Error('Encryption output missing cipherText, IV, or Auth Tag');
  }

  const decrypted = EnvelopeEncryption.decrypt(encrypted);
  if (decrypted !== secretPlaintext) {
    throw new Error(`Decrypted text mismatch! Expected: ${secretPlaintext}, Got: ${decrypted}`);
  }
  console.log('✓ Encryption/Decryption roundtrip successful.');

  // Test Tampering Detection (GCM Authentication Tag check)
  try {
    const tamperedPayload = {
      ...encrypted,
      cipherText: Buffer.from('TamperedData').toString('base64'),
    };
    EnvelopeEncryption.decrypt(tamperedPayload);
    throw new Error('GCM tag should have failed on tampered ciphertext!');
  } catch (err: any) {
    if (err.message.includes('GCM tag should have failed')) {
      throw err;
    }
    console.log('✓ Tampering successfully rejected by GCM authentication tag.');
  }

  // Test Masking
  const maskedUser = EnvelopeEncryption.maskSecret('administrator@client.com');
  if (!maskedUser.startsWith('ad') || !maskedUser.endsWith('om') || !maskedUser.includes('****')) {
    throw new Error(`Unexpected masking output: ${maskedUser}`);
  }
  console.log('✓ Credential masking validated.');

  console.log('All Envelope Encryption tests passed successfully!');
}

runEncryptionTests();
