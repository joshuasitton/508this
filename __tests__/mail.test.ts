import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NotOurLinkError, RESET_WINDOW, letterFor, type Letter } from '../src/domain/mail';
import {
  RESET_MS,
  RESET_REQUESTED,
  describeResetProblem,
  resetState,
  type Reset,
  type ResetState,
} from '../src/domain/reset';

const ORIGIN = 'https://508this.example';
const LINK = `${ORIGIN}/account/reset?token=abc`;
const TO = 'josh@example.gov';

const LETTERS: Letter[] = [
  { kind: 'reset', link: LINK },
  { kind: 'reset-no-account' },
  { kind: 'taken', link: LINK },
];

test('every letter has a subject and a body, and no two say the same thing', () => {
  const written = LETTERS.map((letter) => letterFor(TO, letter, ORIGIN));
  // Bodies are distinct; subjects are not required to be. The two reset
  // letters deliberately share one, because the person reading it asked for
  // a reset and that is what the subject should say — whether or not there
  // turned out to be an account behind the address.
  assert.equal(new Set(written.map((m) => m.text)).size, LETTERS.length);
  assert.equal(
    letterFor(TO, { kind: 'reset', link: LINK }, ORIGIN).subject,
    letterFor(TO, { kind: 'reset-no-account' }, ORIGIN).subject,
  );
  for (const message of written) {
    assert.equal(message.to, TO);
    assert.ok(message.text.length > 120);
  }
});

/**
 * The invariant this file exists for, and the reason `letterFor` validates
 * something the type system already calls a string.
 *
 * A reset link is a credential. A template that renders whatever link it is
 * handed is a phishing page with 508This's return address on it — and the
 * same hole is how a filename or a finding's text would get mailed out of
 * the building the day somebody threads a "reason" through to a body.
 */
test('a letter refuses a link that is not ours', () => {
  const elsewhere = [
    'https://508this.example.evil.test/account/reset?token=abc',
    'https://evil.test/account/reset?token=abc',
    'http://508this.example/account/reset?token=abc', // right host, wrong scheme
    'javascript:alert(1)',
    '/account/reset?token=abc',
    'not a url at all',
    '',
  ];
  for (const link of elsewhere) {
    assert.throws(() => letterFor(TO, { kind: 'reset', link }, ORIGIN), NotOurLinkError, `should refuse: ${link}`);
    assert.throws(() => letterFor(TO, { kind: 'taken', link }, ORIGIN), NotOurLinkError, `should refuse: ${link}`);
  }
});

/** The negative control: the check would prove nothing if it refused everything. */
test('our own link is accepted, so the test above is not vacuous', () => {
  const message = letterFor(TO, { kind: 'reset', link: LINK }, ORIGIN);
  assert.ok(message.text.includes(LINK));
  assert.ok(message.text.includes(RESET_WINDOW));
});

/**
 * A letter is a fixed template plus at most one URL. Nothing a customer
 * typed, nothing out of a document, and above all no passphrase, has a
 * route into one — checked here by looking at what is actually in the text.
 */
test('nothing but the template and the link is in a letter', () => {
  const secrets = ['correct horse battery staple', 'enrolment.docx', 'Figure 3', 'The applicant must submit'];
  for (const letter of LETTERS) {
    const { text } = letterFor(TO, letter, ORIGIN);
    for (const secret of secrets) assert.ok(!text.includes(secret), `${letter.kind} leaked: ${secret}`);
  }
});

test('a letter about an address with no account says so without naming anybody', () => {
  const { text } = letterFor(TO, { kind: 'reset-no-account' }, ORIGIN);
  assert.match(text, /no account here/i);
  assert.ok(!text.includes('http'), 'there is nothing to link to, so there is no link');
});

test('a reset link is good for thirty minutes, once', () => {
  const at = Date.parse('2026-09-22T09:00:00.000Z');
  const fresh: Reset = { account: 'a', issuedAt: new Date(at).toISOString() };

  assert.equal(resetState(fresh, at), 'good');
  assert.equal(resetState(fresh, at + RESET_MS - 1), 'good');
  assert.equal(resetState(fresh, at + RESET_MS), 'expired');

  const spent: Reset = { ...fresh, usedAt: new Date(at).toISOString() };
  assert.equal(resetState(spent, at), 'used');
  assert.equal(resetState(spent, at + RESET_MS + 1), 'used', 'a spent link stays spent rather than becoming expired');
});

test('a corrupt reset record fails closed', () => {
  assert.equal(resetState({ account: 'a', issuedAt: 'not a date' }, Date.now()), 'expired');
});

test('each reset problem says something different, and the one answer is the same for everybody', () => {
  const states: (Exclude<ResetState, 'good'> | 'unknown')[] = ['used', 'expired', 'unknown'];
  const said = states.map(describeResetProblem);
  assert.equal(new Set(said).size, states.length);
  for (const sentence of said) assert.ok(sentence.length > 40);
  assert.match(RESET_REQUESTED, /if that address has an account/i);
});
