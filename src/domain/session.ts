/**
 * How long somebody stays signed in, and what happens when they keep
 * guessing.
 *
 * Both are 800-171 controls and both are the kind of number that ends up
 * typed into three files and disagreeing with itself, so they are here,
 * once, as pure functions over a clock. Nothing in this file reads a
 * cookie, a disk or `Date.now()` — the caller passes the time in, which is
 * what makes the expiry rules testable without waiting eight hours.
 *
 * ## Two clocks, not one
 *
 * A session dies of idleness after thirty minutes and of old age after
 * eight hours, and it needs both. Idle timeout is what protects the
 * reviewer who walked away from a terminal with a customer's document open
 * — the common case, and the one 3.1.10/3.1.11 are about. Absolute
 * lifetime is what bounds a stolen token: refreshing on activity means an
 * attacker who has the cookie can keep it alive forever, so there is a
 * ceiling no amount of activity moves.
 *
 * ## Why lockout is a delay and not a door
 *
 * Five wrong passphrases lock the account for fifteen minutes. Locking it
 * permanently would mean anybody who knows a customer's email address can
 * take them offline by typing rubbish at the form, which turns a control
 * into a denial of service; a delay costs an attacker everything and costs
 * the person who fat-fingered their own passphrase a quarter of an hour.
 * The count resets on a success and on the window elapsing.
 */

/** Thirty minutes of no requests ends a session. */
export const IDLE_MS = 30 * 60 * 1000;

/** Eight hours from sign-in ends it whatever happened in between. */
export const LIFETIME_MS = 8 * 60 * 60 * 1000;

/** Wrong passphrases before the account stops answering. */
export const LOCK_AFTER = 5;

/** How long it stops answering for. */
export const LOCK_MS = 15 * 60 * 1000;

/**
 * A session as it is stored. The token itself is never in here — the
 * server keeps only its hash, so a leaked session file is not a leaked set
 * of live sessions.
 */
export interface Session {
  id: string;
  account: string;
  startedAt: string;
  lastSeenAt: string;
}

export type SessionState = 'active' | 'idle' | 'expired';

/**
 * Which of the two clocks ran out, or neither. They are reported
 * separately because a person who was idle is told something different
 * from one whose day simply ended, and because an audit log that recorded
 * both as "expired" would lose the distinction that matters in an
 * investigation.
 */
export function sessionState(session: Session, now: number): SessionState {
  const started = Date.parse(session.startedAt);
  const seen = Date.parse(session.lastSeenAt);
  // An unparseable timestamp is a corrupt record, and a corrupt session
  // record is not one to keep somebody signed in on.
  if (!Number.isFinite(started) || !Number.isFinite(seen)) return 'expired';
  if (now - started >= LIFETIME_MS) return 'expired';
  if (now - seen >= IDLE_MS) return 'idle';
  return 'active';
}

export function describeSessionEnd(state: Exclude<SessionState, 'active'>): string {
  return state === 'idle'
    ? 'You were signed out after thirty minutes of inactivity. Sign in again to carry on.'
    : 'Your session reached its eight-hour limit and ended. Sign in again to carry on.';
}

/** Failed sign-ins against one account, and when the last one was. */
export interface Failures {
  count: number;
  lastAt: string;
}

/**
 * Whether the account is currently refusing to answer, and until when.
 *
 * `until` is returned so the caller can say how long is left rather than
 * "try again later", which is the sentence that makes a person try again
 * immediately.
 */
export function lockState(failures: Failures | undefined, now: number): { locked: boolean; until: number } {
  if (!failures || failures.count < LOCK_AFTER) return { locked: false, until: 0 };
  const last = Date.parse(failures.lastAt);
  if (!Number.isFinite(last)) return { locked: false, until: 0 };
  const until = last + LOCK_MS;
  return { locked: now < until, until };
}

/**
 * The count after one more failure. A failure arriving once the window has
 * elapsed starts a fresh count rather than adding to a stale one — five
 * wrong guesses spread over a month is somebody with a bad memory, not an
 * attack.
 */
export function countFailure(failures: Failures | undefined, now: number): Failures {
  const at = new Date(now).toISOString();
  if (!failures) return { count: 1, lastAt: at };
  const last = Date.parse(failures.lastAt);
  const stale = !Number.isFinite(last) || now - last >= LOCK_MS;
  return { count: stale ? 1 : failures.count + 1, lastAt: at };
}

/** Minutes left on a lock, rounded up, for the sentence a person reads. */
export function minutesLeft(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 60_000));
}
