import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_REVIEWER,
  MAX_UPLOAD_BYTES,
  checkUpload,
  describeStatus,
  describeUploadProblem,
  describeExport,
  formatFor,
  reviewerName,
} from '../src/domain/job';

const ctrl = (code: number) => String.fromCharCode(code);

const PK = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // a zip, so a .docx
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"
const NOT_PK = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]); // a legacy .doc

test('Word documents and PDFs are accepted, case-insensitively; nothing else is', () => {
  assert.equal(formatFor('Report.DOCX'), 'docx');
  assert.equal(formatFor('Infographic.PDF'), 'pdf');
  assert.equal(formatFor('deck.pptx'), null);
  assert.equal(formatFor('report.doc'), null);
});

test('problems are reported in the order a person can act on them', () => {
  assert.deepEqual(checkUpload('', 0, PK), { ok: false, reason: 'no-file' });
  assert.deepEqual(checkUpload('deck.pptx', 10, PK), { ok: false, reason: 'unsupported-format' });
  assert.deepEqual(checkUpload('report.docx', MAX_UPLOAD_BYTES + 1, PK), { ok: false, reason: 'too-large' });
  assert.deepEqual(checkUpload('report.docx', 10, NOT_PK), { ok: false, reason: 'not-a-document' });
  assert.deepEqual(checkUpload('report.docx', MAX_UPLOAD_BYTES, PK), { ok: true, format: 'docx' });
  assert.deepEqual(checkUpload('infographic.pdf', 1000, PDF), { ok: true, format: 'pdf' });
});

test('each format is checked against its own signature, so a file whose name lies is caught', () => {
  // The two common bad uploads: someone renames report.doc to report.docx,
  // and someone renames a PDF to .docx because the form asked for Word.
  // Either would fail later with something unhelpful from a reader.
  assert.deepEqual(checkUpload('report.docx', 100, NOT_PK), { ok: false, reason: 'not-a-document' });
  assert.deepEqual(checkUpload('report.docx', 100, PDF), { ok: false, reason: 'not-a-document' });
  assert.deepEqual(checkUpload('report.pdf', 100, PK), { ok: false, reason: 'not-a-document' });
  assert.match(describeUploadProblem('not-a-document'), /not what its name says/);
});

test('a reviewer’s name is normalised in one place, because it is printed in two documents', () => {
  // The same name goes into the job record and into a text run of the Word
  // conformance report, which rejects control characters outright. A name
  // pasted out of a signature block arrives with newlines in it, and
  // normalising at only one of the two ends would put two spellings of one
  // person on the same assurance.
  assert.equal(reviewerName('  J. Sitton  '), 'J. Sitton');
  assert.equal(reviewerName('Jane\n\tQ.   Reviewer'), 'Jane Q. Reviewer');
  assert.equal(reviewerName(`Ana${ctrl(7)} Ruiz`), 'Ana Ruiz');
  assert.equal(reviewerName('José Álvarez-Núñez'), 'José Álvarez-Núñez');
});

test('a name that is not a name comes back empty, and is never stored as a blank signature', () => {
  for (const nothing of ['', '   ', '\n\t', ctrl(0) + ctrl(7)]) assert.equal(reviewerName(nothing), '');
});

test('a very long name is cut to something that fits a table cell', () => {
  assert.equal(reviewerName('R'.repeat(MAX_REVIEWER + 40)).length, MAX_REVIEWER);
  // And the cut never leaves a trailing space to print beside a decision.
  assert.equal(reviewerName(`${'R'.repeat(MAX_REVIEWER - 1)} Smith`), 'R'.repeat(MAX_REVIEWER - 1));
});

test('every status and problem has a sentence', () => {
  for (const s of ['received', 'detected', 'in-review', 'delivered'] as const) assert.ok(describeStatus(s).length > 10);
  for (const p of ['no-file', 'unsupported-format', 'too-large', 'not-a-document'] as const) {
    assert.ok(describeUploadProblem(p).length > 10);
  }
});

/* ── What the PDF export came to ─────────────────────────────────────── */

/**
 * The sentence beside the download is the whole of what a customer is told
 * about the export, so it has to distinguish three things that look alike from
 * the outside: checked and clean, checked and still owing something, and *not
 * fully checked*. The third is the one worth a test — an empty finding list
 * from a pass that never ran looks exactly like a clean one, and reporting it
 * as clean would be the service claiming a check it did not make.
 */
test('the export is described by what was actually checked', () => {
  assert.equal(describeExport(undefined), null);

  const clean = describeExport({ at: '2026-09-28T00:00:00Z', pages: 3, criteria: [], rendered: true }) ?? '';
  assert.match(clean, /3 pages/);
  assert.match(clean, /nothing is open/);

  const partial = describeExport({ at: '2026-09-28T00:00:00Z', pages: 3, criteria: ['1.1.1'], rendered: true }) ?? '';
  assert.match(partial, /One criterion is still open/);
  assert.match(partial, /1\.1\.1/);

  const unrendered = describeExport({ at: '2026-09-28T00:00:00Z', pages: 2, criteria: [], rendered: false }) ?? '';
  assert.match(unrendered, /could not run/);
  assert.doesNotMatch(unrendered, /same detector this service checks/);
});

test('a refused export says which document feature refused it, and what to do', () => {
  const characters = describeExport({ at: 'now', refused: 'unsupported-characters', detail: ['提', '→'] }) ?? '';
  assert.match(characters, /提/);
  assert.match(characters, /Save as PDF/);
  // Not "we replaced them": the point of the refusal is that nothing was.
  assert.match(characters, /refuses rather than replacing/);

  const figure = describeExport({ at: 'now', refused: 'unsupported-figure', detail: ['Chart 1 (.emf)'] }) ?? '';
  assert.match(figure, /Chart 1 \(\.emf\)/);
  assert.match(figure, /silently missing/);
});
