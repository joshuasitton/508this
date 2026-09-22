/**
 * How long 508This keeps a customer's document, and when the clock starts.
 *
 * The Chairman decided this on 21 September: **the document is deleted
 * seven days after the customer downloads the package.** Both halves of
 * that sentence matter and the second one is the interesting one.
 *
 * A fixed age — "deleted thirty days after upload" — is the usual answer
 * and it is wrong for this service. A conformance review is not a thing
 * that finishes on a schedule: a contractor sends a document, a reviewer
 * works through it over a fortnight, and a clock that started at upload
 * deletes the file in the middle of the job. Starting the clock at
 * **download** means the countdown begins when the customer has what they
 * came for, which is the only moment the service can be sure they no longer
 * need the original on this server.
 *
 * The cost is that a document nobody ever downloads is kept indefinitely,
 * and that is a real gap. It is named at the bottom of this file rather
 * than papered over.
 */

/** Seven days, in the Chairman's words. */
export const RETENTION_DAYS = 7;

export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** When a download at this moment means the document goes. */
export function deleteAfter(downloadedAt: string): string {
  const at = Date.parse(downloadedAt);
  if (!Number.isFinite(at)) throw new Error('A download time must be a real time.');
  return new Date(at + RETENTION_MS).toISOString();
}

/**
 * Whether the document should be gone by now.
 *
 * A record with no `deleteAfter` has never been downloaded, and is not
 * expired. A record with an unparseable one is treated as expired: a
 * corrupt retention date on a federal document is a thing to resolve in the
 * customer's favour, and the customer's favour is deletion.
 */
export function expired(job: { deleteAfter?: string }, now: number): boolean {
  if (!job.deleteAfter) return false;
  const at = Date.parse(job.deleteAfter);
  if (!Number.isFinite(at)) return true;
  return now >= at;
}

/** Whole days left, rounded up, or 0 once it is due. */
export function daysLeft(job: { deleteAfter?: string }, now: number): number {
  if (!job.deleteAfter) return RETENTION_DAYS;
  const at = Date.parse(job.deleteAfter);
  if (!Number.isFinite(at) || now >= at) return 0;
  return Math.ceil((at - now) / (24 * 60 * 60 * 1000));
}

/**
 * The date, written out. Month names rather than `toLocaleDateString`,
 * because the same choice was made for the conformance report and for the
 * same reason: a date that depends on which ICU data the server happens to
 * ship is a date that differs between the page and the file.
 */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function retentionDate(iso: string): string {
  const at = new Date(iso);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/**
 * What the customer is told, on the page, before it happens.
 *
 * A date and not a countdown. "Four days from now" needs a clock, and a
 * clock read in the middle of a render is a page that says something
 * different depending on when it was built — which is exactly what the
 * renderer's purity rule is there to prevent, and also just worse: a date
 * is unambiguous, survives being printed, and does not quietly go stale.
 */
export function describeRetention(job: { deleteAfter?: string; deletedAt?: string }): string {
  if (job.deletedAt) {
    return `This document was deleted on ${retentionDate(job.deletedAt)}, ${RETENTION_DAYS} days after you downloaded it. The conformance statement stays; the file does not.`;
  }
  if (!job.deleteAfter) {
    return `Your document stays here while you are working on it. The countdown to deletion starts when you download the remediated file, and runs for ${RETENTION_DAYS} days.`;
  }
  return `This document and everything made from it are deleted on ${retentionDate(job.deleteAfter)} — ${RETENTION_DAYS} days after you downloaded it. The conformance statement stays; the file does not.`;
}

/**
 * The gap this policy has, stated where somebody will read it.
 *
 * A document nobody downloads has no clock. That is a direct consequence of
 * starting the countdown at download rather than at upload, and the
 * alternative — a second, longer ceiling from upload — is a decision for
 * the Chairman rather than an assumption for the code.
 */
export const NEVER_DOWNLOADED =
  'A document that is never downloaded has no deletion date, because the countdown starts at download. Whether an outer limit runs from upload as well is not decided.';
