import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes as randomBytesSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { zip } from './helpers/zip';

// The store reads DOCUMENTS_DIR once, at import, so it is set before the
// module is loaded and the module is loaded dynamically.
const root = mkdtempSync(path.join(tmpdir(), '508this-jobs-'));
process.env.DOCUMENTS_DIR = root;
// Every test in this file therefore runs against an encrypted store, which
// is the point: encryption at rest is a property of the store and not a
// mode, so the whole suite exercises it rather than one test proving the
// cipher works in isolation.
process.env.STORAGE_KEY = randomBytesSync(32).toString('base64');
const {
  claimJobs,
  confirm,
  markDelivered,
  sweepExpired,
  createJob,
  decide,
  getJob,
  getJobFile,
  remediateJob,
  setReviewer,
  unconfirm,
  undecide,
} = await import('../src/server/jobs');
const { unzip } = await import('../src/server/unzip');
const { openText } = await import('../src/server/crypto');

/**
 * Every job needs an owner now. The store takes it as a required argument
 * rather than an optional one precisely so that a test cannot quietly write
 * the bearer-URL job this change exists to end.
 */
const OWNER = { account: '11111111-2222-4333-8444-555555555555' } as const;

const W = 'xmlns:w="w"';
const docx = zip({
  'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`,
});

test('a job is created with findings that carry a kind, and read back the same', async () => {
  const job = await createJob('hello.docx', 'docx', docx, { owner: OWNER });
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
  // Read back through the seal: the stale record and its document were
  // written in plaintext, which is how anything on disk before encryption
  // existed looks, and the repair writes the replacement sealed. Both halves
  // of that matter — turning encryption on must not strand what is already
  // there, and must not leave the replacement in the clear either.
  const raw = new Uint8Array(readFileSync(path.join(dir, 'job.json')));
  assert.notEqual(raw[0], 0x7b, 'the rewritten record is not an open brace, so it is not plain JSON');
  const rewritten = JSON.parse(openText(raw, id));
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
  const job = await createJob('grant narrative.docx', 'docx', withIssues, { owner: OWNER });
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
  const job = await createJob('memo.docx', 'docx', file, { owner: OWNER });
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
  const job = await createJob('named.docx', 'docx', docx, { owner: OWNER });
  assert.equal(job.reviewer, undefined);
  const named = (await setReviewer(job.id, '  J.\tSitton  '))!;
  assert.equal(named.reviewer, 'J. Sitton', 'normalised on the way in');
  assert.equal((await getJob(job.id))!.reviewer, 'J. Sitton', 'and written to the record');
});

test('a blank name is refused rather than stored as a nameless signature', async () => {
  const job = await createJob('blank.docx', 'docx', docx, { owner: OWNER });
  assert.equal(await setReviewer(job.id, '   '), null);
  assert.equal((await getJob(job.id))!.reviewer, undefined);
  assert.equal(await setReviewer('00000000-0000-4000-8000-00000000dead', 'Nobody'), null);
});

test('handing over does not rewrite the decisions the last reviewer made', async () => {
  // A second reviewer taking the job over is normal; re-attributing what the
  // first one already vouched for would be forging a signature.
  const job = await remediateJob((await createJob('handover.docx', 'docx', docx, { owner: OWNER })).id);
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


/**
 * Upload first, sign up second — the sequence the Chairman's decision to
 * keep the anonymous assessment makes the common one. Without this the
 * document somebody has just decided to pay for is stranded behind a cookie
 * that stopped deciding anything the moment they made an account.
 */
test('a browser\u2019s jobs move to the account that browser signs in to, and nobody else\u2019s do', async () => {
  const browser = 'c'.repeat(64);
  const someoneElse = 'd'.repeat(64);
  const account = '11111111-2222-4333-8444-999999999999';

  const mine = await createJob('mine.docx', 'docx', docx, { owner: { visitor: browser } });
  const theirs = await createJob('theirs.docx', 'docx', docx, { owner: { visitor: someoneElse } });
  const already = await createJob('already.docx', 'docx', docx, { owner: { account: OWNER.account } });

  assert.equal(await claimJobs(browser, account), 1);

  const claimed = await getJob(mine.id);
  assert.equal(claimed?.account, account);
  assert.equal(claimed?.visitor, undefined, 'the cookie no longer has a claim on it');

  assert.equal((await getJob(theirs.id))?.visitor, someoneElse, 'another browser keeps its own');
  assert.equal(
    (await getJob(already.id))?.account,
    OWNER.account,
    'a job already owned by an account is never reassigned by a cookie',
  );

  assert.equal(await claimJobs(browser, account), 0, 'claiming twice claims nothing the second time');
});


/**
 * The whole of the Chairman's retention decision, end to end: taking the
 * delivered file starts the clock and scrubs the record, and the sweep
 * removes the document while leaving the record that describes it.
 */
test('downloading the delivered file starts the clock and takes the document’s words out of the record', async () => {
  // A link whose text is “here”: the detector quotes the document, which is
  // the whole reason the record has to be scrubbed.
  const W3 = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const quoting = zip({
    '[Content_Types].xml': '<Types xmlns="ct"/>',
    '_rels/.rels': '<Relationships xmlns="r"/>',
    'word/document.xml': `<w:document ${W3}><w:body><w:p><w:hyperlink r:id="x" xmlns:r="r"><w:r><w:t>here</w:t></w:r></w:hyperlink></w:p></w:body></w:document>`,
  });
  const made = await createJob('quoted.docx', 'docx', quoting, { owner: OWNER });
  await remediateJob(made.id);

  const before = await getJob(made.id);
  assert.ok(before);
  assert.ok(JSON.stringify(before).includes('\u201c'), 'the detector really did quote the document');
  assert.equal(before.deleteAfter, undefined);

  const delivered = await markDelivered(made.id);
  assert.ok(delivered?.deleteAfter, 'the clock started');
  assert.ok(delivered?.scrubbedAt, 'and the record was scrubbed');
  assert.ok(!JSON.stringify(delivered).includes('\u201c'), 'nothing the document said is left');

  // The seven days run from when the customer first had what they came for,
  // so a second download does not extend them.
  const again = await markDelivered(made.id);
  assert.equal(again?.deleteAfter, delivered?.deleteAfter);
});

test('the sweep removes the document and keeps the record', async () => {
  const made = await createJob('sweep.docx', 'docx', docx, { owner: OWNER });
  await remediateJob(made.id);
  const delivered = await markDelivered(made.id);
  assert.ok(delivered?.deleteAfter);

  assert.deepEqual(await sweepExpired(Date.now()), [], 'nothing is due yet');
  assert.ok(await getJobFile(made.id, 'original'), 'and the file is still there');

  const after = Date.parse(delivered.deleteAfter) + 1;
  assert.ok((await sweepExpired(after)).includes(made.id));

  assert.equal(await getJobFile(made.id, 'original'), null, 'the document is gone');
  assert.equal(await getJobFile(made.id, 'remediated'), null, 'and so is the remediated copy');

  const record = await getJob(made.id);
  assert.ok(record, 'the record outlives the file');
  assert.ok(record.deletedAt);
  assert.ok(record.findings.length > 0, 'and still says what was wrong with it');

  assert.deepEqual(await sweepExpired(after + 1), [], 'sweeping twice sweeps nothing');
});

/**
 * Encryption is a property of the store, so the bytes on disk are the check
 * — not a round-trip through the same functions that wrote them.
 */
test('what is actually on disk is neither the document nor the record', async () => {
  const made = await createJob('secret.docx', 'docx', docx, { owner: OWNER });

  const onDisk = readFileSync(path.join(root, made.id, 'job.json'));
  assert.ok(!onDisk.toString('utf8').includes('secret.docx'), 'the filename is not readable on disk');
  assert.ok(!onDisk.toString('utf8').includes(made.id), 'nor is anything else from the record');
  assert.equal((await getJob(made.id))?.filename, 'secret.docx', 'and it still reads back');

  const document = readFileSync(path.join(root, made.id, 'original.docx'));
  assert.notEqual(document[0], 0x50, 'the stored bytes do not start PK, so they are not the archive');
});
