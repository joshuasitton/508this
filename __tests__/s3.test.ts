import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { sign } from '../src/server/s3';

/**
 * A stand-in for S3: PUT, GET, DELETE and ListObjectsV2, path style, in
 * memory.
 *
 * It is not a mock. It parses the real request the client sends, stores the
 * real bytes, and answers with the real XML shape — so everything about the
 * client except AWS's own behaviour is exercised. What it cannot check is
 * whether AWS agrees, and that is what the signature vector below is for.
 */
const objects = new Map<string, Buffer>();
const seen: { method: string; url: string; auth: string; hashMatched: boolean }[] = [];
let server: Server;
let port = 0;

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk as Buffer));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(request.url ?? '/', `http://localhost:${port}`);
      // `/bucket/key…`
      const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));

      // The client must hash what it actually sends: this is the end-to-end
      // half of the signature check that the AWS vector cannot cover.
      const claimed = request.headers['x-amz-content-sha256'];
      const actual = createHash('sha256').update(body).digest('hex');
      seen.push({
        method: request.method ?? '',
        url: request.url ?? '',
        auth: String(request.headers.authorization ?? ''),
        hashMatched: claimed === actual,
      });

      if (request.method === 'PUT') {
        objects.set(key, body);
        response.writeHead(200).end();
        return;
      }
      if (request.method === 'DELETE') {
        objects.delete(key);
        response.writeHead(204).end();
        return;
      }
      if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const after = url.searchParams.get('continuation-token');
        const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const from = after ? all.indexOf(after) + 1 : 0;
        // One key per page, so the continuation path is exercised rather
        // than assumed: a list that fits in one response proves nothing
        // about the loop that fetches the second.
        const page = all.slice(from, from + 1);
        const truncated = from + 1 < all.length;
        response.writeHead(200, { 'content-type': 'application/xml' }).end(
          `<?xml version="1.0"?><ListBucketResult>${page
            .map((k) => `<Contents><Key>${k.replace(/&/g, '&amp;')}</Key></Contents>`)
            .join('')}<IsTruncated>${truncated}</IsTruncated>${
            truncated ? `<NextContinuationToken>${page[0]}</NextContinuationToken>` : ''
          }</ListBucketResult>`,
        );
        return;
      }
      if (request.method === 'GET') {
        const found = objects.get(key);
        if (!found) {
          response.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
          return;
        }
        response.writeHead(200).end(found);
        return;
      }
      response.writeHead(405).end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;

  process.env.S3_BUCKET = 'documents';
  process.env.S3_REGION = 'eu-west-2';
  process.env.S3_ACCESS_KEY_ID = 'AKIDEXAMPLE';
  process.env.S3_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
  process.env.S3_ENDPOINT = `http://127.0.0.1:${port}`;
});

after(() => server?.close());

/**
 * The reason to trust any of this file.
 *
 * Signature Version 4 written by hand is only defensible because AWS
 * publishes a worked example — a fixed key, a fixed timestamp, and the exact
 * signature the algorithm must produce. This reproduces `get-vanilla` from
 * that suite byte for byte. If this test fails, the client is wrong and no
 * amount of the fake server passing means anything.
 */
test('the signature matches AWS’s own published test vector', () => {
  const config = {
    bucket: 'unused',
    region: 'us-east-1',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  };
  const signed = sign(
    config,
    'service',
    'GET',
    'example.amazonaws.com',
    '/',
    {},
    new Uint8Array(),
    new Date('2015-08-30T12:36:00Z'),
  );

  assert.equal(
    signed.headers['Authorization'],
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
      'SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  );
});

/**
 * `encodeURIComponent` leaves `!'()*` alone and AWS does not, so a path
 * with one of those in it signs one way and is sent another. The failure is
 * a 403 whose message says nothing about why.
 */
test('paths are encoded the way AWS encodes them, not the way JavaScript does', () => {
  const config = {
    bucket: 'b',
    region: 'us-east-1',
    accessKeyId: 'A',
    secretAccessKey: 'S',
  };
  const signed = sign(config, 's3', 'GET', 'h', "/a b!c'd(e)f*g~h", {}, new Uint8Array(), new Date(0));
  assert.match(signed.url, /\/a%20b%21c%27d%28e%29f%2Ag~h$/);
  assert.ok(signed.url.includes('~h'), 'a tilde is unreserved and stays as itself');
});

test('a signature covers the bytes that are actually sent', async () => {
  const { s3Config, s3Put, s3Get } = await import('../src/server/s3');
  const config = s3Config()!;
  assert.ok(config, 'the environment is configured for the fake');

  seen.length = 0;
  await s3Put(config, 'proof/one', new TextEncoder().encode('sealed bytes'));
  assert.equal(seen.length, 1);
  assert.ok(seen[0]?.hashMatched, 'x-amz-content-sha256 is the hash of the real body');
  assert.match(seen[0]?.auth ?? '', /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-2\/s3\/aws4_request/);

  assert.deepEqual(await s3Get(config, 'proof/one'), new TextEncoder().encode('sealed bytes'));
});

test('a missing object is null rather than an error', async () => {
  const { s3Config, s3Get } = await import('../src/server/s3');
  assert.equal(await s3Get(s3Config()!, 'proof/never-written'), null);
});

test('listing follows the continuation token to the end', async () => {
  const { s3Config, s3List, s3Put } = await import('../src/server/s3');
  const config = s3Config()!;
  for (const name of ['a', 'b', 'c']) await s3Put(config, `many/${name}`, new TextEncoder().encode(name));

  // The fake returns one key per page, so three keys is three round trips.
  const keys = await s3List(config, 'many/');
  assert.deepEqual(keys.sort(), ['many/a', 'many/b', 'many/c']);
});

test('deleting is idempotent, on an object store as on a disk', async () => {
  const { s3Config, s3Delete, s3Get, s3Put } = await import('../src/server/s3');
  const config = s3Config()!;
  await s3Put(config, 'gone/soon', new TextEncoder().encode('x'));
  await s3Delete(config, 'gone/soon');
  assert.equal(await s3Get(config, 'gone/soon'), null);
  await assert.doesNotReject(s3Delete(config, 'gone/soon'));
});

/**
 * The whole point of the exercise: the job store, unchanged, running
 * against an object store instead of a disk. If encryption, retention and
 * the record survive the move, the move is done.
 */
test('the job store works against an object store, and what it stores is still sealed', async () => {
  process.env.STORAGE_KEY = createHash('sha256').update('a test key').digest('base64');

  const { storage } = await import('../src/server/blobs');
  assert.equal(storage(), 's3', 'the store is the object store, not the disk');

  const { zip } = await import('./helpers/zip');
  const { createJob, getJob, getJobFile, markDelivered, sweepExpired } = await import('../src/server/jobs');

  const W = 'xmlns:w="w"';
  const docx = zip({
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`,
  });

  const owner = { account: '11111111-2222-4333-8444-555555555555' } as const;
  const job = await createJob('remote.docx', 'docx', docx, { owner });
  assert.ok(job.findings.length > 0);

  // Read back through the store.
  const read = await getJob(job.id);
  assert.equal(read?.filename, 'remote.docx');
  assert.deepEqual((await getJobFile(job.id, 'original'))?.bytes, docx);

  // And read the raw object: what the bucket holds is the sealed form, not
  // the customer's archive and not their filename.
  const stored = objects.get(`${job.id}/job.json`);
  const document = objects.get(`${job.id}/original.docx`);
  assert.ok(stored && document);
  assert.ok(!stored.toString('utf8').includes('remote.docx'), 'the record in the bucket is unreadable');
  assert.notEqual(document[0], 0x50, 'and so is the document');

  // Retention works the same way: delivery starts the clock, the sweep
  // removes the objects, and the record outlives them.
  const delivered = await markDelivered(job.id);
  assert.ok(delivered?.deleteAfter);
  assert.deepEqual(await sweepExpired(Date.now()), [], 'nothing is due yet');

  const swept = await sweepExpired(Date.parse(delivered.deleteAfter) + 1);
  assert.ok(swept.includes(job.id));
  assert.equal(objects.has(`${job.id}/original.docx`), false, 'the document is gone from the bucket');
  assert.ok(objects.has(`${job.id}/job.json`), 'the record is not');
  assert.ok((await getJob(job.id))?.deletedAt);
});

/**
 * The audit log against the store it will actually run on.
 *
 * Its whole shape — one object per event, ordering in the key, nothing ever
 * rewritten — exists because of this store rather than the disk one, so
 * proving it on disk alone would be proving it in the wrong place.
 */
test('the audit log records and reads back through the object store', async () => {
  process.env.STORAGE_KEY = createHash('sha256').update('a test key').digest('base64');
  const { history, record } = await import('../src/server/audit');

  const account = '77777777-6666-4555-8444-333333333333';
  const job = '22222222-3333-4444-8555-666666666666';
  await record('account.created', account);
  await record('job.created', account, job);
  await record('job.downloaded', account, job);

  const log = await history(account);
  assert.equal(log.unreadable, 0);
  assert.deepEqual(
    log.events.map((event) => event.action),
    ['account.created', 'job.created', 'job.downloaded'],
  );

  // One object per event in the bucket, under the audit prefix, and what is
  // in them is the sealed form rather than the account id.
  const keys = [...objects.keys()].filter((key) => key.startsWith(`audit/${account}/`));
  assert.equal(keys.length, 3, 'three events, three objects');
  for (const key of keys) {
    assert.ok(!objects.get(key)?.toString('utf8').includes(account), 'the record in the bucket is unreadable');
  }
});

/**
 * The credentials against the object store, including the one path whose
 * shape exists because of it: `endAllSessions` reaching an account's
 * sessions through an index rather than by listing every session there is.
 */
test('accounts, sessions and reset tokens work through the object store', async () => {
  process.env.STORAGE_KEY = createHash('sha256').update('a test key').digest('base64');
  process.env.ACCOUNTS_DIR = `${process.env.STORE_DIR ?? '/tmp'}/remote-outbox`;

  const { createAccount, authenticate } = await import('../src/server/accounts');
  const { endAllSessions, resolveSession, startSession } = await import('../src/server/sessions');

  const made = await createAccount('remote@example.gov', 'correct horse battery staple');
  assert.ok(made.ok);
  const id = made.account.id;

  // The record is in the bucket, and it is the sealed form.
  const stored = objects.get(`accounts/${id}/account.json`);
  assert.ok(stored, 'the account is an object in the bucket');
  assert.ok(!stored.toString('utf8').includes('remote@example.gov'), 'and it is unreadable');

  assert.ok((await authenticate('remote@example.gov', 'correct horse battery staple')).ok);
  assert.equal((await authenticate('remote@example.gov', 'the wrong one entirely')).ok, false);

  const one = await startSession(id);
  const two = await startSession(id);
  assert.ok((await resolveSession(one)).ok);
  assert.equal([...objects.keys()].filter((key) => key.startsWith(`sessions/by-account/${id}/`)).length, 2);

  assert.equal(await endAllSessions(id), 2, 'found through the index, not by listing every session');
  assert.deepEqual(await resolveSession(one), { ok: false, reason: 'none' });
  assert.deepEqual(await resolveSession(two), { ok: false, reason: 'none' });
  assert.equal([...objects.keys()].filter((key) => key.startsWith(`sessions/by-account/${id}/`)).length, 0);
});

test('a key that is not plain segments is refused before it becomes a request', async () => {
  const { BadKeyError, getBlob, putBlob } = await import('../src/server/blobs');
  for (const bad of ['../escape', 'a//b', '/leading', 'trailing/', 'has space', '', 'a/../b']) {
    await assert.rejects(putBlob(bad, new Uint8Array()), BadKeyError, `should refuse: ${bad || '(empty)'}`);
    await assert.rejects(getBlob(bad), BadKeyError);
  }
});
