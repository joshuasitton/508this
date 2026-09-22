/**
 * The rules a passphrase reset obeys.
 *
 * A reset link is a credential that arrives by mail, which is to say a
 * credential that lands in an inbox, gets forwarded, sits in a backup and
 * survives in a sent-items folder on somebody's phone. Everything here
 * follows from treating it that way rather than as a convenience.
 *
 * - **Thirty minutes.** Long enough to walk to the machine the mail is on,
 *   short enough that a link found in a mailbox six months later is inert.
 * - **Once.** Consumed on use, whether or not the new passphrase was
 *   accepted — a second person following the same link is not a second
 *   chance, it is somebody else.
 * - **Everywhere else signs out.** The reason people reset a passphrase is
 *   that they think somebody has it. Leaving that somebody's session alive
 *   makes the reset theatre.
 *
 * Pure, over a clock the caller passes in, so the expiry rules are testable
 * without waiting half an hour.
 */

/** Thirty minutes. */
export const RESET_MS = 30 * 60 * 1000;

/**
 * A reset as it is stored. The token itself is never in here — only its
 * hash, exactly as with a session, so a leaked file is not a set of live
 * reset links.
 */
export interface Reset {
  account: string;
  issuedAt: string;
  /** Set the moment it is used, so a second use finds it spent. */
  usedAt?: string;
}

export type ResetState = 'good' | 'used' | 'expired';

export function resetState(reset: Reset, now: number): ResetState {
  if (reset.usedAt) return 'used';
  const issued = Date.parse(reset.issuedAt);
  // An unparseable timestamp is a corrupt record, and a corrupt record is
  // not one to change a passphrase on.
  if (!Number.isFinite(issued) || now - issued >= RESET_MS) return 'expired';
  return 'good';
}

/**
 * What the person is told. Used and expired are told apart because they
 * need different actions from the reader, and because neither reveals
 * anything: whoever is holding the link already had it.
 */
export function describeResetProblem(state: Exclude<ResetState, 'good'> | 'unknown'): string {
  switch (state) {
    case 'used':
      return 'This link has already been used. If you did not use it, your passphrase may have been changed by somebody else — ask for another link and, if that fails, get in touch.';
    case 'expired':
      return 'This link has expired. They last thirty minutes; ask for another and open it sooner.';
    case 'unknown':
      return 'This link does not work. It may have been cut short by a mail client — try copying the whole address out of the message, or ask for another.';
  }
}

/**
 * What everybody is told after asking for a reset, whether or not the
 * address has an account. It is the same sentence for the same reason every
 * other answer here is: the customer list is worth something, and a form
 * that answers differently hands it over.
 */
export const RESET_REQUESTED =
  'If that address has an account, a link is on its way to it. The link lasts thirty minutes and works once.';
