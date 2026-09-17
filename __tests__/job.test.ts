import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_UPLOAD_BYTES, checkUpload, describeStatus, describeUploadProblem, formatFor } from '../src/domain/job';

const PK = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const NOT_PK = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]); // a legacy .doc

test('only .docx is accepted, case-insensitively', () => {
  assert.equal(formatFor('Report.DOCX'), 'docx');
  assert.equal(formatFor('report.pdf'), null);
  assert.equal(formatFor('report.doc'), null);
});

test('problems are reported in the order a person can act on them', () => {
  assert.deepEqual(checkUpload('', 0, PK), { ok: false, reason: 'no-file' });
  assert.deepEqual(checkUpload('report.pdf', 10, PK), { ok: false, reason: 'unsupported-format' });
  assert.deepEqual(checkUpload('report.docx', MAX_UPLOAD_BYTES + 1, PK), { ok: false, reason: 'too-large' });
  assert.deepEqual(checkUpload('report.docx', 10, NOT_PK), { ok: false, reason: 'not-a-document' });
  assert.deepEqual(checkUpload('report.docx', MAX_UPLOAD_BYTES, PK), { ok: true, format: 'docx' });
});

test('a renamed legacy .doc is caught by its signature, not its name', () => {
  // The most common bad upload: someone renames report.doc to report.docx.
  // The reader would fail on it later with a zip error; the person deserves
  // the sentence that tells them what to do instead.
  const r = checkUpload('report.docx', 100, NOT_PK);
  assert.equal(r.ok, false);
  assert.match(describeUploadProblem(r.ok ? 'no-file' : r.reason), /save it as \.docx/);
});

test('every status and problem has a sentence', () => {
  for (const s of ['received', 'detected', 'in-review', 'delivered'] as const) assert.ok(describeStatus(s).length > 10);
  for (const p of ['no-file', 'unsupported-format', 'too-large', 'not-a-document'] as const) {
    assert.ok(describeUploadProblem(p).length > 10);
  }
});
