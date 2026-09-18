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
const { confirm, createJob, decide, getJob, getJobFile, remediateJob, setReviewer, unconfirm, undecide } =
  await import('../src/server/jobs');
const { unzip } = await import('../src/server/unzip');

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

test('remediation stores a fixed document, marks only what re-detection no longer finds, and names the file', async () => {
  const W2 = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const withIssues = zip({
    '[Content_Types].xml': '<Types xmlns="ct"/>',
    '_rels/.rels': '<Relationships xmlns="r"/>',
    'word/document.xml': `<w:document ${W2}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>h</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:hyperlink r:id="x" xmlns:r="r"><w:r><w:t>here</w:t></w:r></w:hyperlink></w:p></w:body></w:document>`,
    'word/styles.xml': `<w:styles ${W2}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
    'word/media/image1.png': new Uint8Array([137, 80, 78, 71]),
  });
  const job = await createJob('grant narrative.docx', 'docx', withIssues);
  assert.deepEqual([...new Set(job.findings.map((f) => f.kind))].sort(), ['link-text', 'no-language', 'no-title', 'table-header']);
  assert.equal(await getJobFile(job.id, 'remediated'), null, 'nothing to download before remediation');

  const done = (await remediateJob(job.id))!;
  assert.equal(done.status, 'remediated', 'the link still needs a person');
  assert.deepEqual(done.applied!.map((a) => a.kind), ['no-title', 'no-language', 'table-header']);
  assert.deepEqual(
    done.findings.map((f) => [f.kind, f.remediated]),
    [
      ['no-title', true],
      ['no-language', true],
      ['table-header', true],
      ['link-text', false],
    ],
  );
  const file = (await getJobFile(job.id, 'remediated'))!;
  assert.equal(file.filename, 'grant narrative (remediated).docx');
  const entries = unzip(file.bytes);
  assert.ok(entries.has('docProps/core.xml'), 'the core part was created');
  assert.deepEqual([...entries.get('word/media/image1.png')!], [137, 80, 78, 71], 'untouched parts carried across byte for byte');
  assert.deepEqual(await getJob(job.id), done, 'the record was written');
});

test('a reviewer’s decisions and confirmations take a job from remediated to delivered, and back if undone', async () => {
  const W3 = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const file = zip({
    '[Content_Types].xml': '<Types xmlns="ct"/>',
    '_rels/.rels': '<Relationships xmlns="r"/>',
    'word/document.xml': `<w:document ${W3}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline xmlns:wp="p"><wp:docPr id="1" name="Pic"/></wp:inline></w:drawing></w:r></w:p><w:p><w:hyperlink r:id="x" xmlns:r="r"><w:r><w:t>here</w:t></w:r></w:hyperlink></w:p></w:body></w:document>`,
    'word/styles.xml': `<w:styles ${W3}><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
    'docProps/core.xml': '<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Title</dc:title></cp:coreProperties>',
  });
  const job = await createJob('memo.docx', 'docx', file);
  assert.deepEqual(job.findings.map((f) => f.kind), ['image-alt', 'link-text']);
  const [alt, link] = job.findings.map((f) => `${f.kind}|${f.location}`);
  const by = 'Josh Sitton';
  const at = '2026-09-18T10:00:00.000Z';

  let j = (await decide(job.id, alt!, { action: 'apply', value: 'A photo of the new office', by, at }))!;
  assert.equal(j.status, 'in-review');
  assert.equal(j.findings[0]!.remediated, true, 'written into the document and confirmed by re-detection');
  assert.equal(j.reviewer, by);

  j = (await decide(job.id, link!, { action: 'dismiss', note: 'The sentence names the destination.', by, at }))!;
  assert.equal(j.findings[1]!.remediated, false, 'a dismissal changes nothing in the document');
  assert.equal(j.status, 'in-review', 'four criteria still wait on the reviewer');

  for (const c of ['1.3.3', '1.4.1', '1.4.5']) j = (await confirm(job.id, c, by))!;
  assert.equal(j.status, 'in-review');
  j = (await confirm(job.id, '2.4.6', by))!;
  assert.equal(j.status, 'delivered', 'nothing open, nothing waiting: conformant');

  j = (await unconfirm(job.id, '2.4.6'))!;
  assert.equal(j.status, 'in-review');
  j = (await undecide(job.id, alt!))!;
  assert.equal(j.findings[0]!.remediated, false, 'undoing the decision rebuilds without it');
  assert.equal(j.findings[0]!.decision, undefined);
  assert.equal(await decide(job.id, 'no-such|finding', { action: 'dismiss', by, at }), null);
});

test('the reviewer is named once, and the name is the job\u2019s rather than a form\u2019s', async () => {
  // The review page used to carry the name in a hidden field on every
  // decision form \u2013 fifteen of them on a PDF with four undescribed figures.
  // The name now lives here, so there is one field on the page and one copy
  // of the fact.
  const job = await createJob('named.docx', 'docx', docx);
  assert.equal(job.reviewer, undefined);
  const named = (await setReviewer(job.id, '  J.\tSitton  '))!;
  assert.equal(named.reviewer, 'J. Sitton', 'normalised on the way in');
  assert.equal((await getJob(job.id))!.reviewer, 'J. Sitton', 'and written to the record');
});

test('a blank name is refused rather than stored as a nameless signature', async () => {
  const job = await createJob('blank.docx', 'docx', docx);
  assert.equal(await setReviewer(job.id, '   '), null);
  assert.equal((await getJob(job.id))!.reviewer, undefined);
  assert.equal(await setReviewer('00000000-0000-4000-8000-00000000dead', 'Nobody'), null);
});

test('handing over does not rewrite the decisions the last reviewer made', async () => {
  // A second reviewer taking the job over is normal; re-attributing what the
  // first one already vouched for would be forging a signature.
  const job = await remediateJob((await createJob('handover.docx', 'docx', docx)).id);
  const first = job!.findings.find((f) => !f.remediated);
  await setReviewer(job!.id, 'First Reviewer');
  await decide(job!.id, `${first!.kind}|${first!.location}`, {
    action: 'dismiss',
    note: 'Checked by hand.',
    by: 'First Reviewer',
    at: new Date().toISOString(),
  });
  const after = (await setReviewer(job!.id, 'Second Reviewer'))!;
  assert.equal(after.reviewer, 'Second Reviewer');
  const decided = after.findings.find((f) => f.decision)!;
  assert.equal(decided.decision!.by, 'First Reviewer');
});
