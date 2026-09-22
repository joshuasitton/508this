import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PASSWORD,
  MIN_PASSWORD,
  SIGN_IN_FAILED,
  checkEmail,
  checkPassword,
  describeEmailProblem,
  describePasswordProblem,
  normaliseEmail,
  type EmailProblem,
  type PasswordProblem,
} from '../src/domain/account';
import {
  IDLE_MS,
  LIFETIME_MS,
  LOCK_AFTER,
  LOCK_MS,
  countFailure,
  describeSessionEnd,
  lockState,
  minutesLeft,
  sessionState,
  type Session,
} from '../src/domain/session';

const T0 = Date.parse('2026-09-22T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

function session(startedAt: number, lastSeenAt: number): Session {
  return { id: 'a', account: 'b', startedAt: iso(startedAt), lastSeenAt: iso(lastSeenAt) };
}

test('an address is trimmed and lower-cased, and nothing else is done to it', () => {
  assert.equal(normaliseEmail('  Josh@Example.GOV \n'), 'josh@example.gov');
});

/**
 * The failure this guards against is not cosmetic. Stripping dots or a
 * `+tag` is one provider's routing rule, and applying it universally makes
 * two different people's addresses collide — on a system deciding who may
 * open a customer's document, that is an authorisation bug wearing a
 * tidy-up's clothes.
 */
test('two addresses that differ only by a dot or a tag stay two addresses', () => {
  assert.notEqual(normaliseEmail('a.b@example.gov'), normaliseEmail('ab@example.gov'));
  assert.notEqual(normaliseEmail('a+contracts@example.gov'), normaliseEmail('a@example.gov'));
});

test('an address needs a name, an at sign and a dotted domain', () => {
  for (const good of ['a@b.co', 'first.last@agency.example.gov', "o'brien@example.gov"]) {
    const check = checkEmail(good);
    assert.ok(check.ok, `${good} should be accepted`);
  }
  for (const [bad, reason] of [
    ['', 'missing'],
    ['   ', 'missing'],
    ['josh', 'malformed'],
    ['josh@example', 'malformed'],
    ['josh@.gov', 'malformed'],
    ['a b@example.gov', 'malformed'],
    [`${'a'.repeat(250)}@example.gov`, 'too-long'],
  ] as [string, EmailProblem][]) {
    const check = checkEmail(bad);
    assert.equal(check.ok, false, `${bad || '(empty)'} should be rejected`);
    assert.ok(!check.ok && check.reason === reason, `${bad || '(empty)'} should be ${reason}`);
  }
});

test('a passphrase is measured by length, not by punctuation', () => {
  // Four ordinary words, no symbol, no digit, no capital: accepted, because
  // composition rules make passwords worse rather than better.
  assert.ok(checkPassword('correct horse battery staple').ok);
  assert.ok(checkPassword('a'.repeat(MIN_PASSWORD)).ok);
  assert.equal(checkPassword('a'.repeat(MIN_PASSWORD - 1)).ok, false);
  assert.ok(checkPassword('a'.repeat(MAX_PASSWORD)).ok);
  assert.equal(checkPassword('a'.repeat(MAX_PASSWORD + 1)).ok, false);
});

/**
 * Counted in code points. Measured in UTF-16 units, a passphrase of
 * emoji or of any astral script would pass a length check its author would
 * not recognise as having passed.
 */
test('length is counted the way the person who typed it counts it', () => {
  const eleven = '🔑'.repeat(11);
  assert.equal(eleven.length, 22, 'the trap: JavaScript calls this 22 characters');
  assert.equal(checkPassword(eleven).ok, false);
  assert.ok(checkPassword('🔑'.repeat(MIN_PASSWORD)).ok);
});

test('the passphrases nobody really chose are refused', () => {
  for (const bad of ['passwordpassword', 'PasswordPassword', '  password123  ', 'accessibility', '508this12345']) {
    const check = checkPassword(bad);
    assert.equal(check.ok, false, `${bad} should be refused`);
    assert.ok(!check.ok && check.reason === 'guessable');
  }
  // Matched whole, not by substring: a real passphrase containing one of
  // those words is still a real passphrase.
  assert.ok(checkPassword('my password is a secret').ok);
});

test('a passphrase cannot be the address it signs in with', () => {
  const check = checkPassword('Josh@Example.GOV', '  josh@example.gov ');
  assert.equal(check.ok, false);
  assert.ok(!check.ok && check.reason === 'is-the-email');
});

test('every problem has a sentence, and they do not repeat', () => {
  const emails: EmailProblem[] = ['missing', 'malformed', 'too-long'];
  const passwords: PasswordProblem[] = ['missing', 'too-short', 'too-long', 'guessable', 'is-the-email'];
  const said = [...emails.map(describeEmailProblem), ...passwords.map(describePasswordProblem)];
  assert.equal(new Set(said).size, said.length);
  for (const sentence of said) assert.ok(sentence.length > 20);
  // The one sentence a failed sign-in gets, whatever went wrong.
  assert.ok(SIGN_IN_FAILED.length > 20);
});

test('a session dies of idleness and of old age, and they are told apart', () => {
  assert.equal(sessionState(session(T0, T0), T0 + 60_000), 'active');
  assert.equal(sessionState(session(T0, T0), T0 + IDLE_MS), 'idle');

  // Busy all day: never idle, still finished at the eight-hour mark.
  const busy = session(T0, T0 + LIFETIME_MS - 1_000);
  assert.equal(sessionState(busy, T0 + LIFETIME_MS - 500), 'active');
  assert.equal(sessionState(busy, T0 + LIFETIME_MS), 'expired');

  assert.notEqual(describeSessionEnd('idle'), describeSessionEnd('expired'));
});

test('a corrupt session record fails closed', () => {
  const broken: Session = { id: 'a', account: 'b', startedAt: 'not a date', lastSeenAt: iso(T0) };
  assert.equal(sessionState(broken, T0), 'expired');
});

test('five wrong passphrases lock the account, and the lock lets go', () => {
  const failures = { count: LOCK_AFTER, lastAt: iso(T0) };
  assert.equal(lockState(undefined, T0).locked, false);
  assert.equal(lockState({ count: LOCK_AFTER - 1, lastAt: iso(T0) }, T0).locked, false);
  assert.equal(lockState(failures, T0).locked, true);
  assert.equal(lockState(failures, T0 + LOCK_MS).locked, false);
  assert.equal(minutesLeft(lockState(failures, T0).until, T0), LOCK_MS / 60_000);
});

/**
 * Five wrong guesses spread over a month is somebody with a bad memory.
 * Counting them together would lock an account on the strength of mistakes
 * made in a different season.
 */
test('failures outside the window start a fresh count rather than adding to a stale one', () => {
  const first = countFailure(undefined, T0);
  assert.equal(first.count, 1);
  assert.equal(countFailure(first, T0 + 1_000).count, 2);
  assert.equal(countFailure(first, T0 + LOCK_MS).count, 1);
});
