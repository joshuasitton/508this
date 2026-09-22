import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The audit log against the store it actually runs on.
 *
 * `accounts.test.ts` covers what gets recorded. This covers what the move
 * to an object store changed: one object per event instead of a line
 * appended to a file, ordering carried by the key rather than by the
 * order of writes, and a record that cannot be moved without ceasing to
 * open. The last of those is the only tamper-evidence the file it replaces
 * ever had a hope of, and it is worth a test each way.
 */
const STORE = await mkdtemp(path.join(tmpdir(), '508this-audit-'));
process.env.STORE_DIR = STORE;
// Unlike the account tests, this one is encrypted: the binding between a
// record and its key is a property of the seal, so there has to be one.
process.env.STORAGE_KEY = createHash('sha256').update('an audit test key').digest('base64');

const { history, record } = await import('../src/server/audit');

const ACCOUNT = '11111111-2222-4333-8444-555555555555';

const dirFor = (account: string) => path.join(STORE, 'audit', account);
const objectsFor = async (account: string) => (await readdir(dirFor(account))).sort();

test('every event is its own object, and nothing is ever rewritten', async () => {
  const account = randomUUID();
  await record('account.created', account);
  const afterOne = await objectsFor(account);

  await record('sign-in.succeeded', account);
  const afterTwo = await objectsFor(account);

  assert.equal(afterOne.length, 1);
  assert.equal(afterTwo.length, 2);
  // The object written first is still there, byte for byte: the second
  // write added a key, it did not read-modify-write the log.
  assert.equal(afterTwo[0], afterOne[0]);
  assert.ok(afterOne[0]?.endsWith('.json'));
});

/**
 * A file being appended to gave ordering away free. A bucket does not, and
 * a timestamp alone is not enough — four events inside one millisecond is
 * ordinary, and it is what the counter in the key is for.
 */
test('records written in the same millisecond come back in the order they were written', async () => {
  const account = randomUUID();
  const subjects = Array.from({ length: 50 }, () => randomUUID());
  await Promise.all(subjects.map((subject) => record('job.opened', account, subject)));

  // Check the thing rather than a proxy for it: on a fast enough machine
  // fifty writes could land in fifty different milliseconds, and then this
  // test would pass without the counter ever mattering.
  const names = await objectsFor(account);
  const milliseconds = new Set(names.map((name) => name.split('-')[0]));
  assert.ok(milliseconds.size < names.length, 'some of these records really did share a millisecond');

  const log = await history(account);
  assert.equal(log.unreadable, 0);
  assert.deepEqual(
    log.events.map((event) => event.subject),
    subjects,
    'the key sorts into the order the records were written',
  );
});

test('what the store holds is sealed, and reads back as itself', async () => {
  const account = randomUUID();
  const job = randomUUID();
  await record('job.downloaded', account, job);

  const [name] = await objectsFor(account);
  const raw = await readFile(path.join(dirFor(account), name!), 'utf8');
  assert.ok(!raw.includes(account), 'the record in the store is unreadable');
  assert.throws(() => JSON.parse(raw), 'and is not JSON either');

  const log = await history(account);
  assert.deepEqual(log.events, [{ at: log.events[0]!.at, account, action: 'job.downloaded', subject: job }]);
});

/**
 * The property the old file could not have. Anybody who could reach
 * `audit.log` could edit a line in it; a sealed record bound to its own key
 * cannot be re-filed under another account, and cannot be renamed to a
 * different time to make it look like it happened earlier.
 */
test('a record moved to another account, or back-dated, stops opening', async () => {
  const mine = randomUUID();
  const yours = randomUUID();
  await record('sign-in.succeeded', mine);
  await record('sign-in.succeeded', yours);

  const [name] = await objectsFor(mine);
  const [theirs] = await objectsFor(yours);

  // Re-filed under somebody else's prefix.
  await writeFile(path.join(dirFor(yours), name!), await readFile(path.join(dirFor(mine), name!)));
  const moved = await history(yours);
  assert.equal(moved.unreadable, 1, 'the moved record is counted');
  assert.deepEqual(
    moved.events.map((event) => event.account),
    [yours],
    'and it is not read as the other account’s history',
  );

  // Back-dated in place.
  const earlier = theirs!.replace(/^\d{8}T/, '20200101T');
  await rename(path.join(dirFor(yours), theirs!), path.join(dirFor(yours), earlier));
  const dated = await history(yours);
  assert.equal(dated.events.length, 0, 'a renamed record no longer opens');
  assert.equal(dated.unreadable, 2);
});

/**
 * One torn write must not cost the history either side of it. That was true
 * of a line in a file and it has to stay true of an object in a bucket.
 */
test('a record that will not open costs itself and nothing else', async () => {
  const account = randomUUID();
  await record('account.created', account);
  await record('sign-in.failed', account);
  await record('sign-out', account);

  const names = await objectsFor(account);
  await writeFile(path.join(dirFor(account), names[1]!), 'half a rec');

  const log = await history(account);
  assert.deepEqual(
    log.events.map((event) => event.action),
    ['account.created', 'sign-out'],
  );
  assert.equal(log.unreadable, 1, 'the log says something is missing rather than quietly shrinking');
});

/**
 * Documents are deleted seven days after a customer downloads them. Audit
 * records are evidence and are not. Both now live in one store, so the
 * sweep and the log share a root — and the thing that keeps them apart is
 * that the sweep only ever looks at keys whose first segment is a job id.
 *
 * If that ever stops being true, a retention policy becomes an evidence
 * shredder, and it would do it quietly. Hence a test rather than a comment.
 */
test('the retention sweep deletes documents and cannot reach the audit log', async () => {
  const { zip } = await import('./helpers/zip');
  const { createJob, markDelivered, sweepExpired } = await import('../src/server/jobs');

  await record('account.created', ACCOUNT);
  const before = await objectsFor(ACCOUNT);
  assert.equal(before.length, 1);

  const W = 'xmlns:w="w"';
  const docx = zip({
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`,
  });
  const job = await createJob('swept.docx', 'docx', docx, { owner: { account: ACCOUNT } });
  const delivered = await markDelivered(job.id);
  assert.ok(delivered?.deleteAfter);

  const swept = await sweepExpired(Date.parse(delivered.deleteAfter) + 1);
  assert.deepEqual(swept, [job.id], 'the sweep saw one job and nothing else');

  assert.deepEqual(await objectsFor(ACCOUNT), before, 'the audit records are untouched');
  const log = await history(ACCOUNT);
  assert.equal(log.unreadable, 0);
  assert.equal(log.events.length, 1);
});
