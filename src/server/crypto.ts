/**
 * Encryption at rest, with `node:crypto` and nothing else.
 *
 * Every byte the job store writes — the customer's original, the
 * remediated file, the record that describes them — goes through here
 * first. AES-256-GCM, a fresh 96-bit nonce per write, the tag stored beside
 * the ciphertext.
 *
 * ## What this protects against, and what it does not
 *
 * It protects a disk, a backup, a snapshot and a mislaid volume. Somebody
 * who ends up holding the bytes without the key holds noise.
 *
 * It does **not** protect against anybody who can run this process, because
 * this process has the key. That is the honest limit of encryption at rest
 * everywhere it is deployed, and saying so here is better than letting
 * "encrypted at rest" do more work in a sales conversation than it does in
 * a threat model. What it buys is real and it is narrow.
 *
 * ## GCM, and why the tag is not optional
 *
 * GCM authenticates as well as encrypts: `open` throws if a single byte of
 * the ciphertext, the nonce or the associated data has been changed. That
 * matters more here than the confidentiality does in one specific case — a
 * job record decides who may open a document, and a record an attacker can
 * silently edit is an authorisation bug with extra steps.
 *
 * The job id is passed as **associated data**, so a sealed record cannot be
 * moved from one job's directory to another's and still open. Without that,
 * an attacker who can move files around could swap a document they own for
 * one they do not.
 *
 * ## The key
 *
 * `STORAGE_KEY`, base64, 32 bytes, from the server environment — never a
 * `NEXT_PUBLIC_` variable. With no key configured the store writes plain
 * bytes and **says so**, which is right for development and is refused in
 * production: a service that silently stops encrypting because somebody
 * forgot a variable is worse than one that will not start.
 *
 * There is no key rotation. Every sealed blob carries a version byte so
 * that adding it later does not strand what is already written, and that is
 * the whole of the provision made for it.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class NoStorageKeyError extends Error {
  constructor() {
    super('STORAGE_KEY must be set in production: documents are encrypted at rest and there is nothing to encrypt with.');
  }
}

export class SealBrokenError extends Error {
  constructor() {
    // Nothing about the ciphertext is in the message. An error carrying the
    // bytes is the document in whatever catches the error.
    super('A stored blob failed its authentication check. It has been altered, or it belongs to a different job.');
  }
}

function keyOrNull(): Buffer | null {
  const raw = process.env.STORAGE_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') throw new NoStorageKeyError();
    return null;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) throw new Error(`STORAGE_KEY must be ${KEY_BYTES} bytes of base64.`);
  return key;
}

/** Whether what this process writes is encrypted. The page says which. */
export function encrypting(): boolean {
  return Boolean(process.env.STORAGE_KEY);
}

/**
 * `version | nonce | tag | ciphertext`. The version leads so that a reader
 * can tell a sealed blob from a plain one before it tries anything.
 */
export function seal(plain: Uint8Array, associated: string): Uint8Array {
  const key = keyOrNull();
  if (!key) return plain;

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(associated, 'utf8'));
  const body = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  const tag = cipher.getAuthTag();

  const out = new Uint8Array(1 + NONCE_BYTES + TAG_BYTES + body.length);
  out[0] = VERSION;
  out.set(nonce, 1);
  out.set(tag, 1 + NONCE_BYTES);
  out.set(body, 1 + NONCE_BYTES + TAG_BYTES);
  return out;
}

/**
 * Plain bytes back.
 *
 * A blob written before a key existed opens as itself, so turning
 * encryption on does not strand what is already stored. A blob that *is*
 * sealed and cannot be opened throws rather than returning anything: a
 * document that fails its authentication check is not a document to hand to
 * somebody.
 */
export function open(stored: Uint8Array, associated: string): Uint8Array {
  if (stored.length < 1 + NONCE_BYTES + TAG_BYTES || stored[0] !== VERSION) return stored;

  const key = keyOrNull();
  if (!key) return stored;

  const nonce = stored.subarray(1, 1 + NONCE_BYTES);
  const tag = stored.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const body = stored.subarray(1 + NONCE_BYTES + TAG_BYTES);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(Buffer.from(associated, 'utf8'));
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
  } catch {
    throw new SealBrokenError();
  }
}

/** The same, for the JSON records. */
export function sealText(text: string, associated: string): Uint8Array {
  return seal(new TextEncoder().encode(text), associated);
}

export function openText(stored: Uint8Array, associated: string): string {
  return new TextDecoder().decode(open(stored, associated));
}
