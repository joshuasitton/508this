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
 * ## The second clock, decided 25 September
 *
 * Starting at download left a document nobody downloads with no clock at
 * all, kept indefinitely. The Chairman closed that: **72 hours to collect,
 * and then it goes.** The seven days still run for anybody who does
 * download, so a customer who loses the file can still fetch it again.
 *
 * Which clock a job is on depends on what has happened to it:
 *
 * | The job | When the files go |
 * |---|---|
 * | downloaded | seven days after the download |
 * | remediated, not downloaded | 72 hours after it became collectable |
 * | nobody has touched it | 72 hours after upload |
 * | **a reviewer is working on it** | **no clock yet** |
 *
 * That last row is the one worth defending, and it is why this is not
 * simply "72 hours from upload". A conformance review is not a thing that
 * finishes on a schedule — a contractor sends a document, a reviewer works
 * through it over a fortnight — and a clock from upload deletes the file
 * in the middle of the job. `reviewer` is set the first time a person
 * decides anything, so it is exactly the signal for "somebody is working on
 * this"; the 72 hours start when there is something to collect.
 */

/** Seven days, in the Chairman's words. */
export const RETENTION_DAYS = 7;

export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** And 72 hours to collect it in the first place. */
export const COLLECT_HOURS = 72;

export const COLLECT_MS = COLLECT_HOURS * 60 * 60 * 1000;

/** What a job's deletion date is counted from. */
export type Clock = 'downloaded' | 'uncollected' | 'untouched';

export interface Due {
  /** When the files go. */
  at: string;
  which: Clock;
}

/**
 * The one place that decides when a job's files are deleted, so the sweep,
 * the job page and the report cannot disagree about it.
 *
 * `null` means no clock is running: a reviewer is working on the document
 * and there is nothing to collect yet.
 */
export function dueAt(job: {
  createdAt?: string;
  remediatedAt?: string;
  reviewer?: string;
  deleteAfter?: string;
}): Due | null {
  if (job.deleteAfter) return { at: job.deleteAfter, which: 'downloaded' };
  if (job.remediatedAt) return { at: plus(job.remediatedAt, COLLECT_MS), which: 'uncollected' };
  // Somebody is part-way through deciding this document's findings. The
  // clock starts when there is a package to collect, not before.
  if (job.reviewer) return null;
  if (job.createdAt) return { at: plus(job.createdAt, COLLECT_MS), which: 'untouched' };
  return null;
}

/**
 * An unparseable date is resolved in the customer's favour, and the
 * customer's favour is deletion — so it comes back as a time already past
 * rather than as no clock at all.
 */
function plus(iso: string, ms: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return new Date(0).toISOString();
  return new Date(at + ms).toISOString();
}

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
export function expired(
  job: { createdAt?: string; remediatedAt?: string; reviewer?: string; deleteAfter?: string },
  now: number,
): boolean {
  const due = dueAt(job);
  if (!due) return false;
  const at = Date.parse(due.at);
  if (!Number.isFinite(at)) return true;
  return now >= at;
}

/**
 * Whole days left on whichever clock is running, rounded up, or 0 once it
 * is due. `null` while no clock runs, which is not the same as "plenty of
 * time" and should not be rendered as a number.
 */
export function daysLeft(
  job: { createdAt?: string; remediatedAt?: string; reviewer?: string; deleteAfter?: string },
  now: number,
): number | null {
  const due = dueAt(job);
  if (!due) return null;
  const at = Date.parse(due.at);
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
export function describeRetention(job: {
  createdAt?: string;
  remediatedAt?: string;
  reviewer?: string;
  deleteAfter?: string;
  deletedAt?: string;
}): string {
  if (job.deletedAt) {
    return `This document was deleted on ${retentionDate(job.deletedAt)}. The conformance statement stays; the file does not.`;
  }

  const due = dueAt(job);
  if (!due) {
    return `Your document stays here while it is being reviewed. Once the remediated file is ready you have ${COLLECT_HOURS} hours to download it, and ${RETENTION_DAYS} days from the download before it is deleted.`;
  }

  const keep = 'The conformance statement stays; the file does not.';
  if (due.which === 'downloaded') {
    return `This document and everything made from it are deleted on ${retentionDate(due.at)} — ${RETENTION_DAYS} days after you downloaded it. ${keep}`;
  }
  if (due.which === 'uncollected') {
    return `Your remediated file is ready. Download it by ${retentionDate(due.at)}: after ${COLLECT_HOURS} hours it is deleted uncollected. Downloading starts a ${RETENTION_DAYS}-day window in which you can fetch it again.`;
  }
  return `Your findings are on the record. The document itself is deleted on ${retentionDate(due.at)}, ${COLLECT_HOURS} hours after you uploaded it, unless a review starts before then. ${keep}`;
}

/**
 * What used to be this file's named gap, now closed.
 *
 * Kept as a sentence rather than deleted because the policy is a thing the
 * service says out loud — in the privacy answer, in a security
 * questionnaire, and to a customer who asks how long their document is
 * here.
 */
export const POLICY =
  `A document is deleted ${RETENTION_DAYS} days after the customer downloads it, and ${COLLECT_HOURS} hours after ` +
  'it becomes collectable if they never do. A document nobody has begun reviewing is deleted ' +
  `${COLLECT_HOURS} hours after upload. Nothing is deleted while a reviewer is working on it.`;
