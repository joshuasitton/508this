/**
 * The account store: who has an account here, and what it takes to get in.
 *
 * Local disk under `accounts/`, or `ACCOUNTS_DIR`, in the same shape and
 * for the same reasons as the job store — right for development and for a
 * service one person runs, wrong for an ephemeral filesystem, and one file
 * to replace when it moves. The rules the job store holds hold here too:
 * the account id is the only thing that becomes a path, and no error raised
 * in this module carries a credential.
 *
 * ## The email index is a hash, not the address
 *
 * `by-email/` is keyed by SHA-256 of the normalised address rather than by
 * the address itself. A directory listing of a filesystem is a thing that
 * gets backed up, synced and screenshotted, and a customer list of federal
 * contractors is worth something to somebody. The address is still inside
 * the record — this is not encryption and does not pretend to be — but it
 * is no longer readable from a file name.
 *
 * ## Sign-in answers one way
 *
 * `authenticate` returns the same `'no'` for a wrong passphrase, an unknown
 * address and a disabled account, and spends the same scrypt work on all
 * three. What actually happened goes to the audit log, where an
 * investigator can see it and a stranger with a sign-in form cannot.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { checkEmail, checkPassword, type Account } from '@/domain/account';
import { countFailure, lockState, type Failures } from '@/domain/session';
import { hashPassword, needsRehash, spendTime, verifyPassword } from './passwords';
import { record } from './audit';

const ROOT = process.env.ACCOUNTS_DIR ?? path.join(process.cwd(), 'accounts');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The account record as stored: the domain's `Account`, plus the secrets. */
interface Stored extends Account {
  passwordHash: string;
  failures?: Failures;
}

function dirFor(id: string): string {
  if (!ID.test(id)) throw new Error('Invalid account id');
  return path.join(ROOT, id);
}

function indexFor(email: string): string {
  return path.join(ROOT, 'by-email', `${createHash('sha256').update(email).digest('hex')}.json`);
}

async function readStored(id: string): Promise<Stored | null> {
  try {
    return JSON.parse(await readFile(path.join(dirFor(id), 'account.json'), 'utf8')) as Stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeStored(account: Stored): Promise<void> {
  const dir = dirFor(account.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'account.json'), JSON.stringify(account, null, 2));
}

async function idForEmail(email: string): Promise<string | null> {
  try {
    const raw = await readFile(indexFor(email), 'utf8');
    const { id } = JSON.parse(raw) as { id: string };
    return ID.test(id) ? id : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Only what the rest of the app may see. The hash never leaves this file. */
function publicPart(stored: Stored): Account {
  const account: Account = { id: stored.id, email: stored.email, createdAt: stored.createdAt };
  if (stored.disabledAt) account.disabledAt = stored.disabledAt;
  return account;
}

export type CreateResult =
  | { ok: true; account: Account }
  | { ok: false; reason: 'bad-email' | 'bad-password' | 'taken' };

/**
 * Create an account, or say why not.
 *
 * `taken` is returned to the caller and must not be shown to whoever filled
 * in the form: "that address already has an account" tells a stranger who
 * our customers are. The sign-up screen's job is to say the same thing it
 * would have said on success and send mail to the address, which is the
 * only channel that can safely tell the truth. Nothing here does that yet;
 * the reason is returned so the screen, when it exists, has the fact
 * available for the audit log rather than for the page.
 */
export async function createAccount(rawEmail: string, password: string): Promise<CreateResult> {
  const email = checkEmail(rawEmail);
  if (!email.ok) return { ok: false, reason: 'bad-email' };
  const passwordCheck = checkPassword(password, email.email);
  if (!passwordCheck.ok) return { ok: false, reason: 'bad-password' };
  if (await idForEmail(email.email)) return { ok: false, reason: 'taken' };

  const stored: Stored = {
    id: randomUUID(),
    email: email.email,
    createdAt: new Date().toISOString(),
    passwordHash: await hashPassword(password),
  };
  await writeStored(stored);
  const index = indexFor(email.email);
  await mkdir(path.dirname(index), { recursive: true });
  await writeFile(index, JSON.stringify({ id: stored.id }));
  await record('account.created', stored.id);
  return { ok: true, account: publicPart(stored) };
}

export async function getAccount(id: string): Promise<Account | null> {
  if (!ID.test(id)) return null;
  const stored = await readStored(id);
  return stored ? publicPart(stored) : null;
}

/** The account for an address, or null. Server-side only, for obvious reasons. */
export async function accountFor(rawEmail: string): Promise<Account | null> {
  const email = checkEmail(rawEmail);
  if (!email.ok) return null;
  const id = await idForEmail(email.email);
  if (!id) return null;
  const stored = await readStored(id);
  return stored ? publicPart(stored) : null;
}

/**
 * Replace an account's passphrase. The policy is checked here as well as at
 * the form, because this is reachable from a reset link and a form is a
 * thing a person can navigate around.
 *
 * Ending the account's sessions is the caller's job and not an option:
 * see `endAllSessions`.
 */
export async function changePassword(id: string, password: string): Promise<boolean> {
  const stored = await readStored(id);
  if (!stored || stored.disabledAt) return false;
  if (!checkPassword(password, stored.email).ok) return false;
  stored.passwordHash = await hashPassword(password);
  delete stored.failures;
  await writeStored(stored);
  return true;
}

export type AuthResult =
  | { ok: true; account: Account }
  | { ok: false; reason: 'no' }
  | { ok: false; reason: 'locked'; until: number };

/**
 * Sign in, or do not.
 *
 * `locked` is the one failure told apart from the others, and only after
 * the passphrase has been checked, so it leaks nothing a person could not
 * already learn by guessing five times: the alternative is a person who
 * mistyped their own passphrase being told "those do not match" for fifteen
 * minutes while typing it correctly.
 */
export async function authenticate(rawEmail: string, password: string, now = Date.now()): Promise<AuthResult> {
  const email = checkEmail(rawEmail);
  if (!email.ok) {
    await spendTime(password);
    await record('sign-in.failed', null);
    return { ok: false, reason: 'no' };
  }

  const id = await idForEmail(email.email);
  const stored = id ? await readStored(id) : null;
  if (!stored) {
    // The work is spent anyway, so that an address with no account here
    // does not answer faster than one with an account.
    await spendTime(password);
    await record('sign-in.failed', null);
    return { ok: false, reason: 'no' };
  }

  const lock = lockState(stored.failures, now);
  const matched = await verifyPassword(password, stored.passwordHash);

  if (lock.locked) {
    await record('sign-in.locked', stored.id);
    return { ok: false, reason: 'locked', until: lock.until };
  }

  if (!matched || stored.disabledAt) {
    stored.failures = countFailure(stored.failures, now);
    await writeStored(stored);
    await record('sign-in.failed', stored.id);
    return { ok: false, reason: 'no' };
  }

  // A success clears the count, and is also where a hash made with weaker
  // parameters gets replaced — the only moment the passphrase is in hand.
  let changed = false;
  if (stored.failures) {
    delete stored.failures;
    changed = true;
  }
  if (needsRehash(stored.passwordHash)) {
    stored.passwordHash = await hashPassword(password);
    changed = true;
  }
  if (changed) await writeStored(stored);

  await record('sign-in.succeeded', stored.id);
  return { ok: true, account: publicPart(stored) };
}

/**
 * Stop an account signing in, without removing it. The audit log names
 * accounts by id, and an id that resolves to nothing turns a record of who
 * did something into a record that somebody did.
 */
export async function disableAccount(id: string): Promise<Account | null> {
  const stored = await readStored(id);
  if (!stored) return null;
  stored.disabledAt = new Date().toISOString();
  await writeStored(stored);
  await record('account.disabled', stored.id);
  return publicPart(stored);
}
