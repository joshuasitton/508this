import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assess,
  assessAll,
  conforms,
  describeAssessment,
  describeFinding,
  describeSummary,
  progress,
  summarise,
  type Finding,
} from '../src/domain/findings';

const missingAlt: Finding = {
  kind: 'image-alt',
  criterion: '1.1.1',
  location: 'page 3',
  description: 'The chart has no alternative text.',
  severity: 'partial',
  remediated: false,
};

const scanned: Finding = {
  kind: 'image-alt',
  criterion: '1.1.1',
  location: 'pages 1–12',
  description: 'The document is a scanned image with no text layer.',
  severity: 'blocking',
  remediated: false,
};

const fixed = (f: Finding): Finding => ({ ...f, remediated: true });

test('a criterion with no open findings Supports', () => {
  assert.equal(assess('1.1.1', [], 'document').status, 'Supports');
  assert.equal(assess('1.1.1', [fixed(missingAlt)], 'document').status, 'Supports');
});

test('a partial finding makes Partially Supports; a blocking one makes Does Not Support', () => {
  assert.equal(assess('1.1.1', [missingAlt], 'document').status, 'Partially Supports');
  assert.equal(assess('1.1.1', [missingAlt, scanned], 'document').status, 'Does Not Support');
});

test('remediated findings do not count against the delivered document', () => {
  // Deliberate: the report describes what we hand back, not what we received.
  // Counting fixed findings would mean a perfectly remediated document could
  // never be reported as conformant, which is the one thing the customer buys.
  const a = assess('1.1.1', [fixed(scanned), missingAlt], 'document');
  assert.equal(a.status, 'Partially Supports');
  assert.deepEqual(a.open, [missingAlt]);
});

test('an exempt criterion is Not Applicable to a document even with a finding filed against it', () => {
  // A finding mis-filed under 2.4.1 on a PDF must not fail the document. The
  // standard exempts it; our bookkeeping does not get a vote.
  const stray: Finding = { ...missingAlt, criterion: '2.4.1' };
  assert.equal(assess('2.4.1', [stray], 'document').status, 'Not Applicable');
  assert.equal(assess('2.4.1', [stray], 'web').status, 'Partially Supports');
});

test('a document conforms when nothing it owes is open', () => {
  assert.equal(conforms([], 'document'), true);
  assert.equal(conforms([missingAlt], 'document'), false);
  assert.equal(conforms([fixed(missingAlt)], 'document'), true);
  const stray: Finding = { ...missingAlt, criterion: '3.2.3' };
  assert.equal(conforms([stray], 'document'), true, 'exempt criterion cannot block a document');
  assert.equal(conforms([stray], 'web'), false);
});

test('assessAll covers every criterion once, in catalogue order', () => {
  const all = assessAll([], 'document');
  assert.equal(all.length, 38);
  assert.equal(all[0]!.criterion, '1.1.1');
  assert.equal(all[37]!.criterion, '4.1.2');
  assert.equal(all.filter((a) => a.status === 'Not Applicable').length, 4);
});

test('progress is a fraction of findings remediated, and an empty job is complete', () => {
  // Deliberate: 0/0 is 1, not NaN. A clean document has nothing left to do,
  // and a progress bar that read "NaN%" for the best possible outcome would
  // be the first thing a customer noticed.
  assert.deepEqual(progress([]), { total: 0, remediated: 0, open: 0, fraction: 1 });
  assert.deepEqual(progress([missingAlt, fixed(scanned)]), { total: 2, remediated: 1, open: 1, fraction: 0.5 });
});

test('the report sentence is owned here, one per status', () => {
  assert.equal(describeAssessment(assess('1.1.1', [], 'document')), '1.1.1 Non-text Content: no open issues.');
  assert.equal(
    describeAssessment(assess('2.4.1', [], 'document')),
    '2.4.1 Bypass Blocks: not required for this content under E205.4.',
  );
  assert.equal(
    describeAssessment(assess('1.1.1', [missingAlt], 'document')),
    '1.1.1 Non-text Content: 1 open issue (page 3).',
  );
  assert.equal(
    describeAssessment(assess('1.1.1', [missingAlt, scanned], 'document')),
    '1.1.1 Non-text Content: 2 open issues (page 3, pages 1–12).',
  );
});

test('a finding is named to a person with its state first', () => {
  assert.equal(
    describeFinding(missingAlt),
    'Open – 1.1.1 Non-text Content, page 3: The chart has no alternative text.',
  );
  assert.equal(
    describeFinding(scanned),
    'Blocking – 1.1.1 Non-text Content, pages 1–12: The document is a scanned image with no text layer.',
  );
  assert.equal(
    describeFinding(fixed(scanned)),
    'Fixed – 1.1.1 Non-text Content, pages 1–12: The document is a scanned image with no text layer.',
  );
});

test('the summary counts what the document owes and what is open, and its headline follows', () => {
  // 34 owed for a document. One partial finding on 1.1.1 → 1 criterion short,
  // 0 blocking, 1 other. The stray 2.4.1 finding is exempt and counts nowhere.
  const stray: Finding = { ...missingAlt, criterion: '2.4.1' };
  const s = summarise([missingAlt, scanned, stray], 'document');
  assert.deepEqual(s, { conforms: false, owed: 34, short: 1, blocking: 1, other: 1 });
  assert.equal(describeSummary(s).headline, 'Does not conform to Section 508 yet');
  assert.equal(
    describeSummary(s).detail,
    '1 of the 34 criteria this document owes has open issues: 2 in all, of which 1 is blocking and 1 is partial. Fix them and the document conforms.',
  );
  const clean = summarise([fixed(missingAlt)], 'document');
  assert.deepEqual(clean, { conforms: true, owed: 34, short: 0, blocking: 0, other: 0 });
  assert.equal(describeSummary(clean).headline, 'Conforms to Section 508');
  assert.equal(summarise([], 'web').owed, 38);
});
