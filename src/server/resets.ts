/**
 * Passphrase resets: minting the link, sending it, and spending it.
 *
 * The token is 32 random bytes and the server stores only its SHA-256 —
 * the same treatment a session token gets, for the same reason. A fast hash
 * is right here: the token is not chosen by a person and cannot be guessed
 * at any price, so scrypt would buy nothing.
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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

import { letterFor } from '@/domain/mail';
import { resetState, type Reset, type ResetState } from '@/domain/reset';
import { accountFor, changePassword } from './accounts';
import { record } from './audit';
import { send } from './mail';
import { endAllSessions } from './sessions';

const ROOT = process.env.ACCOUNTS_DIR ?? path.join(process.cwd(), 'accounts');
const RESETS = path.join(ROOT, 'resets');

function fileFor(token: string): string {
  // Hex of a digest is what becomes a path, so a token from a URL cannot be
  // a path however it is spelled.
  return path.join(RESETS, `${createHash('sha256').update(token).digest('hex')}.json`);
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
  const reset: Reset = { account: account.id, issuedAt: new Date().toISOString() };
  await mkdir(RESETS, { recursive: true });
  await writeFile(fileFor(token), JSON.stringify(reset));

  const sent = await send(letterFor(account.email, { kind: 'reset', link: resetLink(origin, token) }, origin));
  if (!sent.ok) await record('mail.failed', account.id);
}

/** Tell somebody their address is already in use, on the address itself. */
export async function tellTaken(rawEmail: string, origin: string): Promise<void> {
  const account = await accountFor(rawEmail);
  if (!account) return;

  const token = randomBytes(32).toString('base64url');
  await mkdir(RESETS, { recursive: true });
  await writeFile(fileFor(token), JSON.stringify({ account: account.id, issuedAt: new Date().toISOString() }));

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

  const file = fileFor(token);
  let reset: Reset;
  try {
    reset = JSON.parse(await readFile(file, 'utf8')) as Reset;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, reason: 'unknown' };
    throw error;
  }

  const state = resetState(reset, Date.now());
  if (state !== 'good') return { ok: false, reason: state };

  reset.usedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify(reset));

  if (!(await changePassword(reset.account, password))) return { ok: false, reason: 'bad-password' };

  await endAllSessions(reset.account);
  await record('reset.completed', reset.account);
  return { ok: true, account: reset.account };
}

/** What state a link is in, without spending it. For the page that renders the form. */
export async function inspect(token: string): Promise<ResetState | 'unknown'> {
  if (!token) return 'unknown';
  try {
    const reset = JSON.parse(await readFile(fileFor(token), 'utf8')) as Reset;
    return resetState(reset, Date.now());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'unknown';
    throw error;
  }
}
