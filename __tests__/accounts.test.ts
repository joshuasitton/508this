import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LOCK_AFTER, LOCK_MS } from '../src/domain/session';
import type { AuditEvent } from '../src/domain/audit';

// The store reads its root at module load, so the directory has to exist and
// be named before anything imports it.
const ROOT = await mkdtemp(path.join(tmpdir(), '508this-accounts-'));
process.env.ACCOUNTS_DIR = ROOT;

const { authenticate, createAccount, disableAccount, getAccount } = await import('../src/server/accounts');
const { endSession, resolveSession, startSession, touchSession } = await import('../src/server/sessions');
const { history } = await import('../src/server/audit');
const { hashPassword, needsRehash, verifyPassword } = await import('../src/server/passwords');
const { consume, inspect, request, tellTaken } = await import('../src/server/resets');

const PASSPHRASE = 'correct horse battery staple';

async function account(email: string) {
  const made = await createAccount(email, PASSPHRASE);
  assert.ok(made.ok, `creating ${email} should work`);
  return made.account;
}

test('a passphrase round-trips through scrypt, and a wrong one does not', async () => {
  const stored = await hashPassword(PASSPHRASE);
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$/);
  assert.ok(!stored.includes(PASSPHRASE), 'the passphrase itself is never in the stored string');
  assert.equal(await verifyPassword(PASSPHRASE, stored), true);
  assert.equal(await verifyPassword('correct horse battery stapler', stored), false);
  assert.equal(needsRehash(stored), false);
});

test('two hashes of the same passphrase differ, because each carries its own salt', async () => {
  const [a, b] = await Promise.all([hashPassword(PASSPHRASE), hashPassword(PASSPHRASE)]);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(PASSPHRASE, b), true);
});

/**
 * A corrupt or tampered record must fail the same way a wrong passphrase
 * does — closed, and without throwing into a sign-in handler. The absurd
 * cost parameter is the interesting one: left unchecked, a single edited
 * file would let one sign-in attempt try to allocate its way through the
 * machine.
 */
test('a malformed or tampered stored hash is refused rather than trusted or thrown', async () => {
  for (const bad of [
    '',
    'not a hash',
    'scrypt$x$8$1$AAAA$BBBB',
    'argon2$32768$8$1$AAAA$BBBB',
    'scrypt$999999999$8$1$AAAA$BBBB',
    'scrypt$32768$8$1$AAAA$',
  ]) {
    assert.equal(await verifyPassword(PASSPHRASE, bad), false, `should refuse: ${bad || '(empty)'}`);
  }
});

test('an account is created, found by its address, and never stores the passphrase', async () => {
  const made = await account('Josh@Example.GOV');
  assert.equal(made.email, 'josh@example.gov', 'the address is normalised before it is stored');
  assert.deepEqual(Object.keys(made).sort(), ['createdAt', 'email', 'id']);
  assert.equal((made as { passwordHash?: string }).passwordHash, undefined, 'the hash never leaves the store');

  const raw = await readFile(path.join(ROOT, made.id, 'account.json'), 'utf8');
  assert.ok(!raw.includes(PASSPHRASE));

  const found = await getAccount(made.id);
  assert.equal(found?.email, 'josh@example.gov');
});

/**
 * A directory listing gets backed up, synced and screenshotted. A customer
 * list of federal contractors is worth something to somebody, so the index
 * is keyed by a digest and not by the address.
 */
test('the email index does not have the address in its file name', async () => {
  await account('contracting.officer@agency.example.gov');
  const names = await readdir(path.join(ROOT, 'by-email'));
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.match(name, /^[0-9a-f]{64}\.json$/);
    assert.ok(!name.includes('agency'));
  }
});

test('the same address cannot be taken twice', async () => {
  await account('taken@example.gov');
  const again = await createAccount('TAKEN@example.gov', 'a different passphrase entirely');
  assert.equal(again.ok, false);
  assert.ok(!again.ok && again.reason === 'taken');
});

test('a bad address or a weak passphrase is refused before anything is written', async () => {
  assert.deepEqual(await createAccount('not-an-address', PASSPHRASE), { ok: false, reason: 'bad-email' });
  assert.deepEqual(await createAccount('short@example.gov', 'short'), { ok: false, reason: 'bad-password' });
  assert.equal(await createAccount('short@example.gov', PASSPHRASE).then((r) => r.ok), true);
});

test('sign-in works, and the wrong passphrase does not', async () => {
  const made = await account('signin@example.gov');
  const good = await authenticate('SignIn@Example.gov', PASSPHRASE);
  assert.ok(good.ok);
  assert.equal(good.account.id, made.id);

  const bad = await authenticate('signin@example.gov', 'correct horse battery stapler');
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok && bad.reason === 'no');
});

/**
 * An address with no account here answers exactly as an address with one
 * does. Anything else lets a stranger with a sign-in form enumerate who the
 * customers are, which the single honest sentence in `SIGN_IN_FAILED`
 * exists to prevent and which a different return value would undo.
 */
test('an unknown address and a wrong passphrase are the same answer', async () => {
  await account('known@example.gov');
  const unknown = await authenticate('nobody@example.gov', PASSPHRASE);
  const wrong = await authenticate('known@example.gov', 'not the passphrase at all');
  assert.deepEqual(unknown, { ok: false, reason: 'no' });
  assert.deepEqual(wrong, { ok: false, reason: 'no' });
});

test('a disabled account stops signing in, and is still there to be named in the log', async () => {
  const made = await account('leaver@example.gov');
  assert.ok((await authenticate('leaver@example.gov', PASSPHRASE)).ok);

  await disableAccount(made.id);
  const after = await authenticate('leaver@example.gov', PASSPHRASE);
  assert.equal(after.ok, false);
  assert.ok(!after.ok && after.reason === 'no', 'told apart from a wrong passphrase only in the log');
  assert.ok((await getAccount(made.id))?.disabledAt, 'the account still resolves');
});

test('five wrong passphrases lock the account, and the lock lets go', async () => {
  const made = await account('locked@example.gov');
  const now = Date.now();
  for (let i = 0; i < LOCK_AFTER; i++) {
    const tried = await authenticate('locked@example.gov', 'wrong passphrase here', now);
    assert.ok(!tried.ok && tried.reason === 'no', `attempt ${i + 1} is an ordinary failure`);
  }

  // The right passphrase, while locked, is still refused — and told apart,
  // so somebody who mistyped their own is not left guessing for a quarter
  // of an hour.
  const during = await authenticate('locked@example.gov', PASSPHRASE, now);
  assert.equal(during.ok, false);
  assert.ok(!during.ok && during.reason === 'locked');

  const after = await authenticate('locked@example.gov', PASSPHRASE, now + LOCK_MS);
  assert.ok(after.ok);
  assert.equal(after.account.id, made.id);

  // A success clears the count: the next mistake starts from one.
  const next = await authenticate('locked@example.gov', 'wrong again', now + LOCK_MS);
  assert.ok(!next.ok && next.reason === 'no');
});

test('a session resolves while it lives, and the token is never on disk', async () => {
  const made = await account('session@example.gov');
  const token = await startSession(made.id);

  const resolved = await resolveSession(token);
  assert.ok(resolved.ok);
  assert.equal(resolved.session.account, made.id);

  const files = await readdir(path.join(ROOT, 'sessions'));
  for (const name of files) {
    assert.match(name, /^[0-9a-f]{64}\.json$/, 'the file is named by the hash, not the token');
    const raw = await readFile(path.join(ROOT, 'sessions', name), 'utf8');
    assert.ok(!raw.includes(token), 'the token itself is never stored');
  }

  assert.deepEqual(await resolveSession(undefined), { ok: false, reason: 'none' });
  assert.deepEqual(await resolveSession('a token that was never issued'), { ok: false, reason: 'none' });
});

test('an idle session ends, and activity holds it open until the day does', async () => {
  const made = await account('idle@example.gov');
  const token = await startSession(made.id);
  const now = Date.now();

  const idle = await resolveSession(token, now + 31 * 60 * 1000);
  assert.equal(idle.ok, false);
  assert.ok(!idle.ok && idle.reason === 'idle');
  assert.deepEqual(await resolveSession(token), { ok: false, reason: 'none' }, 'and is deleted as it is read');

  const second = await startSession(made.id);
  await touchSession(second, now + 25 * 60 * 1000);
  assert.ok((await resolveSession(second, now + 30 * 60 * 1000)).ok, 'activity moved the idle clock');

  const old = await resolveSession(second, now + 9 * 60 * 60 * 1000);
  assert.ok(!old.ok && old.reason === 'expired', 'the eight-hour ceiling is not moved by activity');
});

test('signing out ends the session, and signing out twice is still signing out', async () => {
  const made = await account('out@example.gov');
  const token = await startSession(made.id);
  await endSession(token);
  assert.deepEqual(await resolveSession(token), { ok: false, reason: 'none' });
  await assert.doesNotReject(endSession(token));
  await assert.doesNotReject(endSession(undefined));
});

/**
 * The log has to hold both halves: what an account did, and the attempts
 * that never became an account at all. The second is where an investigation
 * starts, and a per-account layout has nowhere to put it.
 */
test('the audit log records the account that acted and the attempts that named nobody', async () => {
  const made = await account('audited@example.gov');
  await authenticate('audited@example.gov', 'wrong passphrase here');
  await authenticate('audited@example.gov', PASSPHRASE);
  const token = await startSession(made.id);
  await endSession(token);

  const mine = await history(made.id);
  assert.deepEqual(
    mine.map((e) => e.action),
    ['account.created', 'sign-in.failed', 'sign-in.succeeded', 'sign-out'],
  );
  for (const event of mine) assert.equal(event.account, made.id);

  await authenticate('never-existed@example.gov', PASSPHRASE);
  const house = await history(null);
  assert.ok(house.some((e: AuditEvent) => e.action === 'sign-in.failed' && e.account === null));
});

/**
 * The oldest rule in this repository, checked against the newest file that
 * writes to disk: nothing about a document's contents, and now nothing
 * about a credential either, ends up in a log.
 */
test('no passphrase and no email address ever reaches the audit log', async () => {
  const made = await account('secrets@example.gov');
  await authenticate('secrets@example.gov', PASSPHRASE);
  await authenticate('secrets@example.gov', 'a wrong one');

  const raw = await readFile(path.join(ROOT, made.id, 'audit.log'), 'utf8');
  assert.ok(!raw.includes(PASSPHRASE));
  assert.ok(!raw.includes('a wrong one'));
  assert.ok(!raw.includes('secrets@example.gov'));
  assert.ok(raw.includes(made.id), 'the account is named by its id, which is the point');
});


const ORIGIN = 'https://508this.example';

/** The link out of the newest letter in the development outbox. */
async function lastLink(): Promise<string | null> {
  const dir = path.join(ROOT, 'outbox');
  const names = (await readdir(dir)).sort();
  const last = names.at(-1);
  if (!last) return null;
  const text = await readFile(path.join(dir, last), 'utf8');
  return /https:\/\/\S+/.exec(text)?.[0] ?? null;
}

test('a reset link arrives, works once, and signs every session out', async () => {
  const made = await account('reset@example.gov');
  const staySignedIn = await startSession(made.id);
  assert.ok((await resolveSession(staySignedIn)).ok);

  await request('Reset@Example.GOV', ORIGIN);
  const link = await lastLink();
  assert.ok(link, 'a letter was written');
  const token = new URL(link).searchParams.get('token');
  assert.ok(token && token.length > 30, 'the link carries a real token');
  assert.equal(await inspect(token), 'good');

  const done = await consume(token, 'a brand new passphrase');
  assert.ok(done.ok);
  assert.equal(done.account, made.id);

  // The reason people reset a passphrase is that they think somebody has
  // it. Leaving that somebody signed in would make the reset theatre.
  assert.deepEqual(await resolveSession(staySignedIn), { ok: false, reason: 'none' });

  assert.ok((await authenticate('reset@example.gov', 'a brand new passphrase')).ok);
  assert.equal((await authenticate('reset@example.gov', PASSPHRASE)).ok, false, 'the old one is gone');

  // Once.
  assert.deepEqual(await consume(token, 'yet another passphrase'), { ok: false, reason: 'used' });
});

test('the token is never stored, only its digest', async () => {
  const made = await account('digest@example.gov');
  await request('digest@example.gov', ORIGIN);
  const token = new URL((await lastLink())!).searchParams.get('token')!;

  for (const name of await readdir(path.join(ROOT, 'resets'))) {
    assert.match(name, /^[0-9a-f]{64}\.json$/);
    const raw = await readFile(path.join(ROOT, 'resets', name), 'utf8');
    assert.ok(!raw.includes(token), 'the token itself is never on disk');
  }
  assert.ok(made.id.length > 0);
});

/**
 * A weak passphrase burns the link. That is inconvenient and it is the
 * right way round: the alternative is a live link somebody can keep trying
 * passphrases against.
 */
test('a refused passphrase still spends the link', async () => {
  await account('weak@example.gov');
  await request('weak@example.gov', ORIGIN);
  const token = new URL((await lastLink())!).searchParams.get('token')!;

  assert.deepEqual(await consume(token, 'short'), { ok: false, reason: 'bad-password' });
  assert.equal(await inspect(token), 'used');
  assert.deepEqual(await consume(token, 'a perfectly fine passphrase'), { ok: false, reason: 'used' });
});

test('an unknown token is unknown, and asking for one is the same for everybody', async () => {
  assert.equal(await inspect('a token nobody ever issued'), 'unknown');
  assert.deepEqual(await consume('a token nobody ever issued', PASSPHRASE), { ok: false, reason: 'unknown' });

  // An address with no account still gets a letter, and it carries no link.
  await request('nobody-here@example.gov', ORIGIN);
  const dir = path.join(ROOT, 'outbox');
  const last = (await readdir(dir)).sort().at(-1)!;
  const text = await readFile(path.join(dir, last), 'utf8');
  assert.match(text, /no account here/i);
  assert.ok(!text.includes('/account/reset'), 'there is nothing to reset, so there is no link');
});

test('the person who owns a taken address is told on the address', async () => {
  const made = await account('taken-told@example.gov');
  await tellTaken('Taken-Told@Example.gov', ORIGIN);

  const dir = path.join(ROOT, 'outbox');
  const last = (await readdir(dir)).sort().at(-1)!;
  const text = await readFile(path.join(dir, last), 'utf8');
  assert.match(text, /already has an account/i);
  assert.match(text, /Nothing changed/);

  const token = new URL(/https:\/\/\S+/.exec(text)![0]).searchParams.get('token')!;
  assert.equal(await inspect(token), 'good', 'and it carries a way back in');
  assert.ok(made.id.length > 0);
});

test('no passphrase and no reset token reaches the audit log', async () => {
  const made = await account('quiet@example.gov');
  await request('quiet@example.gov', ORIGIN);
  const token = new URL((await lastLink())!).searchParams.get('token')!;
  await consume(token, 'a replacement passphrase');

  const raw = await readFile(path.join(ROOT, made.id, 'audit.log'), 'utf8');
  assert.ok(!raw.includes(token), 'a reset token is a credential and never appears in a log');
  assert.ok(!raw.includes('a replacement passphrase'));
  assert.ok(!raw.includes('quiet@example.gov'));
  assert.match(raw, /reset\.requested/);
  assert.match(raw, /reset\.completed/);
});
