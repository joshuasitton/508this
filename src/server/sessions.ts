/**
 * Sessions: the cookie a signed-in person carries, and the record on the
 * server that decides whether it still means anything.
 *
 * ## The token is never stored
 *
 * Sign-in mints 32 random bytes, hands them to the browser in a cookie, and
 * stores **SHA-256 of them** on disk. Anyone who reads the session files
 * learns which sessions exist and nothing that lets them become one. That
 * is the same reason passwords are hashed, applied to the thing that is
 * accepted *instead of* a password for the next eight hours — a session
 * token is a credential, and a credential stored in the clear is a
 * credential waiting for a backup to leak.
 *
 * A fast hash is right here and wrong for a password. A password is chosen
 * by a person and must be expensive to guess; a token is 256 bits of
 * randomness and cannot be guessed at any price, so the cost of scrypt
 * would buy nothing and would be paid on every single request.
 *
 * ## The cookie
 *
 * `httpOnly` so script cannot read it, `sameSite: lax` so it does not ride
 * along on a cross-site form post, `secure` outside development, and no
 * `maxAge` — it is a session cookie, and the server's two clocks
 * (`src/domain/session.ts`) decide when it stops working. A cookie that
 * outlived the record would be a token that looks valid to the browser and
 * is refused by the server, which is a confusing way to sign somebody out.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { sessionState, type Session, type SessionState } from '@/domain/session';
import { record } from './audit';

const ROOT = process.env.ACCOUNTS_DIR ?? path.join(process.cwd(), 'accounts');
const SESSIONS = path.join(ROOT, 'sessions');

/** The cookie the browser carries. Named plainly; it is not a secret that it exists. */
export const COOKIE = 'session';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

function fileFor(token: string): string {
  // The hash is what becomes a path, so an attacker-supplied cookie value
  // cannot be a path at all: hex of a digest is hex of a digest.
  return path.join(SESSIONS, `${createHash('sha256').update(token).digest('hex')}.json`);
}

/** Start a session. The returned token is the only time it exists in the clear. */
export async function startSession(account: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const at = new Date().toISOString();
  const session: Session = { id: randomUUID(), account, startedAt: at, lastSeenAt: at };
  await mkdir(SESSIONS, { recursive: true });
  await writeFile(fileFor(token), JSON.stringify(session));
  return token;
}

export type Resolved =
  | { ok: true; session: Session }
  | { ok: false; reason: 'none' }
  | { ok: false; reason: Exclude<SessionState, 'active'> };

/**
 * Who this token is, if it is still anybody.
 *
 * An expired session is deleted as it is read, rather than swept later: the
 * request that finds it is the cheapest possible moment, and a session file
 * that outlives its own validity is a record of somebody's activity kept
 * for no reason.
 */
export async function resolveSession(token: string | undefined, now = Date.now()): Promise<Resolved> {
  if (!token) return { ok: false, reason: 'none' };

  let session: Session;
  try {
    session = JSON.parse(await readFile(fileFor(token), 'utf8')) as Session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, reason: 'none' };
    throw error;
  }

  const state = sessionState(session, now);
  if (state !== 'active') {
    await rm(fileFor(token), { force: true });
    await record('session.expired', session.account);
    return { ok: false, reason: state };
  }
  return { ok: true, session };
}

/**
 * Push the idle clock forward. Separate from `resolveSession` because a
 * write on every request is a cost worth deciding about deliberately, and
 * because the read has to work on a request that will not touch anything.
 */
export async function touchSession(token: string, now = Date.now()): Promise<void> {
  try {
    const file = fileFor(token);
    const session = JSON.parse(await readFile(file, 'utf8')) as Session;
    session.lastSeenAt = new Date(now).toISOString();
    await writeFile(file, JSON.stringify(session));
  } catch {
    // A session that vanished between resolving and touching is a session
    // that ended. The next request will be told so properly.
  }
}

/** End a session on purpose. */
export async function endSession(token: string | undefined): Promise<void> {
  if (!token) return;
  try {
    const file = fileFor(token);
    const session = JSON.parse(await readFile(file, 'utf8')) as Session;
    await rm(file, { force: true });
    await record('sign-out', session.account);
  } catch {
    // Already gone. Signing out of nothing is signing out.
  }
}
