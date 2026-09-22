/**
 * Where audit records are kept: one append-only file per account, plus one
 * for the events that belong to nobody.
 *
 * Append-only is the whole design. `appendFile` with a line of JSON is not
 * a database and it is not tamper-proof, and both of those are honest
 * limitations of a service still running on one machine — what it does buy
 * is that no code path in this repository can edit or delete a record,
 * because none is written. When the store moves off local disk this file
 * moves with it, and the interface it presents stays the shape of a log
 * you can only add to.
 *
 * An event with no account — somebody guessing at an address that has no
 * account here — goes to a house log rather than being dropped. Those are
 * the records an investigation starts from, and they are precisely the ones
 * a per-account layout would have nowhere to put.
 *
 * Nothing in here formats, enriches or summarises. It writes what
 * `auditEvent` produced, which by construction is a time, an id, an action
 * and at most one more id.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { auditEvent, type AuditAction, type AuditEvent } from '@/domain/audit';

const ROOT = process.env.ACCOUNTS_DIR ?? path.join(process.cwd(), 'accounts');
const HOUSE = 'house';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function logFor(account: string | null): string {
  // The account id is the only thing that becomes a path, and it is checked
  // before it does — the same rule the job store holds.
  if (account !== null && !ID.test(account)) throw new Error('Invalid account id');
  return path.join(ROOT, account ?? HOUSE, 'audit.log');
}

/**
 * Record one action. Never throws into the caller's path: an audit write
 * that fails must not be the reason a reviewer cannot save a decision, and
 * the failure is surfaced by the log being short rather than by the
 * product breaking. That is a deliberate trade and it is the wrong one for
 * a system where the log is the product; here the log is evidence about a
 * system whose job is to fix documents.
 */
export async function record(
  action: AuditAction,
  account: string | null,
  subject: string | null = null,
): Promise<void> {
  try {
    const event = auditEvent(action, new Date().toISOString(), account, subject);
    const file = logFor(account);
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Deliberately silent, and deliberately not re-raised with the event
    // attached: an error carrying what was being logged is a second copy of
    // it in whatever catches the error.
  }
}

/**
 * Everything recorded for an account, oldest first. A line that does not
 * parse is skipped rather than throwing, because one corrupt line at the
 * end of an append-only file — a half-written record from a crash — must
 * not make the rest of the history unreadable.
 */
export async function history(account: string | null): Promise<AuditEvent[]> {
  let raw: string;
  try {
    raw = await readFile(logFor(account), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const events: AuditEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as AuditEvent);
    } catch {
      // See above: a torn last line is not a reason to lose the file.
    }
  }
  return events;
}
