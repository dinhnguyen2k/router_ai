/**
 * At-rest protection for stored provider credentials.
 *
 * The database sits on the operator's own disk, so this is not a defence
 * against someone who owns the machine. It exists so that a copied .db file, a
 * backup, or an accidental screen share does not hand over usable API keys.
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/** Encrypts a credential into a self-describing `v1.iv.tag.ciphertext` string. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Reverses encryptSecret. Throws when the payload was written with a different
 * key, which is the signal that ROUTER_SECRET changed and the stored
 * credentials need to be re-entered.
 */
export function decryptSecret(payload: string, key: Buffer): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('stored credential is not in the expected format');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Produces the display form of a credential.
 *
 * Short keys are fully redacted rather than partially shown, because revealing
 * 8 of 12 characters is worse than revealing none.
 */
export function maskSecret(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 12) return '••••••••';
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}
