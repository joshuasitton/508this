/**
 * Sessions: the cookie a signed-in person carries, and the record on the
 * server that decides whether it still means anything.
 *
 * ## The token is never stored
 *
 * Sign-in mints 32 random bytes, hands them to the browser in a cookie, and
 * stores **SHA-256 of them**. Anyone who reads the session records learns
 * which sessions exist and nothing that lets them become one. That
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
 * The record is sealed with its own key as associated data, and that is the
 * part worth having: a session record copied onto another token's key stops
 * opening. Without it, anybody who could write to the store could take a
 * record belonging to an account they wanted and file it under the digest
 * of a token they held, which is signing in as somebody else without ever
 * touching a passphrase.
 *
 * ## An index by account, because a bucket has no cheap scan
 *
 * `endAllSessions` used to read every session record on disk to find one
 * account's. On local disk that was linear and fine; against an object
 * store it is a listing of every session in the service plus a fetch each,
 * on a path that runs whenever somebody resets a passphrase. So there is an
 * index: an empty object at `sessions/by-account/<account>/<digest>.json`,
 * whose *name* carries everything needed to find and delete the record.
 *
 * The index entry is written **before** the record, which is the ordering
 * that fails safe. An entry with no record is harmless — deleting is
 * idempotent on both stores, so ending it is a no-op. A record with no
 * entry would be a session that `endAllSessions` cannot see, which is a
 * session that survives the reset it was supposed to end.
 *
 * ## A record that will not open is "no session", not an error
 *
 * `accounts.ts` lets a broken seal throw, and that is right there: an
 * account record is fetched by an id the server has already resolved, so a
 * record that fails its authentication check is a real problem and should
 * be loud. Here the key comes from a cookie, which is whatever the caller
 * sent. Throwing would turn any forged cookie into a 500 — a way to make
 * the service fall over, and a way to tell a stranger their guess landed on
 * something. So it is treated exactly as a token nobody was ever issued.
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

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { sessionState, type Session, type SessionState } from '@/domain/session';
import { record } from './audit';
import { getBlob, listBlobs, putBlob, removeBlob } from './blobs';
import { openText, sealText } from './crypto';

const ACCOUNT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cookie the browser carries. Named plainly; it is not a secret that it exists. */
export const COOKIE = 'session';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

/**
 * The digest is what becomes a key, so an attacker-supplied cookie value
 * cannot be a key at all: hex of a digest is hex of a digest.
 */
function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const keyFor = (digest: string): string => `sessions/${digest}.json`;

function indexPrefix(account: string): string {
  if (!ACCOUNT.test(account)) throw new Error('Invalid account id');
  return `sessions/by-account/${account}/`;
}

const indexFor = (account: string, digest: string): string => `${indexPrefix(account)}${digest}.json`;

/** The record for a digest, or null if there is none or it will not open. */
async function readSession(digest: string): Promise<Session | null> {
  const key = keyFor(digest);
  const stored = await getBlob(key);
  if (!stored) return null;
  try {
    return JSON.parse(openText(stored, key)) as Session;
  } catch {
    // Not a record to sign anybody in on, and not an error either — see the
    // note above. The failure is not inspected: it was carrying a session.
    return null;
  }
}

/** Both halves, in the order that leaves nothing behind. */
async function forget(account: string, digest: string): Promise<void> {
  await removeBlob(keyFor(digest));
  await removeBlob(indexFor(account, digest));
}

/** Start a session. The returned token is the only time it exists in the clear. */
export async function startSession(account: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const digest = digestOf(token);
  const at = new Date().toISOString();
  const session: Session = { id: randomUUID(), account, startedAt: at, lastSeenAt: at };

  // Index first. See the note above: an entry with no record costs nothing,
  // a record with no entry outlives the reset meant to end it.
  await putBlob(indexFor(account, digest), new Uint8Array());
  const key = keyFor(digest);
  await putBlob(key, sealText(JSON.stringify(session), key));
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

  const digest = digestOf(token);
  const session = await readSession(digest);
  if (!session) return { ok: false, reason: 'none' };

  const state = sessionState(session, now);
  if (state !== 'active') {
    await forget(session.account, digest);
    await record('session.expired', session.account);
    return { ok: false, reason: state };
  }
  return { ok: true, session };
}

/**
 * Push the idle clock forward. Separate from `resolveSession` because a
 * write on every request is a cost worth deciding about deliberately, and
 * because the read has to work on a request that will not touch anything.
 *
 * This is a read-modify-write, which the audit log could not have and this
 * can: two requests racing here both write a `lastSeenAt` a few
 * milliseconds apart and the loser's value is not worth anything. Losing a
 * record is a different matter, and nothing here loses one.
 */
export async function touchSession(token: string, now = Date.now()): Promise<void> {
  const digest = digestOf(token);
  const session = await readSession(digest);
  // A session that vanished between resolving and touching is a session
  // that ended. The next request will be told so properly.
  if (!session) return;

  session.lastSeenAt = new Date(now).toISOString();
  const key = keyFor(digest);
  await putBlob(key, sealText(JSON.stringify(session), key));
}

/**
 * End every session an account has.
 *
 * The reason somebody resets a passphrase is that they think another person
 * has it. Leaving that person's session alive makes the reset theatre, so
 * this runs on every completed reset.
 *
 * This is what the index is for. It used to read every session record in
 * the service looking for one account's; that was linear and fine on a
 * disk, and against a bucket it is a listing of everything plus a fetch
 * each, on the passphrase-reset path. Now it lists one prefix and the names
 * are the digests.
 *
 * The count is of entries removed rather than records found, which is the
 * honest number to report from a listing: the contract is that this
 * account has no sessions left afterwards, and that holds whether or not
 * every entry still had a record behind it.
 */
export async function endAllSessions(account: string): Promise<number> {
  const prefix = indexPrefix(account);
  const keys = await listBlobs(prefix);

  let ended = 0;
  for (const key of keys) {
    const digest = key.slice(prefix.length).replace(/\.json$/, '');
    if (!/^[0-9a-f]{64}$/.test(digest)) continue;
    await forget(account, digest);
    ended += 1;
  }
  return ended;
}

/** End a session on purpose. */
export async function endSession(token: string | undefined): Promise<void> {
  if (!token) return;
  const digest = digestOf(token);
  const session = await readSession(digest);
  // Already gone. Signing out of nothing is signing out.
  if (!session) return;

  await forget(session.account, digest);
  await record('sign-out', session.account);
}
