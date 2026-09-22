/**
 * Turning a passphrase into something safe to store, with Node's own
 * crypto and nothing from npm.
 *
 * `scrypt` is in `node:crypto`, it is memory-hard, and it is what lets this
 * file exist without a dependency — which matters here more than usual,
 * because a password hash is exactly the wrong place to take a supply-chain
 * risk. Argon2id would be the modern first choice and it is not in the
 * standard library; scrypt at these parameters is the right answer for a
 * service that has decided its server code carries no npm package it does
 * not have to.
 *
 * ## The parameters, and why they are in the stored string
 *
 * N=32768, r=8, p=1 costs about 32 MB and a fraction of a second per
 * attempt, which is unnoticeable on a sign-in and ruinous at scale on a
 * stolen table. They are written into every hash — `scrypt$N$r$p$salt$key`
 * — so that raising them later does not invalidate the hashes already
 * stored: an old hash still says how to verify itself, and the account can
 * be re-hashed at its next successful sign-in.
 *
 * ## Timing
 *
 * `verify` compares with `timingSafeEqual`, and `spendTime` exists so that
 * a sign-in against an address with no account costs the same as one
 * against an address with an account. Without it, the single honest "those
 * do not match" sentence the domain insists on would be undone by a
 * stopwatch: a fast answer means no such account, and the customer list is
 * exactly what this is protecting.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 32_768;
const R = 8;
const P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** 128 · N · r is scrypt's working set; twice that leaves room to breathe. */
const MAX_MEM = 128 * N * R * 2;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Normalised so that a passphrase typed on a Mac and the same one typed
    // on Windows hash alike: the two platforms disagree about how to encode
    // an accented character, and a person locked out of their own account
    // by Unicode has no way to work out why.
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { N: n, r, p, maxmem: MAX_MEM }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** `scrypt$N$r$p$salt$key`, base64, everything needed to verify it later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Whether the passphrase produces the stored hash. A malformed stored
 * string is `false` rather than an exception: a corrupt record must fail
 * closed, and it must fail the same way a wrong passphrase does.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // A stored record asking for more memory than this process will give is
  // refused rather than attempted: an absurd N in a tampered file is a way
  // to make one sign-in exhaust the machine.
  if (n > N || r > R || p > P) return false;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(parts[5] ?? '', 'base64');
    actual = await derive(password, Buffer.from(parts[4] ?? '', 'base64'), n, r, p);
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Burn the same work a real verification would, and return nothing.
 *
 * Called when there is no account for the address given, so that the
 * failure takes as long as a wrong passphrase against a real one. The
 * salt is fresh each time because the point is the cost, not the answer.
 */
export async function spendTime(password: string): Promise<void> {
  await derive(password, randomBytes(SALT_BYTES), N, R, P);
}

/**
 * Whether a stored hash was made with weaker parameters than the current
 * ones, and should be replaced the next time the passphrase is in hand.
 * Raising the cost is worth nothing if the hashes already on disk never
 * move.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}
