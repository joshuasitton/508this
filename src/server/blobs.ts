/**
 * Where a customer's bytes actually live: local disk, or an object store.
 *
 * `src/server/jobs.ts` has had four functions for a while that were the only
 * code in the repository touching a document — `readRecord`, `writeRecord`,
 * `readBlob`, `writeBlob`. They were written that way so the day local disk
 * stopped being the answer would be a one-file day. This is that file.
 *
 * Above this line a job is a record and two documents. Below it, a key and
 * some bytes. Nothing above knows which store answered, which is the point:
 * the encryption, the retention sweep and the ownership check are all
 * unchanged by the move, and the tests that cover them run against disk
 * exactly as before.
 *
 * ## One store, several prefixes
 *
 * Documents were here first and for a day this was only theirs. The audit
 * log followed, and it does not live under a job id — so the folder on disk
 * is `store/` rather than `documents/`, and `STORE_DIR` is the variable
 * that moves it. `DOCUMENTS_DIR` is still honoured, because it is what the
 * deployment and the older tests already say and renaming a variable is not
 * worth a broken environment.
 *
 * Keys under a job id belong to that job and are swept when it expires.
 * Everything else is somebody else's prefix and the sweep cannot see it:
 * `jobIds()` keeps only the keys whose first segment is a UUID, which the
 * word `audit` is not. A test holds that, because it is the difference
 * between a retention policy and losing the evidence.
 *
 * ## Which one, and how it is decided
 *
 * `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` together mean
 * the object store; anything less means disk. There is no `STORAGE=s3`
 * switch, because a switch set without credentials is a service that starts
 * and then cannot read anything, and a service that will not start is
 * better than one that comes up broken.
 *
 * Nothing here decrypts, encrypts or knows what a job is. Bytes in, bytes
 * out — which is why a mis-set variable cannot silently downgrade
 * encryption: that decision belongs to `crypto.ts` and is made before
 * anything reaches here.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { s3Config, s3Delete, s3Get, s3List, s3Put } from './s3';

const ROOT = process.env.STORE_DIR ?? process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), 'store');

/**
 * A key is one or more segments of hex, hyphens, dots and underscores. That
 * is everything this service actually writes — job ids and fixed file names
 * — and it is narrow enough that a key can never climb out of the root on
 * disk or mean something unexpected in a URL.
 */
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export class BadKeyError extends Error {
  constructor() {
    super('A storage key must be plain segments of letters, digits, dots, hyphens and underscores.');
  }
}

function checked(key: string): string {
  if (!KEY.test(key)) throw new BadKeyError();
  return key;
}

/** Which store is answering. The page says so, rather than implying. */
export function storage(): 'disk' | 's3' {
  return s3Config() ? 's3' : 'disk';
}

export async function putBlob(key: string, bytes: Uint8Array): Promise<void> {
  checked(key);
  const config = s3Config();
  if (config) return s3Put(config, key, bytes);

  const file = path.join(ROOT, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

/** The bytes, or null if there is no such object. */
export async function getBlob(key: string): Promise<Uint8Array | null> {
  checked(key);
  const config = s3Config();
  if (config) return s3Get(config, key);

  try {
    return new Uint8Array(await readFile(path.join(ROOT, key)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Gone, or never there: both are success, on either store. */
export async function removeBlob(key: string): Promise<void> {
  checked(key);
  const config = s3Config();
  if (config) return s3Delete(config, key);
  await rm(path.join(ROOT, key), { force: true });
}

/**
 * Every key under a prefix.
 *
 * On disk this walks directories; on S3 it is `ListObjectsV2`. Both return
 * full keys rather than directory entries, because an object store has no
 * directories and pretending otherwise is how a caller ends up written
 * against one store and broken on the other.
 *
 * The walk descends only where the prefix could still match. S3 has always
 * filtered server-side; the disk path used to walk the whole store and
 * throw away what did not match, which was invisible while the only caller
 * wanted every key and would have become a full scan per read the moment
 * one account's audit log was asked for.
 */
export async function listBlobs(prefix: string): Promise<string[]> {
  const config = s3Config();
  if (config) return s3List(config, prefix);

  const out: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path.join(ROOT, relative), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // Descend if the prefix leads into this directory, or if this
        // directory is already inside the prefix. Anything else cannot
        // contain a matching key.
        if (prefix.startsWith(`${key}/`) || `${key}/`.startsWith(prefix)) await walk(key);
      } else if (key.startsWith(prefix)) {
        out.push(key);
      }
    }
  };
  await walk('');
  return out.sort();
}
