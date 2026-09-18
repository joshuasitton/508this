import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PRINCIPLES, buildAcr, reportDate } from '../src/domain/acr';
import { CRITERIA, DOCUMENT_EXEMPT } from '../src/domain/criteria';
import type { Finding } from '../src/domain/findings';
import type { Job } from '../src/domain/job';

function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    createdAt: '2026-09-18T10:00:00.000Z',
    filename: 'Handbook.docx',
    format: 'docx',
    status: 'detected',
    findings: [],
    ...over,
  };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    kind: 'image-alt',
    criterion: '1.1.1',
    location: 'image 1',
    description: 'No alternative text.',
    severity: 'partial',
    remediated: false,
    ...over,
  };
}

const CONFIRM_ALL = {
  '1.3.3': { by: 'A Reviewer', at: '2026-09-18T11:00:00.000Z' },
  '1.4.1': { by: 'A Reviewer', at: '2026-09-18T11:00:00.000Z' },
  '1.4.5': { by: 'A Reviewer', at: '2026-09-18T11:00:00.000Z' },
  '2.4.6': { by: 'A Reviewer', at: '2026-09-18T11:00:00.000Z' },
};

test('every criterion in the catalogue gets exactly one row', () => {
  const acr = buildAcr(job());
  const rows = acr.sections.flatMap((s) => s.rows);
  assert.equal(rows.length, CRITERIA.length);
  assert.deepEqual(
    rows.map((r) => r.criterion),
    CRITERIA.map((c) => c.id),
  );
  assert.deepEqual(
    acr.sections.map((s) => s.principle),
    [...PRINCIPLES],
  );
});

test('the criteria E205.4 exempts are Not Applicable, whatever was found', () => {
  const acr = buildAcr(job({ findings: [finding({ criterion: '2.4.1', severity: 'blocking' })] }));
  const rows = new Map(acr.sections.flatMap((s) => s.rows).map((r) => [r.criterion, r]));
  for (const id of DOCUMENT_EXEMPT) assert.equal(rows.get(id)!.status, 'Not Applicable', id);
});

test('an unreviewed document is not complete, and says why on its face', () => {
  const acr = buildAcr(job());
  assert.equal(acr.complete, false);
  assert.equal(acr.pending, 4);
  const rows = acr.sections.flatMap((s) => s.rows).filter((r) => r.pending);
  assert.deepEqual(rows.map((r) => r.criterion), ['1.3.3', '1.4.1', '1.4.5', '2.4.6']);
  assert.ok(acr.notes.some((n) => n.includes('Needs Review is not a conformance term')));
});

test('a confirmed, clean document is a complete statement', () => {
  const acr = buildAcr(job({ confirmations: CONFIRM_ALL, reviewer: 'A Reviewer' }));
  assert.equal(acr.complete, true);
  assert.equal(acr.pending, 0);
  assert.equal(acr.verdict.headline, 'Conforms to Section 508');
  assert.ok(!acr.notes.some((n) => n.includes('Needs Review')));
});

test('a PDF is reported against the PDF coverage, not the Word one', () => {
  const acr = buildAcr(job({ filename: 'Infographic.pdf', format: 'pdf' }));
  assert.equal(acr.pending, 7);
  assert.ok(acr.facts.some((f) => f.value === 'Non-web document (PDF)'));
  const contrast = acr.sections.flatMap((s) => s.rows).find((r) => r.criterion === '1.4.3')!;
  assert.equal(contrast.status, 'Needs Review');
  assert.ok(contrast.remarks.includes('content-stream operators'));
});

test('a Word document has contrast checked, so that row does not wait on a person', () => {
  const acr = buildAcr(job());
  const contrast = acr.sections.flatMap((s) => s.rows).find((r) => r.criterion === '1.4.3')!;
  assert.equal(contrast.status, 'Supports');
});

test('the reviewer is named only once there is one', () => {
  assert.ok(!buildAcr(job()).facts.some((f) => f.label === 'Reviewer'));
  const named = buildAcr(job({ reviewer: 'A Reviewer' }));
  assert.equal(named.facts.find((f) => f.label === 'Reviewer')!.value, 'A Reviewer');
});

test('the method says what was checked and what remediation changed', () => {
  const acr = buildAcr(
    job({
      findings: [finding({ remediated: true }), finding({ location: 'image 2', remediated: true })],
      remediatedAt: '2026-09-18T12:00:00.000Z',
    }),
  );
  const method = acr.facts.find((f) => f.label === 'Evaluation method')!.value;
  assert.ok(method.includes('after remediation of 2 issues'));
  assert.ok(method.includes('not yet confirmed'));
});

test('the report is dated when the document was remediated, not when it arrived', () => {
  const acr = buildAcr(job({ remediatedAt: '2026-10-02T09:00:00.000Z' }));
  assert.equal(acr.facts.find((f) => f.label === 'Report date')!.value, 'October 2, 2026');
});

test('dates are written out, so two machines render the same statement', () => {
  assert.equal(reportDate('2026-01-09T23:30:00.000Z'), 'January 9, 2026');
  assert.equal(reportDate('not a date'), 'not a date');
});

test('a blocking finding reaches the row it was filed against', () => {
  const acr = buildAcr(job({ findings: [finding({ severity: 'blocking', location: 'image 4' })] }));
  const row = acr.sections.flatMap((s) => s.rows).find((r) => r.criterion === '1.1.1')!;
  assert.equal(row.status, 'Does Not Support');
  assert.ok(row.remarks.includes('image 4'));
  assert.equal(acr.verdict.headline, 'Does not conform to Section 508 yet');
});
