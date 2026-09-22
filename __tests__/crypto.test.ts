import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Set before the module is imported so the first call sees it. Node's test
// runner gives each file its own process, so this does not reach anything else.
process.env.STORAGE_KEY = randomBytes(32).toString('base64');

const { SealBrokenError, encrypting, open, openText, seal, sealText } = await import('../src/server/crypto');

const JOB = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-b666-555555555555';
const bytes = (s: string) => new TextEncoder().encode(s);

test('what is sealed comes back, and what is stored is not the document', () => {
  assert.ok(encrypting());
  const plain = bytes('PK\u0003\u0004 the customer’s Word document');
  const stored = seal(plain, JOB);

  assert.notDeepEqual(stored, plain);
  assert.ok(!new TextDecoder().decode(stored).includes('customer'), 'the plaintext is not in the ciphertext');
  assert.deepEqual(open(stored, JOB), plain);
});

test('two seals of the same bytes differ, because each carries its own nonce', () => {
  const plain = bytes('the same document twice');
  const a = seal(plain, JOB);
  const b = seal(plain, JOB);
  assert.notDeepEqual(a, b);
  assert.deepEqual(open(b, JOB), plain);
});

test('text seals and opens the same way, which is what the records use', () => {
  const record = JSON.stringify({ id: JOB, filename: 'report.docx' });
  const stored = sealText(record, JOB);
  assert.ok(!new TextDecoder().decode(stored).includes('report.docx'));
  assert.equal(openText(stored, JOB), record);
});

/**
 * GCM authenticates as well as encrypts, and here that matters more than
 * the confidentiality does in one specific case: a job record decides who
 * may open a document, and a record an attacker can silently edit is an
 * authorisation bug with extra steps.
 */
test('a single altered byte is refused rather than decrypted into something', () => {
  const stored = seal(bytes('a document'), JOB);
  for (const at of [1, 13, stored.length - 1]) {
    const tampered = Uint8Array.from(stored);
    tampered[at] = (tampered[at] ?? 0) ^ 0x01;
    assert.throws(() => open(tampered, JOB), SealBrokenError, `flipping byte ${at} should be caught`);
  }
});

/**
 * The associated data is the job id, so a sealed blob cannot be moved from
 * one job's directory into another's and still open. Without it, somebody
 * who can move files around can read a document that is not theirs.
 */
test('a blob cannot be moved into another job and still open', () => {
  const stored = seal(bytes('somebody else’s document'), JOB);
  assert.throws(() => open(stored, OTHER), SealBrokenError);
  assert.doesNotThrow(() => open(stored, JOB));
});

/**
 * Turning encryption on must not strand what is already on disk. A blob
 * written before a key existed has no version byte and opens as itself.
 */
test('bytes written before there was a key still open', () => {
  const plain = bytes('%PDF-1.7 written last week');
  assert.deepEqual(open(plain, JOB), plain);
});

test('a key of the wrong length is refused outright', () => {
  const good = process.env.STORAGE_KEY;
  process.env.STORAGE_KEY = randomBytes(16).toString('base64');
  assert.throws(() => seal(bytes('x'), JOB), /32 bytes/);
  process.env.STORAGE_KEY = good;
});

/**
 * Development has no key and writes plain bytes. That is deliberate, and
 * `encrypting()` is what the product uses to say so rather than implying
 * otherwise.
 */
test('with no key the store writes plain bytes and says that is what it did', () => {
  const good = process.env.STORAGE_KEY;
  delete process.env.STORAGE_KEY;

  assert.equal(encrypting(), false);
  const plain = bytes('unprotected in development');
  assert.deepEqual(seal(plain, JOB), plain);
  assert.deepEqual(open(plain, JOB), plain);

  process.env.STORAGE_KEY = good;
  assert.ok(encrypting());
});

/** In production there is no such fallback: it refuses to start the write. */
test('production with no key refuses rather than quietly writing plaintext', async () => {
  const { NoStorageKeyError } = await import('../src/server/crypto');
  // `NODE_ENV` is typed read-only by Next's ambient declarations, so it is
  // set through the object rather than the property.
  const env = process.env as Record<string, string | undefined>;
  const key = env.STORAGE_KEY;
  const was = env.NODE_ENV;
  delete env.STORAGE_KEY;
  env.NODE_ENV = 'production';

  assert.throws(() => seal(bytes('x'), JOB), NoStorageKeyError);

  env.NODE_ENV = was;
  env.STORAGE_KEY = key;
});
