import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The one route in the service that deletes customer documents.
 *
 * `sweepExpired` was written, tested and then called by nothing, which made
 * "documents are deleted seven days after you download them" true of the
 * code and false of the service. A cron calls this now — so what it accepts
 * matters more than what it does.
 */
const STORE = await mkdtemp(path.join(tmpdir(), '508this-sweep-'));
process.env.STORE_DIR = STORE;
process.env.STORAGE_KEY = createHash('sha256').update('a sweep test key').digest('base64');

const ask = async (authorization?: string) => {
  const { GET } = await import('../src/app/api/sweep/route');
  return GET(new Request('http://x/api/sweep', authorization ? { headers: { authorization } } : undefined));
};

const SECRET = 'a-real-cron-secret';

test('with no secret configured the route does not exist', async () => {
  delete process.env.CRON_SECRET;
  assert.equal((await ask()).status, 404);
  assert.equal((await ask(`Bearer ${SECRET}`)).status, 404, 'not even for the right secret');
});

/**
 * 404 rather than 401 for every refusal, and the same 404 whether the
 * secret is wrong or the wrong length: an endpoint that deletes documents
 * should not confirm it is there.
 */
test('every wrong caller gets the same answer', async () => {
  process.env.CRON_SECRET = SECRET;
  for (const offered of [undefined, '', 'Bearer ', 'Bearer x', `Bearer ${SECRET}x`, `bearer ${SECRET}`, SECRET]) {
    assert.equal((await ask(offered)).status, 404, `should refuse: ${JSON.stringify(offered)}`);
  }

  // Surrounding whitespace is not a different secret: HTTP defines a header
  // value as trimmed, and the Headers API strips it before anything here
  // sees it. Asserting that it is refused would be asserting a bug.
  assert.equal((await ask(`Bearer ${SECRET} `)).status, 200);
});

test('the cron sweeps what is due, and answers with a count rather than the ids', async () => {
  process.env.CRON_SECRET = SECRET;

  const { zip } = await import('./helpers/zip');
  const { createJob, getJob, markDelivered } = await import('../src/server/jobs');

  const W = 'xmlns:w="w"';
  const docx = zip({
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`,
  });
  const owner = { account: '11111111-2222-4333-8444-555555555555' } as const;
  const job = await createJob('due.docx', 'docx', docx, { owner });

  // Nothing is due until it has been delivered: the clock starts at
  // download, not at upload.
  const before = await ask(`Bearer ${SECRET}`);
  assert.equal(before.status, 200);
  assert.deepEqual(await before.json(), { swept: 0 });

  // Deliver it, and put the deadline in the past the way seven days of
  // waiting would.
  const delivered = await markDelivered(job.id);
  assert.ok(delivered?.deleteAfter);
  const { openText, sealText } = await import('../src/server/crypto');
  const { getBlob, putBlob } = await import('../src/server/blobs');
  // A job record's associated data is the job id, not the key it sits
  // under — `jobs.ts` seals it that way so a record cannot be moved between
  // jobs. Re-sealing with anything else produces a record that will not open.
  const key = `${job.id}/job.json`;
  const record = JSON.parse(openText((await getBlob(key))!, job.id)) as { deleteAfter: string };
  record.deleteAfter = new Date(Date.now() - 1000).toISOString();
  await putBlob(key, sealText(JSON.stringify(record), job.id));

  const swept = await ask(`Bearer ${SECRET}`);
  assert.equal(swept.status, 200);
  const body = (await swept.json()) as { swept: number };
  assert.equal(body.swept, 1);

  // A job id names a customer's document, so it must not be in a body that
  // something is going to log.
  assert.equal(JSON.stringify(body).includes(job.id), false, 'the count is all that comes back');
  assert.deepEqual(Object.keys(body), ['swept']);

  // And the sweep did the thing: document gone, record kept.
  assert.equal(await getBlob(`${job.id}/original.docx`), null);
  assert.ok((await getJob(job.id))?.deletedAt);

  assert.equal(swept.headers.get('cache-control'), 'no-store');
});
