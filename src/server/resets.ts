/**
 * Passphrase resets: minting the link, sending it, and spending it.
 *
 * The token is 32 random bytes and the server stores only its SHA-256 —
 * the same treatment a session token gets, for the same reason. A fast hash
 * is right here: the token is not chosen by a person and cannot be guessed
 * at any price, so scrypt would buy nothing.
 *
 * The record is on the same store as everything else, under `resets/`, and
 * sealed with its own key as associated data. A reset record moved onto
 * another token's key stops opening, which matters more here than almost
 * anywhere: the record names the account the link resets, so one that could
 * be re-filed under a token an attacker holds is a passphrase reset for
 * somebody else's account.
 *
 * ## Everybody gets the same answer
 *
 * `request` returns nothing. Not "sent", not "no such account", not "mail
 * is down" — nothing, because every one of those is a different answer and
 * a different answer is an enumeration oracle. The page says the same
 * sentence every time. What really happened goes to the audit log.
 *
 * An address with no account still gets a letter, saying there is no
 * account here. That costs nothing, it is kind to somebody who signed up
 * under a different address, and it tells a stranger nothing they could not
 * work out by not receiving one.
 *
 * ## Spending it ends everything
 *
 * A completed reset ends every session the account has. People reset a
 * passphrase because they think somebody else has it; leaving that
 * somebody signed in makes the whole exercise theatre. The token is marked
 * used before the passphrase is changed, so a link that fails on a weak
 * passphrase is still spent — a second person following it is not a second
 * attempt, it is somebody else.
 */

import { createHash, randomBytes } from 'node:crypto';

import { letterFor } from '@/domain/mail';
import { resetState, type Reset, type ResetState } from '@/domain/reset';
import { accountFor, changePassword } from './accounts';
import { record } from './audit';
import { send } from './mail';
import { endAllSessions } from './sessions';
import { getBlob, putBlob } from './blobs';
import { openText, sealText } from './crypto';

function keyFor(token: string): string {
  // Hex of a digest is what becomes a key, so a token from a URL cannot be
  // a key however it is spelled.
  return `resets/${createHash('sha256').update(token).digest('hex')}.json`;
}

/** The record for a token, or null if there is none or it will not open. */
async function readReset(token: string): Promise<Reset | null> {
  const key = keyFor(token);
  const stored = await getBlob(key);
  if (!stored) return null;
  try {
    return JSON.parse(openText(stored, key)) as Reset;
  } catch {
    // Not a record to reset a passphrase on — and null rather than a throw
    // for the same reason `sessions.ts` gives: the key comes from a token in
    // a URL, so a bad one must be "unknown" and not a 500. The failure is
    // not inspected: it named an account.
    return null;
  }
}

async function writeReset(token: string, reset: Reset): Promise<void> {
  const key = keyFor(token);
  await putBlob(key, sealText(JSON.stringify(reset), key));
}

/** Where a reset link points. The one place that URL is built. */
export function resetLink(origin: string, token: string): string {
  const url = new URL('/account/reset', origin);
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * Ask for a reset. Returns nothing on purpose — see the note above.
 *
 * `origin` comes from the caller rather than from the request's own `Host`
 * header, which an attacker controls: a reset link built from an attacker's
 * host is a credential mailed to the right person pointing at the wrong
 * server.
 */
export async function request(rawEmail: string, origin: string): Promise<void> {
  const account = await accountFor(rawEmail);
  await record('reset.requested', account?.id ?? null);

  if (!account || account.disabledAt) {
    const letter = letterFor(rawEmail.trim(), { kind: 'reset-no-account' }, origin);
    const sent = await send(letter);
    if (!sent.ok) await record('mail.failed', account?.id ?? null);
    return;
  }

  const token = randomBytes(32).toString('base64url');
  await writeReset(token, { account: account.id, issuedAt: new Date().toISOString() });

  const sent = await send(letterFor(account.email, { kind: 'reset', link: resetLink(origin, token) }, origin));
  if (!sent.ok) await record('mail.failed', account.id);
}

/** Tell somebody their address is already in use, on the address itself. */
export async function tellTaken(rawEmail: string, origin: string): Promise<void> {
  const account = await accountFor(rawEmail);
  if (!account) return;

  const token = randomBytes(32).toString('base64url');
  await writeReset(token, { account: account.id, issuedAt: new Date().toISOString() });

  const sent = await send(letterFor(account.email, { kind: 'taken', link: resetLink(origin, token) }, origin));
  if (!sent.ok) await record('mail.failed', account.id);
}

export type ConsumeResult =
  | { ok: true; account: string }
  | { ok: false; reason: ResetState | 'unknown' | 'bad-password' };

/**
 * Spend a link and set the new passphrase.
 *
 * The order matters: the link is marked used *before* the passphrase is
 * changed. A weak passphrase therefore burns the link, which is
 * inconvenient and correct — the alternative is a link that stays live
 * while somebody tries passphrases on it.
 */
export async function consume(token: string, password: string): Promise<ConsumeResult> {
  if (!token) return { ok: false, reason: 'unknown' };

  const reset = await readReset(token);
  if (!reset) return { ok: false, reason: 'unknown' };

  const state = resetState(reset, Date.now());
  if (state !== 'good') return { ok: false, reason: state };

  reset.usedAt = new Date().toISOString();
  await writeReset(token, reset);

  if (!(await changePassword(reset.account, password))) return { ok: false, reason: 'bad-password' };

  await endAllSessions(reset.account);
  await record('reset.completed', reset.account);
  return { ok: true, account: reset.account };
}

/** What state a link is in, without spending it. For the page that renders the form. */
export async function inspect(token: string): Promise<ResetState | 'unknown'> {
  if (!token) return 'unknown';
  const reset = await readReset(token);
  return reset ? resetState(reset, Date.now()) : 'unknown';
}
