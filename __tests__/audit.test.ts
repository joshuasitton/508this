import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIT_ACTIONS,
  NotAnIdentifierError,
  auditEvent,
  describeAction,
  describeEvent,
  isIdentifier,
  isSecurityEvent,
} from '../src/domain/audit';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const JOB = '99999999-8888-4777-b666-555555555555';
const AT = '2026-09-22T09:00:00.000Z';

test('an event carries a time, an account, an action and one more identifier', () => {
  const event = auditEvent('job.opened', AT, ACCOUNT, JOB);
  assert.deepEqual(Object.keys(event).sort(), ['account', 'action', 'at', 'subject']);
  assert.equal(event.subject, JOB);
});

/**
 * The invariant this file exists for, and the reason `auditEvent` validates
 * something the type system already declares to be a string.
 *
 * The Word detector puts the customer's own sentences into every finding.
 * The day somebody passes a finding's description as a subject "so the log
 * is useful", the audit log becomes a second copy of every document under a
 * retention policy nobody wrote. There is nowhere for prose to go, and this
 * proves it by trying to put some there.
 */
test('an audit record refuses anything that is not an identifier', () => {
  const prose = [
    'The applicant must submit Form 4506-T by 30 September.',
    'enrolment.docx',
    'Figure 3',
    '../../etc/passwd',
    '',
    '11111111-2222-4333-8444-55555555555', // one digit short
  ];
  for (const text of prose) {
    assert.throws(() => auditEvent('finding.decided', AT, ACCOUNT, text), NotAnIdentifierError, `subject: ${text}`);
    assert.throws(() => auditEvent('finding.decided', AT, text, JOB), NotAnIdentifierError, `account: ${text}`);
  }
});

/** The negative control: the check would be worthless if it refused everything. */
test('a real identifier is accepted, so the test above is not vacuous', () => {
  assert.ok(isIdentifier(ACCOUNT));
  assert.ok(isIdentifier(JOB));
  assert.doesNotThrow(() => auditEvent('job.created', AT, ACCOUNT, JOB));
});

/**
 * A sign-in against an address with no account here is the record an
 * investigation starts from, and it belongs to nobody. If `null` were
 * refused it would be dropped, which is the one event you cannot afford to
 * drop.
 */
test('an event with no account is allowed, because the attempts that matter most have none', () => {
  const event = auditEvent('sign-in.failed', AT, null);
  assert.equal(event.account, null);
  assert.equal(event.subject, null);
});

test('every action has a description, and none of them repeat', () => {
  const said = AUDIT_ACTIONS.map(describeAction);
  assert.equal(new Set(said).size, AUDIT_ACTIONS.length);
  for (const sentence of said) assert.ok(sentence.length > 5);
});

test('the actions an investigator reads first are the ones about getting in', () => {
  assert.ok(isSecurityEvent('sign-in.failed'));
  assert.ok(isSecurityEvent('account.disabled'));
  assert.ok(isSecurityEvent('session.expired'));
  assert.equal(isSecurityEvent('job.opened'), false);
  assert.equal(isSecurityEvent('finding.decided'), false);
});

/**
 * A rendered line is built from identifiers and from this file's own
 * wording. Every word in it is either an id, a timestamp, or a sentence
 * written here — never anything that came out of a customer's document.
 */
test('a rendered line contains only identifiers and words from this file', () => {
  const line = describeEvent(auditEvent('finding.decided', AT, ACCOUNT, JOB));
  const known = new Set([AT, ACCOUNT, JOB, ...describeAction('finding.decided').split(/\s+/)]);
  for (const word of line.split(/\s+/)) assert.ok(known.has(word), `unexpected word in a log line: ${word}`);

  const anonymous = describeEvent(auditEvent('sign-in.failed', AT, null));
  assert.match(anonymous, /no account/);
  assert.ok(!anonymous.includes(ACCOUNT));
});
