import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { zip } from './helpers/zip';

// The store reads DOCUMENTS_DIR once, at import, so it is set before the
// module is loaded and the module is loaded dynamically.
const root = mkdtempSync(path.join(tmpdir(), '508this-jobs-'));
process.env.DOCUMENTS_DIR = root;
const { createJob, getJob } = await import('../src/server/jobs');

const W = 'xmlns:w="w"';
const docx = zip({
  'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`,
});

test('a job is created with findings that carry a kind, and read back the same', async () => {
  const job = await createJob('hello.docx', 'docx', docx);
  assert.match(job.id, /^[0-9a-f-]{36}$/);
  assert.ok(job.findings.length >= 2, 'no title and no language, at least');
  for (const f of job.findings) assert.equal(typeof f.kind, 'string');
  assert.deepEqual(await getJob(job.id), job);
});

test('a record written by an earlier build, without kinds, is repaired from the stored original', async () => {
  // The first jobs were stored before findings had a kind. Opening one with
  // the new page threw "Cannot read properties of undefined (reading
  // 'title')". The original document is beside the record and detection is
  // deterministic, so the store re-runs it rather than guessing at the
  // missing field, and writes the repaired record back so it happens once.
  const id = '00000000-0000-4000-8000-000000000001';
  const dir = path.join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'original.docx'), docx);
  const stale = {
    id,
    createdAt: '2026-09-17T15:00:00.000Z',
    filename: 'old.docx',
    format: 'docx',
    status: 'detected',
    findings: [
      { criterion: '2.4.2', location: 'document properties', description: 'old wording', severity: 'blocking', remediated: false },
    ],
  };
  writeFileSync(path.join(dir, 'job.json'), JSON.stringify(stale));

  const job = await getJob(id);
  assert.ok(job);
  assert.equal(job.filename, 'old.docx', 'the record itself is kept');
  assert.equal(job.createdAt, stale.createdAt);
  for (const f of job.findings) assert.equal(typeof f.kind, 'string');
  const rewritten = JSON.parse(readFileSync(path.join(dir, 'job.json'), 'utf8'));
  assert.equal(rewritten.findings.every((f: { kind?: string }) => typeof f.kind === 'string'), true);
});

test('an unknown or malformed id is null, never a path', async () => {
  assert.equal(await getJob('00000000-0000-4000-8000-0000000000ff'), null);
  assert.equal(await getJob('../etc'), null);
});
