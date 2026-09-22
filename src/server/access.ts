/**
 * The one door onto a customer's document.
 *
 * `getJob` in the store answers about any job at all, which is right for a
 * store and wrong for everything else. Every page, route and action in
 * `src/app/` goes through `openJob` here instead: it works out who is
 * asking from their cookies, and hands back the job only if it is theirs.
 *
 * There is exactly one of these functions on purpose. A check repeated at
 * nine call sites is a check missing from the tenth, and the tenth is the
 * one that ships. A test greps `src/app/` and fails if anything there
 * reaches for the store directly.
 *
 * ## Two cookies, two different things
 *
 * `session` is a credential: it is 32 random bytes, the server stores only
 * its hash, and it expires on two clocks. `visitor` is not a credential and
 * is not treated as one — it is a long-lived id for one browser, and all it
 * can reach is that browser's own free assessments. Both are `httpOnly`,
 * which is the concrete thing they buy over the URL they replace: a cookie
 * is not in the address bar, not pasted into a ticket, and not in anybody's
 * browsing history.
 *
 * The visitor id is stored on the job as a SHA-256 digest rather than as
 * itself, so a leaked job record does not hand over the cookie that opens
 * it.
 */

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

import { NOBODY, mayOpen, mayReview, ownerOf, type Owner, type Viewer } from '@/domain/viewer';
import type { Job } from '@/domain/job';
import type { Decision } from '@/domain/findings';
import {
  confirm as confirmInStore,
  decide as decideInStore,
  figureImage as figureImageInStore,
  figureImages as figureImagesInStore,
  getJobFile,
  propose as proposeInStore,
  remediateJob,
  setReviewer as setReviewerInStore,
  unconfirm as unconfirmInStore,
  undecide as undecideInStore,
  type JobFile,
  type ProposeResult,
  getJob,
} from './jobs';
import { COOKIE as SESSION_COOKIE, COOKIE_OPTIONS, resolveSession, touchSession } from './sessions';

export const VISITOR_COOKIE = 'visitor';

/** Thirty days. Long enough to come back to an assessment, short enough to end. */
const VISITOR_MAX_AGE = 30 * 24 * 60 * 60;

/** What goes on the job record: never the cookie itself. */
export function visitorDigest(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

/**
 * Who is asking. Reading is all this does — a page cannot set a cookie, and
 * the one place a visitor is *minted* is the upload action.
 */
export async function viewer(): Promise<Viewer> {
  const jar = await cookies();
  const visitorCookie = jar.get(VISITOR_COOKIE)?.value;
  const visitor = visitorCookie ? visitorDigest(visitorCookie) : undefined;

  const token = jar.get(SESSION_COOKIE)?.value;
  const resolved = await resolveSession(token);
  if (resolved.ok) {
    // Touching on a read is what makes "thirty minutes idle" mean thirty
    // minutes without using the service, rather than thirty minutes without
    // changing anything.
    if (token) await touchSession(token);
    return visitor
      ? { kind: 'account', account: resolved.session.account, visitor }
      : { kind: 'account', account: resolved.session.account };
  }

  return visitor ? { kind: 'visitor', visitor } : NOBODY;
}

/**
 * The job, if it is this viewer's. `null` covers "no such job" and "not
 * yours" alike, and the caller shows the same not-found page for both:
 * telling a stranger that a job exists but is somebody else's is telling
 * them something.
 */
export async function openJob(id: string): Promise<Job | null> {
  const who = await viewer();
  const job = await getJob(id);
  if (!job) return null;
  return mayOpen(ownerOf(job), who) ? job : null;
}

/** Both at once, for a page that has to render differently for a visitor. */
export async function openJobFor(id: string): Promise<{ job: Job | null; who: Viewer }> {
  const who = await viewer();
  const job = await getJob(id);
  if (!job || !mayOpen(ownerOf(job), who)) return { job: null, who };
  return { job, who };
}

/**
 * The owner to record on a new job: the account if there is one, otherwise
 * this browser — minting and setting the cookie if it has none yet. Callable
 * only from a server action or route handler, because only those may write
 * a cookie.
 */
export async function ownerForUpload(): Promise<{ owner: Owner; who: Viewer }> {
  const who = await viewer();
  if (who.kind === 'account') return { owner: { account: who.account }, who };

  const jar = await cookies();
  let id = jar.get(VISITOR_COOKIE)?.value;
  if (!id) {
    id = randomBytes(32).toString('base64url');
    jar.set(VISITOR_COOKIE, id, { ...COOKIE_OPTIONS, maxAge: VISITOR_MAX_AGE });
  }
  const visitor = visitorDigest(id);
  return { owner: { visitor }, who: { kind: 'visitor', visitor } };
}


/**
 * Everything the app may do to a job, each one behind the same check.
 *
 * These are thin on purpose. The store still holds the logic; what is added
 * here is the one question — is this yours, and are you allowed to change
 * it — asked in one place rather than at every call site. A check written
 * nine times is a check missing the tenth time.
 *
 * Reading is a visitor's right over their own upload; writing is not.
 * `mayReview` draws that line and it is the same line pricing draws: the
 * assessment is free, and everything that produces a deliverable — a
 * changed file, a decision with a name on it, a statement — belongs to an
 * identified account.
 */
async function mine(id: string): Promise<Job | null> {
  return openJob(id);
}

export async function openJobToChange(id: string): Promise<Job | null> {
  const { job, who } = await openJobFor(id);
  return job && mayReview(who) ? job : null;
}

/** The document's bytes, if the job is this viewer's and they may have them. */
export async function openJobFile(id: string, which: JobFile) {
  if (!(await openJobToChange(id))) return null;
  return getJobFile(id, which);
}

/** Figures for the review screen. Reading, so a visitor may. */
export async function openFigureImages(id: string) {
  if (!(await mine(id))) return new Map();
  return figureImagesInStore(id);
}

export async function openFigureImage(id: string, key: string) {
  if (!(await mine(id))) return null;
  return figureImageInStore(id, key);
}

export async function remediate(id: string): Promise<Job | null> {
  if (!(await openJobToChange(id))) return null;
  return remediateJob(id);
}

export async function decide(id: string, key: string, decision: Decision): Promise<Job | null> {
  if (!(await openJobToChange(id))) return null;
  return decideInStore(id, key, decision);
}

export async function undecide(id: string, key: string): Promise<Job | null> {
  if (!(await openJobToChange(id))) return null;
  return undecideInStore(id, key);
}

export async function confirm(id: string, criterion: string, by: string): Promise<Job | null> {
  if (!(await openJobToChange(id))) return null;
  return confirmInStore(id, criterion, by);
}

export async function unconfirm(id: string, criterion: string): Promise<Job | null> {
  if (!(await openJobToChange(id))) return null;
  return unconfirmInStore(id, criterion);
}

export async function setReviewer(id: string, name: string): Promise<Job | null> {
  if (!(await openJobToChange(id))) return null;
  return setReviewerInStore(id, name);
}

export async function propose(id: string, key: string): Promise<ProposeResult> {
  if (!(await openJobToChange(id))) return { ok: false, reason: 'not-found' };
  return proposeInStore(id, key);
}
