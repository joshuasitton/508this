/**
 * Where audit records are kept: one object per event.
 *
 * This was one append-only file per account until the store moved off local
 * disk, and the move is the reason the shape changed. **An object store has
 * no append.** Porting `appendFile` to a bucket means read the log, add a
 * line, write the whole log back — which is a read-modify-write race that
 * loses records under exactly the concurrency an audit log is there to
 * capture, and hands whoever holds the bucket a single object to rewrite.
 * The one property the log exists to have would have been the first
 * casualty of keeping its old shape.
 *
 * So each event is its own object and nothing is ever rewritten. `record`
 * only ever PUTs a key that did not exist; `history` only ever GETs. No
 * code path in this repository edits or deletes an audit record, because
 * none is written — the same claim the file made before, now true of a
 * store where it can be enforced from outside as well: object versioning
 * and an object-lock policy on this prefix are what make "append-only"
 * something more than a promise about our own source code, and disk never
 * had an equivalent.
 *
 * ## The key is the order
 *
 * `audit/<account>/<time>-<within>-<nonce>.json`, and the parts earn their
 * places:
 *
 * - the time is the event's own `at` with its punctuation removed, so it is
 *   fixed width and sorts lexicographically — which means a listing comes
 *   back in chronological order for free, on both stores, and a date range
 *   can be filtered from the key before a single object is fetched;
 * - `within` counts events sharing a millisecond in this process, so two
 *   records written back to back keep the order they were written in. A
 *   file being appended to gave that away free and a bucket does not;
 * - the nonce is four hex characters against the one case the counter
 *   cannot help with — two processes writing in the same millisecond. They
 *   must not overwrite each other, and a lost audit record is worse than an
 *   ambiguous ordering between two genuinely concurrent events, for which
 *   there is no true order to lose.
 *
 * An event with no account — somebody guessing at an address that has no
 * account here — goes to a house prefix rather than being dropped. Those
 * are the records an investigation starts from, and they are precisely the
 * ones a per-account layout would have nowhere to put.
 *
 * ## Sealed, and bound to where it sits
 *
 * Each record is sealed with **its own key as associated data**. An audit
 * event carries no free text by construction, but it does carry who acted,
 * on what, and when, and that timeline is worth protecting once the bytes
 * sit in somebody else's bucket.
 *
 * Binding it to the key buys the part that matters more: a record cannot be
 * moved. Re-filing an event under another account's prefix, or renaming it
 * to a different timestamp to back-date it, changes the associated data and
 * the record no longer opens. On disk that was untrue and unfixable —
 * anybody who could reach the file could edit the line.
 *
 * Nothing in here formats, enriches or summarises. It writes what
 * `auditEvent` produced, which by construction is a time, an id, an action
 * and at most one more id.
 */

import { randomBytes } from 'node:crypto';

import { auditEvent, isIdentifier, type AuditAction, type AuditEvent } from '@/domain/audit';
import { getBlob, listBlobs, putBlob } from './blobs';
import { openText, sealText } from './crypto';

const PREFIX = 'audit';
const HOUSE = 'house';

/**
 * How many records are fetched at once when a log is read.
 *
 * One object per event is one round trip per event, which is the price of
 * the shape. Sixteen at a time keeps a log of a few thousand readable
 * without opening a connection per record.
 */
const BATCH = 16;

/** Same millisecond, same process: keep the order they were written in. */
let lastStamp = '';
let within = 0;

/**
 * Everything recorded under one account. The account id is the only thing
 * that becomes part of a key, and it is checked before it does — the same
 * rule the job store holds.
 */
function prefixFor(account: string | null): string {
  if (account !== null && !isIdentifier(account)) throw new Error('Invalid account id');
  return `${PREFIX}/${account ?? HOUSE}/`;
}

function keyFor(account: string | null, at: string): string {
  // `2026-09-22T19:06:08.123Z` becomes `20260922T190608.123Z`: fixed width,
  // still readable in a bucket listing, and free of the colons a key may
  // not contain.
  const stamp = at.replace(/[-:]/g, '');
  if (stamp === lastStamp) within += 1;
  else {
    lastStamp = stamp;
    within = 0;
  }
  const order = String(within).padStart(4, '0');
  return `${prefixFor(account)}${stamp}-${order}-${randomBytes(2).toString('hex')}.json`;
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
    const at = new Date().toISOString();
    const event = auditEvent(action, at, account, subject);
    const key = keyFor(account, at);
    await putBlob(key, sealText(JSON.stringify(event), key));
  } catch {
    // Deliberately silent, and deliberately not re-raised with the event
    // attached: an error carrying what was being logged is a second copy of
    // it in whatever catches the error.
  }
}

export interface History {
  /** Oldest first, which is the order the keys already sort in. */
  events: AuditEvent[];
  /**
   * How many records were listed and did not come back as events.
   *
   * A torn write, a record sealed under a different key, one moved here
   * from another account's prefix: all of them fail the same way, and all
   * of them are worth knowing about. The old file skipped a corrupt line
   * silently, which meant the one thing an audit log exists to reveal —
   * that something has been got at — was the one thing it could not say.
   * A count carries no content, so it cannot become somewhere for text to
   * hide.
   */
  unreadable: number;
}

/**
 * Everything recorded for an account, oldest first.
 *
 * One record that will not open does not make the rest unreadable, which
 * was true of the file this replaces and has to stay true: the alternative
 * is that a single torn write loses the history either side of it.
 *
 * The whole log is read. That is honest rather than clever, and it is fine
 * while nothing but a test calls this; the escape hatch, when a log page
 * exists, is already built into the key — the time is in it, so a date
 * range narrows the listing before anything is fetched.
 */
export async function history(account: string | null): Promise<History> {
  const keys = (await listBlobs(prefixFor(account))).sort();

  const events: AuditEvent[] = [];
  let unreadable = 0;

  for (let at = 0; at < keys.length; at += BATCH) {
    const batch = await Promise.all(keys.slice(at, at + BATCH).map(read));
    for (const event of batch) {
      if (event) events.push(event);
      else unreadable += 1;
    }
  }

  return { events, unreadable };
}

/** One record, or null if it is not there, will not open, or is not JSON. */
async function read(key: string): Promise<AuditEvent | null> {
  try {
    const stored = await getBlob(key);
    if (!stored) return null;
    return JSON.parse(openText(stored, key)) as AuditEvent;
  } catch {
    // The error is not inspected: a record that fails to open is counted,
    // not described, and whatever the failure carries was a moment ago
    // carrying an audit record.
    return null;
  }
}
