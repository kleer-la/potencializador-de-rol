import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
/** 16 MiB of memory per hash: inside Node's default `maxmem` (32 MiB). */
const COST: ScryptOptions = { N: 16_384, r: 8, p: 1 };

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const derive = (password: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) =>
      error === null ? resolve(key) : reject(error),
    );
  });

/** `scrypt$N$r$p$salt$key`, salt and key in base64url, so the cost can rise later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** `false` for a wrong password and for a stored value it cannot read. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || key === undefined) return false;
  const expected = Buffer.from(key, 'base64url');
  let actual: Buffer;
  try {
    actual = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p) });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash of a random password: checked when the email has no password, so the answer takes as long. */
export const decoyPasswordHash = hashPassword(randomBytes(32).toString('base64url'));
