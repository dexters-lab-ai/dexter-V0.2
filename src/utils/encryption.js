import CryptoJS from 'crypto-js';
import { config } from '../core/config.js';

// Get the encryption keys from config
const CURRENT_KEY = config.mongoEncryptionKey;
const OLD_KEY = "a2c7e899c9f8ea461b8d7a3e498b2e34a5c6e1bcb3d72e4a8d5b4aebc2f09f1a"; //i forgot old wallets 

/**
 * Parse the current encryption key as a CryptoJS WordArray.
 */
function getParsedCurrentKey() {
  if (!CURRENT_KEY) throw new Error('Encryption key not configured');
  return CryptoJS.enc.Utf8.parse(CURRENT_KEY);
}

/**
 * Returns an array of possible decryption keys (new and old ones).
 */
function getPossibleKeys() {
  return [
    { label: 'current', key: getParsedCurrentKey() },
    { label: 'old-utf8', key: CryptoJS.enc.Utf8.parse(OLD_KEY) },
    { label: 'old-hex', key: CryptoJS.enc.Hex.parse(OLD_KEY) }
  ];
}

/**
 * Encrypts a given text using AES-256-CBC with a random IV.
 * Returns the encrypted data in format: `IV:Ciphertext`
 *
 * @param {string} text - The plaintext to encrypt.
 * @returns {string} - The IV and encrypted data combined.
 */
export function encrypt(text) {
  if (typeof text !== "string" || !text.trim()) {
    console.error("❌ Encryption error: Input must be a non-empty string.", text);
    throw new Error("Encryption failed: Input must be a valid string");
  }

  try {
    const key = getParsedCurrentKey();
    const iv = CryptoJS.lib.WordArray.random(16);

    // Step 1: Remove spaces safely (replace " " with "__")
    const normalizedText = text.replace(/ /g, "__");

    // Step 2: Encrypt the modified text with no spaces 
    const encrypted = CryptoJS.AES.encrypt(normalizedText, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });

    return `${CryptoJS.enc.Base64.stringify(iv)}:${encrypted.toString()}`;
  } catch (error) {
    console.error("❌ Encryption error:", error.message || error);
    throw new Error("Failed to encrypt data");
  }
}

/**
 * Decrypts an encrypted private key using multiple possible keys and formats.
 * Tries different decryption techniques for backward compatibility.
 *
 * @param {string} ciphertext - The encrypted private key.
 * @returns {string|null} - The decrypted private key or null if decryption fails.
 */
export function decrypt(ciphertext) {
  console.log('🔍 Attempting to decrypt:', ciphertext);

  if (!ciphertext) {
    console.warn('⚠️ Empty ciphertext provided.');
    return null;
  }

  // If it's already a raw private key (128-character hex), return as-is.
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(ciphertext)) {
    console.warn('⚠️ Detected raw private key (hex), returning as-is.');
    return ciphertext;
  }

  const possibleKeys = getPossibleKeys();

  // ----- NEW FORMAT (with IV in Base64) -----
  if (ciphertext.includes(':')) {
    const [ivBase64, encryptedData] = ciphertext.split(':');

    try {
      const iv = CryptoJS.enc.Base64.parse(ivBase64); // Decode IV from Base64

      for (const candidate of possibleKeys) {
        const options = {
          iv: iv,
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7,
        };

        const decryptedText = tryDecrypt(encryptedData, candidate.key, options);
        if (decryptedText) {
          console.log(`✅ Successfully decrypted using key: ${candidate.label}`);
          // Restore spaces from "__" back to " "
          return decryptedText.replace(/__/g, " ");
        }
      }
    } catch (error) {
      console.error('❌ New format decryption failed:', error.message);
    }
  } else {
    // ----- LEGACY FORMAT: Try different decryption methods -----
    for (const candidate of possibleKeys) {
      const key = candidate.key;
      const zeroIV = CryptoJS.enc.Hex.parse('00000000000000000000000000000000');

      // Approach 1: CBC mode with zero IV
      const optionsCBC = {
        iv: zeroIV,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      };
      let decryptedText = tryDecrypt(ciphertext, key, optionsCBC);
      if (decryptedText) {
        console.log(`✅ Legacy decryption (CBC, zero IV) succeeded with key: ${candidate.label}`);
        return decryptedText;
      }

      // Approach 2: ECB mode (no IV required)
      const optionsECB = {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
      };
      decryptedText = tryDecrypt(ciphertext, key, optionsECB);
      if (decryptedText) {
        console.log(`✅ Legacy decryption (ECB) succeeded with key: ${candidate.label}`);
        return decryptedText;
      }
    }

    console.warn('❌ Legacy decryption failed with all keys and methods.');
  }

  return null; // If all decryption attempts fail
}

/**
 * Helper function to attempt decryption using a given key and options.
 * @param {string} ciphertext - The encrypted text.
 * @param {CryptoJS.WordArray} key - The encryption key.
 * @param {object} options - CryptoJS decryption options.
 * @returns {string|null} - Decrypted text or null.
 */
function tryDecrypt(ciphertext, key, options) {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key, options);
    const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
    return decryptedText || null;
  } catch (err) {
    return null;
  }
}
