/**
 * Who is asking, and whether this job is theirs.
 *
 * Until now a job belonged to whoever had its URL. A UUID is unguessable
 * and that is not the same as private: links are pasted into tickets,
 * forwarded, logged by proxies and kept in browser history, and "anyone
 * holding the link is the reviewer" is not a sentence that survives a
 * document marked Controlled Unclassified Information.
 *
 * ## Two kinds of owner, because the free assessment is worth keeping
 *
 * The Chairman kept the anonymous upload, which settles a real tension.
 * Pricing says a customer should find out whether this service can help
 * them *before* they pay, and a sign-up wall in front of the first upload
 * takes that back. So a job is owned either by an **account** or by a
 * **visitor** — one browser, one cookie, no name — and the difference is
 * exactly the difference between the two decisions:
 *
 * - A visitor may upload, read the assessment, and come back to it from the
 *   same browser. Nobody else can open it, link or no link.
 * - Keeping the work — the review queue, the statement, the download —
 *   and marking anything CUI needs an account, because 800-171 asks for an
 *   identified user and a cookie is not one.
 *
 * ## A visitor is a weaker claim, and the code says so rather than
 * pretending otherwise
 *
 * A visitor cookie is a bearer token: whoever holds it is the visitor.
 * That is a real limitation and it is why the visitor's reach stops at
 * their own free assessment. What it buys over the URL it replaces is that
 * it is `httpOnly`, it is not in the address bar, it is not pasted into a
 * ticket, and it is not in anybody's history.
 *
 * ## An unowned job belongs to nobody
 *
 * A record written before ownership existed has neither owner, and
 * `mayOpen` refuses it. Failing closed on an old record costs a developer
 * a re-upload; failing open would mean every job written before this change
 * stayed readable by anyone who ever had its link, which is the thing being
 * fixed.
 */

/** Exactly one of these, and a job carries one or the other. */
export type Owner = { account: string } | { visitor: string };

/**
 * Who is making the request. A signed-in person may still carry a visitor
 * cookie from before they had an account — that is how their earlier
 * uploads find their way to them — so `account` keeps the visitor beside
 * it rather than replacing it.
 */
export type Viewer =
  | { kind: 'account'; account: string; visitor?: string }
  | { kind: 'visitor'; visitor: string }
  | { kind: 'nobody' };

export const NOBODY: Viewer = { kind: 'nobody' };

/** The owner recorded on a job, or null if it has none. */
export function ownerOf(job: { account?: string; visitor?: string }): Owner | null {
  if (job.account) return { account: job.account };
  if (job.visitor) return { visitor: job.visitor };
  return null;
}

/**
 * Whether this viewer may open this job.
 *
 * A signed-in person may open an account job that is theirs, and a visitor
 * job held by the same browser — that second case is what lets somebody
 * sign up *after* uploading and still find their document. It is not a
 * claim on the job; claiming is a separate, deliberate write.
 */
export function mayOpen(owner: Owner | null, viewer: Viewer): boolean {
  if (!owner) return false;
  if ('account' in owner) return viewer.kind === 'account' && viewer.account === owner.account;
  if (viewer.kind === 'visitor') return viewer.visitor === owner.visitor;
  if (viewer.kind === 'account') return viewer.visitor === owner.visitor;
  return false;
}

/**
 * Whether a visitor job should become this viewer's account's. True only
 * when a signed-in person is looking at a job their own browser uploaded
 * before they had an account.
 */
export function mayClaim(owner: Owner | null, viewer: Viewer): boolean {
  return Boolean(
    owner && 'visitor' in owner && viewer.kind === 'account' && viewer.visitor && viewer.visitor === owner.visitor,
  );
}

/**
 * Marking a document CUI requires an identified user, because that is what
 * 800-171 asks for and a cookie is not one. Enforced where the declaration
 * is taken, not where the model would be called: by then the document is
 * already stored under a promise it cannot keep.
 */
export function mayMarkCui(viewer: Viewer): boolean {
  return viewer.kind === 'account';
}

/**
 * What a signed-out person may do with a job they own: read it, and
 * nothing that produces a deliverable. The line is the same one pricing
 * draws — the assessment is free and the rest is bought — and it is here so
 * the two cannot disagree.
 */
export function mayReview(viewer: Viewer): boolean {
  return viewer.kind === 'account';
}

export function describeSignInNeeded(what: 'review' | 'cui' | 'download'): string {
  switch (what) {
    case 'review':
      return 'Deciding findings puts a named person on a federal conformance statement, so it needs an account rather than a name typed into a box. The assessment above stays free and stays yours.';
    case 'cui':
      return 'A document marked Controlled Unclassified Information needs an account. Identification and authentication is what the standard asks for, and a browser cookie is not either of them.';
    case 'download':
      return 'The remediated document and the conformance statement go to an account, so there is a record of who received them.';
  }
}
