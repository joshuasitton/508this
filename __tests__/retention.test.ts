import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Job } from '../src/domain/job';
import {
  NEVER_DOWNLOADED,
  RETENTION_DAYS,
  RETENTION_MS,
  daysLeft,
  deleteAfter,
  describeRetention,
  expired,
  retentionDate,
} from '../src/domain/retention';
import { REMOVED, describeScrub, hasQuotation, isScrubbed, scrubJob, scrubText } from '../src/domain/scrub';

const AT = '2026-09-22T09:00:00.000Z';
const NOW = Date.parse(AT);

function job(over: Partial<Job> = {}): Job {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    createdAt: AT,
    filename: 'report.docx',
    format: 'docx',
    status: 'delivered',
    findings: [],
    ...over,
  };
}

test('the clock starts at download, and runs seven days', () => {
  assert.equal(deleteAfter(AT), new Date(NOW + RETENTION_MS).toISOString());
  assert.equal(RETENTION_MS, RETENTION_DAYS * 24 * 60 * 60 * 1000);
  assert.throws(() => deleteAfter('not a time'));
});

/**
 * The gap this policy has, pinned so that nobody discovers it by accident.
 * A clock that started at upload would delete the file in the middle of a
 * fortnight's review; the cost of starting it at download is that a
 * document nobody downloads has no clock at all.
 */
test('a document nobody downloaded has no deletion date, and is not expired', () => {
  const waiting = job();
  assert.equal(expired(waiting, NOW + 365 * 24 * 60 * 60 * 1000), false);
  assert.equal(daysLeft(waiting, NOW), RETENTION_DAYS);
  assert.match(describeRetention(waiting), /countdown to deletion starts when you download/);
  assert.ok(NEVER_DOWNLOADED.length > 40);
});

test('a downloaded document expires on the day it says it will', () => {
  const delivered = job({ deleteAfter: deleteAfter(AT) });
  assert.equal(expired(delivered, NOW + RETENTION_MS - 1), false);
  assert.equal(expired(delivered, NOW + RETENTION_MS), true);
  assert.equal(daysLeft(delivered, NOW + RETENTION_MS - 1), 1);
  assert.equal(daysLeft(delivered, NOW + RETENTION_MS), 0);
});

/** A corrupt retention date on a federal document resolves the customer's way. */
test('an unreadable deletion date counts as due', () => {
  assert.equal(expired({ deleteAfter: 'whenever' }, NOW), true);
});

test('the date is written out, so it does not depend on the server’s locale data', () => {
  assert.equal(retentionDate('2026-09-29T09:00:00.000Z'), '29 September 2026');
  assert.equal(retentionDate('2027-01-01T00:00:00.000Z'), '1 January 2027');
});

test('the sentence changes once the file is actually gone', () => {
  const gone = job({ deleteAfter: deleteAfter(AT), deletedAt: '2026-09-29T09:00:00.000Z' });
  assert.match(describeRetention(gone), /was deleted on 29 September 2026/);
  assert.match(describeRetention(gone), /statement stays; the file does not/);
});

test('a quotation goes and the sentence around it stays', () => {
  assert.equal(
    scrubText('paragraph 4 (“The applicant must submit Form 4506-T”)'),
    `paragraph 4 (${REMOVED})`,
  );
  assert.equal(scrubText('The link text is “click here”, which does not say where it goes.'),
    `The link text is ${REMOVED}, which does not say where it goes.`);
  assert.equal(scrubText('No quotation here at all.'), 'No quotation here at all.');
  // Non-greedy: two quotations in one sentence are two removals, not one.
  assert.equal(scrubText('“one” and “two”'), `${REMOVED} and ${REMOVED}`);
});

/**
 * The invariant this pair of files exists for. After delivery, nothing the
 * document said may remain anywhere in the record — checked against the
 * whole serialised record rather than field by field, because a field added
 * next month is exactly the one somebody forgets.
 */
test('nothing the document said survives a scrub, anywhere in the record', () => {
  const before = job({
    findings: [
      {
        kind: 'link-text',
        criterion: '2.4.4',
        location: 'paragraph 4 (“The applicant must submit”)',
        description: 'The link text is “click here”, which does not say where it goes.',
        severity: 'partial',
        remediated: false,
        proposal: { text: 'A chart of enrolment over time.', at: AT },
        decision: {
          action: 'dismiss',
          by: 'J. Sitton',
          at: AT,
          note: 'The surrounding sentence “read the full notice” carries it.',
          value: 'Alternative text a reviewer wrote',
        },
      },
    ],
    applied: [
      { kind: 'no-title', location: 'document properties', description: 'Set the title to “Annual Report”.' },
    ],
  } as Partial<Job>);

  const after = scrubJob(before, AT);
  const serialised = JSON.stringify(after);

  assert.ok(!hasQuotation(serialised), 'no curly-quoted span survives');
  for (const said of [
    'The applicant must submit',
    'click here',
    'Annual Report',
    'read the full notice',
    'A chart of enrolment over time',
    'Alternative text a reviewer wrote',
  ]) {
    assert.ok(!serialised.includes(said), `still in the record: ${said}`);
  }

  // And the claim the statement rests on is still checkable.
  assert.equal(after.findings[0]?.criterion, '2.4.4');
  assert.equal(after.findings[0]?.kind, 'link-text');
  assert.equal(after.findings[0]?.decision?.action, 'dismiss');
  assert.equal(after.findings[0]?.decision?.by, 'J. Sitton');
  assert.match(after.findings[0]?.location ?? '', /^paragraph 4 /);
  assert.ok(isScrubbed(after));
  assert.ok((describeScrub(after) ?? '').length > 80);
});

/** The negative control: an unscrubbed record still has the words in it. */
test('before a scrub the record does contain them, so the test above is not vacuous', () => {
  const before = job({
    findings: [
      {
        kind: 'link-text',
        criterion: '2.4.4',
        location: 'paragraph 4 (“The applicant must submit”)',
        description: 'nothing',
        severity: 'partial',
        remediated: false,
      },
    ],
  } as Partial<Job>);
  assert.ok(hasQuotation(JSON.stringify(before)));
  assert.equal(isScrubbed(before), false);
  assert.equal(describeScrub(before), null);
});

/**
 * The quotation convention is load-bearing: `scrubText` finds the
 * customer's words by the curly quotes the detectors put around them. A
 * detector that used straight quotes, or none, would put a sentence
 * somewhere the scrub cannot reach — so this says out loud what the
 * convention is worth.
 */
test('the scrub finds quotations by their curly quotes, and nothing else', () => {
  assert.equal(scrubText('The link text is "click here".'), 'The link text is "click here".');
  assert.equal(scrubText('The link text is click here.'), 'The link text is click here.');
  assert.ok(hasQuotation('a “b” c'));
  assert.equal(hasQuotation('a "b" c'), false);
});
