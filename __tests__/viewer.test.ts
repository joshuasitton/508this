import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  NOBODY,
  describeSignInNeeded,
  mayClaim,
  mayMarkCui,
  mayOpen,
  mayReview,
  ownerOf,
  type Viewer,
} from '../src/domain/viewer';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-b666-555555555555';
const BROWSER = 'a'.repeat(64);
const OTHER_BROWSER = 'b'.repeat(64);

const signedIn: Viewer = { kind: 'account', account: ACCOUNT };
const signedInHere: Viewer = { kind: 'account', account: ACCOUNT, visitor: BROWSER };
const visitor: Viewer = { kind: 'visitor', visitor: BROWSER };

test('a job owned by an account opens for that account and nobody else', () => {
  const owner = ownerOf({ account: ACCOUNT });
  assert.deepEqual(owner, { account: ACCOUNT });
  assert.equal(mayOpen(owner, signedIn), true);
  assert.equal(mayOpen(owner, { kind: 'account', account: OTHER }), false);
  assert.equal(mayOpen(owner, visitor), false);
  assert.equal(mayOpen(owner, NOBODY), false);
});

test('a job owned by a browser opens for that browser and nobody else', () => {
  const owner = ownerOf({ visitor: BROWSER });
  assert.deepEqual(owner, { visitor: BROWSER });
  assert.equal(mayOpen(owner, visitor), true);
  assert.equal(mayOpen(owner, { kind: 'visitor', visitor: OTHER_BROWSER }), false);
  assert.equal(mayOpen(owner, NOBODY), false);
  // Signing in on a *different* browser does not reach it. The cookie is
  // the only claim a visitor job has, and somebody else's account is not it.
  assert.equal(mayOpen(owner, signedIn), false);
});

/**
 * Upload first, sign up second. Without this the document somebody just
 * decided to pay for is stranded behind a cookie that stopped deciding
 * anything the moment they made an account.
 */
test('signing up in the browser that uploaded keeps the upload reachable', () => {
  const owner = ownerOf({ visitor: BROWSER });
  assert.equal(mayOpen(owner, signedInHere), true);
  assert.equal(mayClaim(owner, signedInHere), true);
  assert.equal(mayClaim(owner, signedIn), false, 'a different browser claims nothing');
  assert.equal(mayClaim(ownerOf({ account: OTHER }), signedInHere), false, 'an account job is never reassigned');
});

/**
 * A record from before ownership existed has neither owner. Failing closed
 * costs a developer a re-upload; failing open would leave every job written
 * before this change readable by anyone who ever had its link, which is the
 * thing being fixed.
 */
test('a job with no owner belongs to nobody at all', () => {
  assert.equal(ownerOf({}), null);
  for (const who of [signedIn, signedInHere, visitor, NOBODY]) {
    assert.equal(mayOpen(null, who), false);
  }
});

test('a cookie may read, and only an account may change anything', () => {
  assert.equal(mayReview(signedIn), true);
  assert.equal(mayReview(visitor), false);
  assert.equal(mayReview(NOBODY), false);

  assert.equal(mayMarkCui(signedIn), true);
  assert.equal(mayMarkCui(visitor), false);
  assert.equal(mayMarkCui(NOBODY), false);
});

test('each sign-in prompt says something different, and says why', () => {
  const said = (['review', 'cui', 'download'] as const).map(describeSignInNeeded);
  assert.equal(new Set(said).size, 3);
  for (const sentence of said) assert.ok(sentence.length > 40);
});

/**
 * The invariant `src/server/access.ts` exists to hold: one door, not nine.
 *
 * A check written at every call site is a check missing from the one added
 * next month, and on this codebase the thing behind the door is a federal
 * contractor's document. So nothing under `src/app/` reaches the store for
 * a job — the three exceptions are named here, and adding a fourth means
 * arguing for it in this list rather than forgetting to.
 */
test('nothing in the app reaches the job store except through the guard', async () => {
  const allowed: Record<string, string[]> = {
    // Creates the job, and is the one place an owner is decided.
    'start/actions.ts': ['createJob'],
    // Hands a browser's jobs to the account it just signed in to.
    'account/actions.ts': ['claimJobs'],
    // A type, which carries no access to anything.
    'jobs/[id]/download/route.ts': ['JobFile'],
  };

  const root = new URL('../src/app/', import.meta.url).pathname;
  const offenders: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;

      const source = await readFile(full, 'utf8');
      const relative = path.relative(root, full);
      for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@\/server\/jobs'/g)) {
        const names = (match[1] ?? '')
          .split(',')
          .map((n) => n.replace(/\btype\b/, '').trim())
          .filter(Boolean);
        for (const name of names) {
          if (!(allowed[relative] ?? []).includes(name)) offenders.push(`${relative}: ${name}`);
        }
      }
    }
  };

  await walk(root);
  assert.deepEqual(offenders, [], 'these should come from @/server/access instead');
});

/** The negative control: the scan has to actually be reading files. */
test('the scan above reads real files, so its silence means something', async () => {
  const root = new URL('../src/app/', import.meta.url).pathname;
  const source = await readFile(path.join(root, 'start/actions.ts'), 'utf8');
  assert.match(source, /from '@\/server\/jobs'/, 'the one import the allowlist names is really there');
});
