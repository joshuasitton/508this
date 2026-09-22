/**
 * Taking the customer's own sentences back out of the job record.
 *
 * The Chairman settled retention on 21 September and one line of it has
 * been sitting unimplemented since: **the job record is scrubbed of its
 * quotations at delivery.** It is not a tidy-up. The Word detector writes
 * the customer's own words into nearly every finding — a link's text, a
 * paragraph's opening, the sentence that relies on colour, the title it
 * proposed — and a record full of those is a copy of the document under a
 * retention policy nobody wrote. Deleting the file in seven days while
 * keeping a record that quotes it is a deletion policy in name only.
 *
 * ## The quotation marks are the seam, and that is deliberate
 *
 * Every place the detectors and the remediator quote the document, they do
 * it inside curly quotes — `paragraph 4 (“The applicant must…”)`, `The link
 * text is “click here”`, `Set the title to “Annual Report”`. That was a
 * prose convention before it was a boundary; making it the boundary is what
 * lets one function find every quotation without each detector having to
 * remember to mark its own.
 *
 * The convention is therefore load-bearing, and a test says so: a detector
 * that quotes with straight quotes, or with none, puts a customer's
 * sentence somewhere this cannot reach.
 *
 * ## What stays
 *
 * The finding's kind, criterion, severity, location number, anchor and
 * decision *action* all stay, because the conformance statement is a claim
 * about those and the claim has to remain checkable after delivery. What
 * goes is every word that came out of the document: a reader of a scrubbed
 * record can see that paragraph 4 failed 1.4.1 and cannot see what
 * paragraph 4 said.
 */

import type { Job } from './job';

/** What replaces a quotation. Short, and obviously not a quotation. */
export const REMOVED = '[removed]';

/**
 * Curly quotes, non-greedy, across newlines. Straight quotes are
 * deliberately not matched: they are used in this codebase for the
 * service's own words (`announced as just "link"` is written with curly
 * quotes precisely so it *is* caught, and nothing else quotes), and
 * widening this to `"` would gut the service's own sentences without
 * removing anything a detector wrote.
 */
const QUOTED = /“[\s\S]*?”/g;

/** One string with every quotation taken out. */
export function scrubText(text: string): string {
  return text.replace(QUOTED, REMOVED);
}

/** Whether a string still holds something the document said. */
export function hasQuotation(text: string): boolean {
  return /“[\s\S]*?”/.test(text);
}

/**
 * The record with the customer's words removed, and the moment it happened
 * written down.
 *
 * `decision.value` goes too, and that is the one that costs something: it
 * is the alternative text a reviewer wrote, and without it the delivered
 * document cannot be rebuilt from the original. That is the right way
 * round — a record that can rebuild the document is a record that still
 * contains it, and delivery is the point after which nothing needs
 * rebuilding. `scrubbedAt` is what the store checks before it tries.
 */
export function scrubJob(job: Job, at: string): Job {
  const scrubbed: Job = {
    ...job,
    filename: job.filename,
    scrubbedAt: at,
    findings: job.findings.map((finding) => {
      const next = { ...finding, location: scrubText(finding.location), description: scrubText(finding.description) };
      if (next.proposal) next.proposal = { ...next.proposal, text: REMOVED };
      if (next.decision) {
        next.decision = {
          ...next.decision,
          ...(next.decision.value === undefined ? {} : { value: REMOVED }),
          ...(next.decision.note === undefined ? {} : { note: scrubText(next.decision.note) }),
        };
      }
      return next;
    }),
  };

  if (job.applied) {
    scrubbed.applied = job.applied.map((a) => ({
      ...a,
      location: scrubText(a.location),
      description: scrubText(a.description),
    }));
  }
  return scrubbed;
}

export function isScrubbed(job: Job): boolean {
  return Boolean(job.scrubbedAt);
}

/**
 * The sentence on the page, so a customer is told rather than left to
 * notice that their report got vaguer.
 */
export function describeScrub(job: Job): string | null {
  if (!job.scrubbedAt) return null;
  return 'This document has been delivered, so the quotations from it have been taken out of this record. What each finding was, where it was and how it was decided all remain; the words the document used do not. The file itself is deleted on the date above.';
}
