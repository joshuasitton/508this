import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Accounts, sessions and reset tokens against the store they now live on.
 *
 * `accounts.test.ts` covers what the identity policy does, and does it
 * deliberately without a key so that its "never stored" checks read real
 * plaintext. This covers what moving the credentials onto the store
 * changed: they are sealed, each record is bound to the key it sits under,
 * and `endAllSessions` reaches one account's sessions through an index
 * rather than by reading every session in the service.
 *
 * The binding is the part worth the most. A session record is what the
 * server accepts *instead of* a passphrase, so a record that could be
 * re-filed under a digest an attacker holds is a way to sign in as somebody
 * else without ever touching a credential.
 */
const STORE = await mkdtemp(path.join(tmpdir(), '508this-credentials-'));
const OUTBOX = await mkdtemp(path.join(tmpdir(), '508this-outbox-'));
process.env.STORE_DIR = STORE;
process.env.ACCOUNTS_DIR = OUTBOX;
process.env.STORAGE_KEY = createHash('sha256').update('a credentials test key').digest('base64');

const { authenticate, createAccount, getAccount } = await import('../src/server/accounts');
const { endAllSessions, endSession, resolveSession, startSession } = await import('../src/server/sessions');
const { consume, inspect, request } = await import('../src/server/resets');

const PASSPHRASE = 'correct horse battery staple';
const digestOf = (token: string) => createHash('sha256').update(token).digest('hex');

async function account(email: string): Promise<string> {
  const made = await createAccount(email, PASSPHRASE);
  assert.ok(made.ok, `creating ${email} should work`);
  return made.account.id;
}

/** The newest link in the development outbox, which sits under ACCOUNTS_DIR. */
async function lastLink(): Promise<string> {
  const dir = path.join(OUTBOX, 'outbox');
  const names = (await readdir(dir)).sort();
  const text = await readFile(path.join(dir, names.at(-1)!), 'utf8');
  return /https:\/\/\S+/.exec(text)![0];
}

test('an account record in the store is sealed, and still reads back', async () => {
  const id = await account('sealed@example.gov');

  const raw = await readFile(path.join(STORE, 'accounts', id, 'account.json'), 'utf8');
  assert.ok(!raw.includes('sealed@example.gov'), 'the address is not readable in the store');
  assert.throws(() => JSON.parse(raw), 'and the record is not JSON');

  assert.equal((await getAccount(id))?.email, 'sealed@example.gov');
});

/**
 * The property local disk could not have. Anybody who could write to the
 * store could put one account's record where another's belongs; sealing
 * each record to its own key means the copy simply does not open.
 */
test('an account record copied onto another account’s key stops opening', async () => {
  const mine = await account('mine@example.gov');
  const yours = await account('yours@example.gov');

  const record = await readFile(path.join(STORE, 'accounts', mine, 'account.json'));
  await writeFile(path.join(STORE, 'accounts', yours, 'account.json'), record);

  await assert.rejects(getAccount(yours), 'the moved record is refused, not read as the other account');
});

/**
 * The same, for the thing the server accepts instead of a passphrase.
 */
test('a session record re-filed under another token’s digest stops opening', async () => {
  const id = await account('session@example.gov');
  const real = await startSession(id);
  const other = 'a token nobody ever issued';

  const record = await readFile(path.join(STORE, 'sessions', `${digestOf(real)}.json`));
  await writeFile(path.join(STORE, 'sessions', `${digestOf(other)}.json`), record);

  assert.deepEqual(await resolveSession(other), { ok: false, reason: 'none' }, 'the copy is not a session');
  assert.ok((await resolveSession(real)).ok, 'and the original still is');
});

test('a reset record moved onto another token’s key stops opening', async () => {
  await account('reset-move@example.gov');
  await request('reset-move@example.gov', 'https://508this.example');
  const real = new URL(await lastLink()).searchParams.get('token')!;
  const other = 'another token entirely';

  const record = await readFile(path.join(STORE, 'resets', `${digestOf(real)}.json`));
  await writeFile(path.join(STORE, 'resets', `${digestOf(other)}.json`), record);

  assert.equal(await inspect(other), 'unknown', 'the copy resets nothing');
  assert.equal(await inspect(real), 'good');
  assert.deepEqual(await consume(other, 'a different passphrase entirely'), { ok: false, reason: 'unknown' });
});

/**
 * `endAllSessions` used to read every session record in the service to find
 * one account's. Against a bucket that is a listing of everything plus a
 * fetch each, on the path that runs whenever somebody resets a passphrase.
 * The index is what makes it one prefix — and it has to be exactly one
 * account's prefix, or a reset signs strangers out.
 */
test('ending an account’s sessions reaches all of its own and none of anybody else’s', async () => {
  const mine = await account('ends@example.gov');
  const yours = await account('stays@example.gov');

  const one = await startSession(mine);
  const two = await startSession(mine);
  const theirs = await startSession(yours);

  assert.equal(await endAllSessions(mine), 2, 'both of this account’s sessions, found through the index');

  assert.deepEqual(await resolveSession(one), { ok: false, reason: 'none' });
  assert.deepEqual(await resolveSession(two), { ok: false, reason: 'none' });
  assert.ok((await resolveSession(theirs)).ok, 'the other account is still signed in');

  assert.equal(await endAllSessions(mine), 0, 'and ending them again ends nothing');
});

/**
 * An index that is only ever added to is a list of every session the
 * service has issued, kept forever. Every path that ends a session has to
 * take the entry with it.
 */
test('the index does not outlive the sessions it points at', async () => {
  const id = await account('tidy@example.gov');
  const entries = async () => (await readdir(path.join(STORE, 'sessions', 'by-account', id))).length;

  const signOut = await startSession(id);
  const expires = await startSession(id);
  assert.equal(await entries(), 2);

  await endSession(signOut);
  assert.equal(await entries(), 1, 'signing out takes the entry with it');

  // Far enough ahead that the session is past its lifetime, and read, which
  // is where an expired session is deleted.
  const later = Date.now() + 9 * 60 * 60 * 1000;
  assert.equal((await resolveSession(expires, later)).ok, false);
  assert.equal(await entries(), 0, 'and so does expiring');
});

/** A completed reset ends every session, which is the whole point of it. */
test('a completed reset signs every session out and the new passphrase works', async () => {
  const id = await account('cycled@example.gov');
  const before = await startSession(id);
  await request('cycled@example.gov', 'https://508this.example');
  const token = new URL(await lastLink()).searchParams.get('token')!;

  const spent = await consume(token, 'a whole new passphrase here');
  assert.deepEqual(spent, { ok: true, account: id });

  assert.deepEqual(await resolveSession(before), { ok: false, reason: 'none' });
  assert.equal((await readdir(path.join(STORE, 'sessions', 'by-account', id))).length, 0);
  assert.ok((await authenticate('cycled@example.gov', 'a whole new passphrase here')).ok);
  assert.equal((await authenticate('cycled@example.gov', PASSPHRASE)).ok, false);
});

/**
 * Documents are swept seven days after download. Credentials are not
 * documents, and the sweep sees only keys whose first segment is a job id.
 * `audit/` has this test already; `accounts/`, `sessions/` and `resets/`
 * earn the same one, because the failure is silent either way.
 */
test('the retention sweep cannot reach the credentials', async () => {
  const { zip } = await import('./helpers/zip');
  const { createJob, markDelivered, sweepExpired } = await import('../src/server/jobs');

  const id = await account('survives@example.gov');
  await startSession(id);
  await request('survives@example.gov', 'https://508this.example');

  const before = await readdir(STORE);
  const W = 'xmlns:w="w"';
  const docx = zip({
    'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`,
  });
  const job = await createJob('swept.docx', 'docx', docx, { owner: { account: id } });
  const delivered = await markDelivered(job.id);

  const swept = await sweepExpired(Date.parse(delivered!.deleteAfter!) + 1);
  assert.deepEqual(swept, [job.id], 'the sweep saw one job and nothing else');

  for (const prefix of ['accounts', 'sessions', 'resets']) {
    assert.ok(before.includes(prefix), `${prefix} was there to begin with`);
    assert.ok((await readdir(path.join(STORE, prefix))).length > 0, `${prefix} is untouched`);
  }
  assert.ok((await getAccount(id))?.email, 'and the account still reads');
});
