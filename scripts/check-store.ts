/**
 * Prove a bucket works before a deploy trusts it with somebody's document.
 *
 * `npm run check:store`. It exercises the four verbs this service uses —
 * PUT, GET, ListObjectsV2, DELETE — against the real bucket, with the real
 * signature code, then checks that what it wrote came back sealed and that
 * a sealed object cannot be moved. Nothing else in the repository can tell
 * you those things: the tests prove the client is right, and this proves
 * your bucket and your credentials are.
 *
 * It exists because the alternative is finding out from a customer. A
 * mis-typed secret, a bucket in another region, a token scoped to read —
 * every one of those deploys cleanly and fails on the first upload, and
 * the first upload is a federal record.
 *
 * ## What it writes
 *
 * One object under `check/`, deleted before it exits, and deleted on the
 * way out of a failure too. The prefix is not a job id, so the retention
 * sweep cannot see it even if a run is interrupted.
 *
 * It prints no secret, no bucket contents and no key beyond its own probe.
 */

import { randomUUID } from 'node:crypto';

import { getBlob, listBlobs, putBlob, removeBlob, storage } from '../src/server/blobs';
import { encrypting, openText, sealText } from '../src/server/crypto';
import { s3Config } from '../src/server/s3';

const KEY = `check/${randomUUID()}.probe`;
const ELSEWHERE = `check/${randomUUID()}.probe`;

let failed = false;

function pass(what: string, detail = ''): void {
  console.log(`  ok    ${what}${detail ? ` — ${detail}` : ''}`);
}

function fail(what: string, why: string): void {
  failed = true;
  console.log(`  FAIL  ${what}\n        ${why}`);
}

async function main(): Promise<void> {
  console.log('\nChecking the store 508This would use.\n');

  // ── Which store, and is it the one you meant ────────────────────────────
  const where = storage();
  const config = s3Config();

  if (where === 'disk' || !config) {
    console.log('  This configuration resolves to LOCAL DISK, not an object store.\n');
    console.log('  All three of these have to be set for the object store to be chosen:');
    for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      console.log(`    ${process.env[name] ? 'set    ' : 'MISSING'}  ${name}`);
    }
    console.log('\n  There is no switch that overrides this: the credentials are the switch.');
    console.log('  A deploy in this state writes to a filesystem Vercel discards.\n');
    process.exit(1);
  }

  console.log(`  bucket    ${config.bucket}`);
  console.log(`  region    ${config.region}`);
  console.log(`  endpoint  ${config.endpoint ?? 'AWS (virtual-hosted addressing)'}`);
  console.log(`  style     ${config.endpoint ? 'path' : 'virtual-hosted'}`);
  console.log('');

  // ── The four verbs ──────────────────────────────────────────────────────
  const plain = `508This store check ${new Date().toISOString()}`;

  try {
    await putBlob(KEY, sealText(plain, KEY));
    pass('PUT', 'the credentials may write');
  } catch (error) {
    fail('PUT', describe(error));
    // Nothing else can pass if this did not, and the rest would be noise.
    return;
  }

  try {
    const back = await getBlob(KEY);
    if (!back) fail('GET', 'the object was written and read back as missing');
    else if (openText(back, KEY) !== plain) fail('GET', 'what came back is not what went in');
    else pass('GET', 'the bytes survive the round trip');
  } catch (error) {
    fail('GET', describe(error));
  }

  try {
    const keys = await listBlobs('check/');
    if (keys.includes(KEY)) pass('LIST', `${keys.length} object${keys.length === 1 ? '' : 's'} under check/`);
    else fail('LIST', 'the object just written is not in the listing');
  } catch (error) {
    fail('LIST', describe(error));
  }

  // ── Encryption, and the binding that matters more than it does ──────────
  if (!encrypting()) {
    fail(
      'STORAGE_KEY',
      'not set, so this bucket would hold plaintext.\n' +
        '        In production the service refuses to store anything at all rather than\n' +
        '        do that. Generate one with:\n' +
        '          node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  } else {
    const stored = await getBlob(KEY);
    if (stored && !Buffer.from(stored).toString('utf8').includes('508This store check')) {
      pass('SEALED', 'what the bucket holds is not readable');
    } else {
      fail('SEALED', 'the bucket is holding something readable');
    }

    // The property a disk never had: a record cannot be moved. Same bytes,
    // different key, and it must refuse to open.
    try {
      await putBlob(ELSEWHERE, sealText(plain, KEY));
      let opened = false;
      try {
        openText((await getBlob(ELSEWHERE))!, ELSEWHERE);
        opened = true;
      } catch {
        // Exactly what should happen.
      }
      if (opened) fail('BOUND', 'an object moved to another key still opened — encryption is not bound');
      else pass('BOUND', 'an object moved to another key will not open');
    } catch (error) {
      fail('BOUND', describe(error));
    }
  }

  // ── DELETE, and that it is idempotent ───────────────────────────────────
  try {
    await removeBlob(KEY);
    if (await getBlob(KEY)) fail('DELETE', 'the object is still there after being deleted');
    else pass('DELETE', 'the credentials may delete');
    await removeBlob(KEY);
    pass('DELETE again', 'deleting what is gone is not an error');
  } catch (error) {
    fail('DELETE', describe(error));
  }
}

/** Never the bytes, never the secret: the status and the verb, which is all `S3Error` carries. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : 'an error with no message';

  // `fetch` reports every transport problem as "fetch failed" and puts the
  // useful part in `cause`. A wrong endpoint is the likeliest mistake of
  // all of these, and it is the one that says the least by default.
  if (/fetch failed/i.test(message)) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const code = cause?.code ?? '';
    const detail = cause?.message ?? 'no further detail';
    const hint =
      code === 'ENOTFOUND'
        ? 'The host does not resolve. Check S3_ENDPOINT, or unset it to address AWS directly.'
        : code === 'ECONNREFUSED'
          ? 'Nothing is listening there. Check S3_ENDPOINT, including its port and http/https.'
          : code === 'CERT_HAS_EXPIRED' || /certificate/i.test(detail)
            ? 'A TLS problem reaching the endpoint.'
            : 'The request never reached the store. Check S3_ENDPOINT and that this machine can reach it.';
    return `could not reach the store (${code || detail})\n        ${hint}`;
  }

  if (/status 403/.test(message)) {
    return `${message}\n        403 is the signature or the permissions. Check the secret was pasted whole,\n        and that the token may read, write and delete on this bucket.`;
  }
  if (/status 404/.test(message)) {
    return `${message}\n        404 on a bucket-level call usually means the bucket name or region is wrong.`;
  }
  return message;
}

try {
  await main();
} finally {
  // Leave nothing behind, including after a failure.
  for (const key of [KEY, ELSEWHERE]) {
    try {
      await removeBlob(key);
    } catch {
      // Already gone, or we never got far enough to write it.
    }
  }
}

console.log('');
if (failed) {
  console.log('Something is wrong. Do not deploy into this bucket yet.\n');
  process.exit(1);
}
console.log('This bucket is ready. Set the same variables on the deployment.');
console.log('Two settings this cannot check for you, from docs/deploy.md:');
console.log('  — no lifecycle or expiry rule on audit/, accounts/, sessions/ or resets/');
console.log('  — the bucket is not public\n');
