/**
 * The Accessibility Conformance Report, as a structure rather than a page.
 *
 * The statement is the product. A customer buys remediation so they can hand
 * a contracting officer a document that says, criterion by criterion, what
 * the file does and on what basis — and the officer wants it as a file, not
 * a URL that may not resolve in two years. So the report has to exist in two
 * renderings, on screen and as a Word file, and the one thing that must not
 * happen is for them to say different things about the same job.
 *
 * Hence this module. It computes the report once, from the job, and both
 * renderings are dumb: they lay out what is here and add nothing. Every
 * sentence still comes from where it already lived — statuses from
 * `assess`, remarks from `describeRemarks`, the headline from
 * `describeSummary` — because a report that reworded its own remarks would
 * be a second opinion on the same evidence.
 *
 * `complete` is the delivery gate. A statement with a criterion still
 * waiting on a reviewer is an honest working document and a dishonest
 * deliverable; the Word file carries the distinction on its face rather than
 * leaving the customer to notice.
 */

import {
  CRITERIA,
  DOCUMENT_EXEMPT,
  criterion as criterionById,
  labelFor,
  type ContentKind,
  type Level,
  type Principle,
} from './criteria';
import { assessAll, describeRemarks, describeSummary, summarise, type Status } from './findings';
import type { Job } from './job';

export const PRINCIPLES: readonly Principle[] = ['Perceivable', 'Operable', 'Understandable', 'Robust'];

/** The VPAT 2 column names, which federal buyers read without translating. */
export const COLUMNS = ['Criterion', 'Level', 'Conformance Level', 'Remarks and Explanations'] as const;

export interface AcrFact {
  label: string;
  value: string;
}

export interface AcrRow {
  criterion: string;
  /** "1.1.1 Non-text Content". */
  label: string;
  level: Level;
  status: Status;
  remarks: string;
  /** True while this row waits on a person. The renderings mark it. */
  pending: boolean;
}

export interface AcrSection {
  principle: Principle;
  rows: AcrRow[];
}

export interface Acr {
  /** The customer's filename, as they sent it. */
  filename: string;
  /** What the document is called in its own title property and on its first page. */
  title: string;
  facts: AcrFact[];
  verdict: { headline: string; detail: string };
  sections: AcrSection[];
  notes: string[];
  /**
   * Whether this is a statement or a working draft. False while any
   * criterion still needs a reviewer.
   */
  complete: boolean;
  /** How many criteria still wait on a person. Zero when `complete`. */
  pending: number;
}

const STANDARD = 'Revised Section 508 Standards (36 CFR Part 1194), incorporating WCAG 2.0 Level A and AA';

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

/**
 * The date as a buyer reads it. Written out rather than left to
 * `toLocaleDateString`, because the same job must produce the same statement
 * on every machine that renders it, and a Node build without full ICU
 * quietly formats dates differently.
 */
export function reportDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function contentLabel(kind: ContentKind): string {
  return kind === 'pdf' ? 'Non-web document (PDF)' : kind === 'docx' ? 'Non-web document (Word)' : 'Web content';
}

export function buildAcr(job: Job): Acr {
  const confirmed = new Set(Object.keys(job.confirmations ?? {}));
  const summary = summarise(job.findings, job.format, confirmed);
  const assessments = assessAll(job.findings, job.format, confirmed);
  const byId = new Map(assessments.map((a) => [a.criterion, a]));
  const fixed = job.findings.filter((f) => f.remediated).length;

  const sections: AcrSection[] = PRINCIPLES.map((principle) => ({
    principle,
    rows: CRITERIA.filter((c) => c.principle === principle).map((c) => {
      const a = byId.get(c.id)!;
      return {
        criterion: c.id,
        label: labelFor(c.id),
        level: c.level,
        status: a.status,
        remarks: describeRemarks(a, job.format),
        pending: a.status === 'Needs Review',
      };
    }),
  }));

  const facts: AcrFact[] = [
    { label: 'Document', value: job.filename },
    { label: 'Standard', value: STANDARD },
    { label: 'Content type', value: contentLabel(job.format) },
    { label: 'Report date', value: reportDate(job.remediatedAt ?? job.createdAt) },
  ];
  if (job.reviewer) facts.push({ label: 'Reviewer', value: job.reviewer });
  facts.push({ label: 'Evaluation method', value: method(job, fixed, summary.review) });

  return {
    filename: job.filename,
    title: `Accessibility Conformance Report — ${job.filename}`,
    facts,
    verdict: describeSummary(summary),
    sections,
    notes: notes(summary.review),
    complete: summary.review === 0,
    pending: summary.review,
  };
}

function method(job: Job, fixed: number, review: number): string {
  const checked = `508This automated checks on the document as delivered${
    job.remediatedAt ? `, after remediation of ${fixed} ${fixed === 1 ? 'issue' : 'issues'}` : ''
  }`;
  const person =
    review > 0
      ? `${review} ${review === 1 ? 'criterion' : 'criteria'} that only a person can judge ${review === 1 ? 'is' : 'are'} not yet confirmed`
      : `every criterion that only a person can judge was confirmed by ${job.reviewer ?? 'the reviewer'}`;
  return `${checked}; ${person}.`;
}

function notes(review: number): string[] {
  const out = [
    `Under E205.4 of the Revised Section 508 Standards, non-web documents are not required to meet ${[
      ...DOCUMENT_EXEMPT,
    ]
      .map(labelFor)
      .join('; ')}. Those criteria are reported as Not Applicable.`,
    'Supports, Partially Supports, Does Not Support and Not Applicable are the conformance terms of the VPAT 2 template.',
  ];
  if (review > 0) {
    out.push(
      `Needs Review is not a conformance term. It marks a criterion this report does not yet vouch for, and ${review} ${
        review === 1 ? 'remains' : 'remain'
      } outstanding. A statement is not a deliverable until every one of them has been confirmed by a named reviewer.`,
    );
  }
  return out;
}

/** What the criterion is, for a reader who does not have the standard open. */
export function criterionName(id: string): string {
  return criterionById(id)?.name ?? id;
}
