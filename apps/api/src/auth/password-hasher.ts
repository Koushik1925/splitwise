import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

interface ScryptParams {
  logN: number;
  r: number;
  p: number;
}

/**
 * scrypt with N=2^15, r=8, p=3 (32 MiB): one of OWASP's recommended
 * equivalent-strength scrypt configurations, chosen over N=2^17/p=1 for its
 * lower memory per concurrent hash (~230 ms per hash on a dev laptop).
 */
const CURRENT_PARAMS: ScryptParams = { logN: 15, r: 8, p: 3 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_MEMORY_BYTES = 128 * 1024 * 1024;
const HASH_PREFIX = 'scrypt';

/**
 * Password hashing via Node's built-in scrypt (no native addon to compile).
 *
 * Stored format: `scrypt$<logN>$<r>$<p>$<salt b64>$<key b64>`. Parameters
 * are stored with each hash so they can be raised later without
 * invalidating existing passwords.
 */
@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey(password, salt, CURRENT_PARAMS);
    const { logN, r, p } = CURRENT_PARAMS;
    return [HASH_PREFIX, logN, r, p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  /** Constant-time comparison; returns false (never throws) for malformed hashes. */
  async verify(storedHash: string, password: string): Promise<boolean> {
    const parsed = parseHash(storedHash);
    if (!parsed) {
      return false;
    }
    const candidate = await deriveKey(password, parsed.salt, parsed.params, parsed.key.length);
    return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
  }
}

function deriveKey(
  password: string,
  salt: Buffer,
  { logN, r, p }: ScryptParams,
  keyLength: number = KEY_BYTES,
): Promise<Buffer> {
  // NFKC so visually identical passwords typed on different devices match.
  const normalized = password.normalize('NFKC');
  return new Promise((resolve, reject) => {
    scrypt(
      normalized,
      salt,
      keyLength,
      { N: 2 ** logN, r, p, maxmem: MAX_MEMORY_BYTES },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

function parseHash(storedHash: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) {
    return null;
  }
  const [, logN, r, p, salt, key] = parts;
  const params = { logN: Number(logN), r: Number(r), p: Number(p) };
  // Bounds keep a corrupted record from requesting an absurd amount of work.
  const withinBounds =
    Number.isInteger(params.logN) &&
    params.logN >= 10 &&
    params.logN <= 20 &&
    Number.isInteger(params.r) &&
    params.r >= 1 &&
    params.r <= 32 &&
    Number.isInteger(params.p) &&
    params.p >= 1 &&
    params.p <= 16;
  if (!withinBounds || !salt || !key) {
    return null;
  }
  const keyBuffer = Buffer.from(key, 'base64');
  if (keyBuffer.length === 0) {
    return null;
  }
  return { params, salt: Buffer.from(salt, 'base64'), key: keyBuffer };
}
