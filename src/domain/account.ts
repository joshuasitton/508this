/**
 * Who is using 508This, and what it takes to prove it.
 *
 * `setReviewer` asks for a name and writes it beside every decision on a
 * federal conformance statement. That is right for a service one person
 * runs and it is not authentication — a name typed into a box is a claim
 * nobody checked. The Chairman's decision to accept Controlled Unclassified
 * Information is what makes the difference matter: NIST SP 800-171 requires
 * that users are identified and that the identity is authenticated before
 * they reach the system, and a bearer URL with a job id in it identifies
 * nobody at all.
 *
 * This file is the policy and nothing else: what an email address has to
 * look like, what a passphrase has to be, and the sentences a person is
 * shown when theirs is not. It takes no dependency and touches no disk, so
 * the rules can be read, argued with and tested on their own.
 *
 * ## Why the password rules are length and not punctuation
 *
 * Because composition rules make passwords worse. NIST SP 800-63B — which
 * is where 800-171's identification and authentication requirements point —
 * dropped mandatory mixed case, digits and symbols, and dropped scheduled
 * rotation with them: both push people towards `Summer2026!` and a sticky
 * note, and neither survives an offline attack any longer than a longer
 * phrase does. What is kept is length, a ceiling high enough that a real
 * passphrase fits, and a refusal of the handful of strings that are
 * guessed first.
 *
 * The blocklist here is small and honest about it. A real one is a corpus
 * of breached passwords, which is a data set this service does not have and
 * should not invent; what is here catches the passwords a person types when
 * they are not really choosing one, and the README says plainly that it is
 * a floor rather than a screen.
 */

/** The account itself. Credentials are not here — they are the server's. */
export interface Account {
  id: string;
  /** Normalised: trimmed and lower-cased. The only form ever stored. */
  email: string;
  createdAt: string;
  /**
   * Set when the account may no longer sign in. Disabling rather than
   * deleting is deliberate: the audit log names accounts by id, and an id
   * that resolves to nothing turns a record of who did something into a
   * record that somebody did.
   */
  disabledAt?: string;
}

/**
 * Twelve, against 800-63B's floor of eight. The extra four cost a person
 * one word and buy several orders of magnitude against an offline attack on
 * a stolen hash, which — given what this service stores — is the attack
 * worth pricing for.
 */
export const MIN_PASSWORD = 12;

/**
 * A ceiling rather than a limit. It exists because a hash function given
 * unbounded input is a way to make a server do unbounded work, not because
 * anything is wrong with a long passphrase, and 128 is far above where a
 * person's sentence lands.
 */
export const MAX_PASSWORD = 128;

/** The longest address the form accepts. Real ones do not approach it. */
export const MAX_EMAIL = 254;

export type EmailProblem = 'missing' | 'malformed' | 'too-long';

export type EmailCheck = { ok: true; email: string } | { ok: false; reason: EmailProblem };

/**
 * Trimmed and lower-cased, and that is the whole of the normalisation.
 *
 * Nothing here strips dots or `+tags`: those are one provider's routing
 * rules and treating them as universal makes two different people's
 * addresses collide, which on a system that decides who may open a
 * customer's document is not a tidy-up, it is an authorisation bug.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Deliberately not a grammar for RFC 5322. The address is checked for the
 * shape a person can act on — something, an at sign, a domain with a dot —
 * and everything past that is settled by whether the confirmation mail
 * arrives. An address regex that rejects a valid address is a support
 * ticket; one that accepts an invalid one costs nothing this service will
 * not find out about anyway.
 */
export function checkEmail(raw: string): EmailCheck {
  const email = normaliseEmail(raw);
  if (!email) return { ok: false, reason: 'missing' };
  if (email.length > MAX_EMAIL) return { ok: false, reason: 'too-long' };
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return { ok: false, reason: 'malformed' };
  return { ok: true, email };
}

export function describeEmailProblem(reason: EmailProblem): string {
  switch (reason) {
    case 'missing':
      return 'Enter the email address this account should use.';
    case 'malformed':
      return 'That does not look like an email address. It needs a name, an @, and a domain.';
    case 'too-long':
      return 'That address is longer than any real one. Check it for a stray paste.';
  }
}

export type PasswordProblem = 'missing' | 'too-short' | 'too-long' | 'guessable' | 'is-the-email';

export type PasswordCheck = { ok: true } | { ok: false; reason: PasswordProblem };

/**
 * The passwords people type when they are not choosing one. This is a
 * floor, not a screen — see the note at the top of the file — and it is
 * matched against the whole password rather than against substrings,
 * because rejecting anything *containing* "password" would throw out
 * perfectly good passphrases for no gain.
 */
const GUESSABLE = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  'passwordpassword',
  '123456789012',
  '1234567890123',
  'qwertyuiopas',
  'letmeinletmein',
  'iloveyouiloveyou',
  'administrator',
  'section508',
  'section508!',
  '508this',
  '508this12345',
  'accessibility',
]);

/**
 * The password policy, in one function, with the email in hand because the
 * commonest bad passphrase is the address it signs in with.
 */
export function checkPassword(password: string, email?: string): PasswordCheck {
  if (!password) return { ok: false, reason: 'missing' };
  // Length in code points, so a passphrase written in any script is
  // measured the way its author counts it rather than in UTF-16 units.
  const length = [...password].length;
  if (length < MIN_PASSWORD) return { ok: false, reason: 'too-short' };
  if (length > MAX_PASSWORD) return { ok: false, reason: 'too-long' };

  const folded = password.trim().toLowerCase();
  if (email && folded === normaliseEmail(email)) return { ok: false, reason: 'is-the-email' };
  if (GUESSABLE.has(folded)) return { ok: false, reason: 'guessable' };
  return { ok: true };
}

export function describePasswordProblem(reason: PasswordProblem): string {
  switch (reason) {
    case 'missing':
      return 'Choose a passphrase for this account.';
    case 'too-short':
      return `A passphrase needs at least ${MIN_PASSWORD} characters. Four words you will remember beats eight characters you will not.`;
    case 'too-long':
      return `That is over ${MAX_PASSWORD} characters. Shorten it; nothing needs to be that long.`;
    case 'guessable':
      return 'That is one of the first passphrases anybody guesses. Choose another.';
    case 'is-the-email':
      return 'Your passphrase cannot be your email address.';
  }
}

/**
 * What a person is told when sign-in fails, whatever actually went wrong.
 *
 * One sentence for a wrong password, an unknown address and a disabled
 * account alike, because saying which would let anybody with a form
 * discover who has an account here — and on a service holding federal
 * documents, the customer list is itself worth something. The audit log
 * records which it really was; the screen does not.
 */
export const SIGN_IN_FAILED =
  'That email address and passphrase do not match an account. Check both and try again.';
