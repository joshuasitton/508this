/**
 * The letters 508This sends, and the short list of things it will put in
 * one.
 *
 * Mail is the channel that exists so the service can stop lying politely. A
 * sign-up against an address that already has an account is answered
 * exactly as a successful one, because a form that says "taken" is a tool
 * for finding out who our customers are — and the cost of that is a person
 * who genuinely forgot, stuck on a page with nowhere to go. The address
 * itself is the only place it is safe to say which, so the address is where
 * it gets said.
 *
 * ## A letter has one variable, and it is a link to us
 *
 * Every message here is a fixed template plus at most one URL, and
 * `letterFor` **throws** if that URL is not on 508This's own origin. The
 * same move the audit record makes, for the same reason: `string` is
 * `string`, and the day somebody threads a "reason" or a filename through
 * to a mail body is the day a customer's document leaves the building in an
 * email. There is nowhere for prose to go.
 *
 * The origin check is not only about prose. A reset link is a credential in
 * a URL; a template that would render whatever link it was handed is a
 * phishing page with our return address on it.
 *
 * ## What is never in one
 *
 * No passphrase, no document, no filename, no finding. A reset mail carries
 * a link and an expiry and says what to do if it was not you.
 */

export interface Message {
  to: string;
  subject: string;
  /** Plain text. No HTML: a mail client that cannot render it is not a client to exclude. */
  text: string;
}

/**
 * Every letter the service sends. Closed, like the audit actions, so adding
 * one is an edit to this file rather than a string at a call site.
 */
export type Letter =
  | { kind: 'reset'; link: string }
  | { kind: 'reset-no-account' }
  | { kind: 'taken'; link: string };

export class NotOurLinkError extends Error {
  constructor() {
    // The offending URL is not in the message: an error carrying it is the
    // link in a log, and a reset link is a credential.
    super('A link in a letter must be on this service’s own origin.');
  }
}

/** The link is ours, or there is no letter. */
function ours(link: string, origin: string): string {
  let url: URL;
  let base: URL;
  try {
    url = new URL(link);
    base = new URL(origin);
  } catch {
    throw new NotOurLinkError();
  }
  if (url.origin !== base.origin) throw new NotOurLinkError();
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new NotOurLinkError();
  return url.toString();
}

/** How long a reset link is good for, in words, wherever that is said. */
export const RESET_WINDOW = 'thirty minutes';

export function letterFor(to: string, letter: Letter, origin: string): Message {
  switch (letter.kind) {
    case 'reset':
      return {
        to,
        subject: 'Reset your 508This passphrase',
        text: [
          'Somebody asked to reset the passphrase for this 508This account.',
          '',
          'If that was you, open this link:',
          ours(letter.link, origin),
          '',
          `The link works once and stops working after ${RESET_WINDOW}. Using it signs you out everywhere else.`,
          '',
          'If it was not you, nothing has changed and you do not need to do anything. Your passphrase still works and nobody has been told whether this address has an account.',
        ].join('\n'),
      };

    case 'reset-no-account':
      return {
        to,
        subject: 'Reset your 508This passphrase',
        text: [
          'Somebody asked to reset a 508This passphrase for this address, and there is no account here under it.',
          '',
          'If that was you, you may have signed up with a different address, or not yet signed up at all.',
          '',
          'If it was not you, there is nothing to do. We answer every reset request the same way, so whoever asked has not been told whether this address has an account.',
        ].join('\n'),
      };

    case 'taken':
      return {
        to,
        subject: 'Somebody tried to create a 508This account with this address',
        text: [
          'Somebody filled in the 508This sign-up form with this address, which already has an account.',
          '',
          'Nothing changed. No new account was created and the existing one is untouched.',
          '',
          'If that was you and you have forgotten the passphrase, reset it here:',
          ours(letter.link, origin),
          '',
          'We told whoever filled in the form exactly what we tell somebody whose sign-up worked, because saying "that address is taken" would let a stranger find out who our customers are.',
        ].join('\n'),
      };
  }
}
