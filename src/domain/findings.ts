/**
 * A finding is one thing wrong with one place in a customer's document. The
 * remediation service's whole job is to turn findings into remediated
 * findings, and the conformance report is nothing but a summary of them.
 *
 * This module owns both the *status* a criterion gets and the *sentence* that
 * states it. They live together on purpose: an Accessibility Conformance Report
 * uses a fixed vocabulary (Supports / Partially Supports / Does Not Support /
 * Not Applicable, from the VPAT 2 template that federal buyers expect), and a
 * status computed in one file and worded in another is the kind of pair that
 * drifts. When the wording changes, the test here changes with it.
 */

import { appliesTo, coverageOf, labelFor, type ContentKind, criteriaFor } from './criteria';
import type { Kind } from './kinds';

export type Severity =
  /** The document fails the criterion outright – e.g. a scanned PDF with no text layer. */
  | 'blocking'
  /** The criterion is mostly met and this is a gap – e.g. one image among many missing alt text. */
  | 'partial';

/**
 * What a reviewer did about a finding. `apply` carries a value the fix
 * needs (alternative text, link wording) and is written into the document;
 * `decorative` marks an image as carrying no information; `dismiss` records
 * that a person looked and judged it not a failure, with the reason. A
 * dismissed finding does not count against the criterion, and the report
 * says who dismissed it and why. There is no "fixed by hand": the document
 * never leaves the service, so every change to it goes through here.
 */
export interface Decision {
  action: 'apply' | 'decorative' | 'dismiss';
  value?: string;
  note?: string;
  by: string;
  at: string;
}

export interface Finding {
  /** What kind of problem this is, in the customer's words. See `kinds.ts`. */
  kind: Kind;
  /** WCAG 2.0 criterion id from `criteria.ts`. */
  criterion: string;
  /** Where in the document, in the customer's terms: "page 3", "slide 12", "table 2, row 4". */
  location: string;
  /** What is wrong, as a sentence a non-specialist can act on. */
  description: string;
  severity: Severity;
  /** True once the fix has been made in the delivered document. */
  remediated: boolean;
  /**
   * Where in the XML the finding is, for a reviewer-supplied fix to find it
   * again: "docPr:12" for an image, "hyperlink:3" for the fourth link in
   * document order. Absent for findings nothing can apply a fix to.
   */
  anchor?: string;
  decision?: Decision;
}

export function isDismissed(f: Finding): boolean {
  return f.decision?.action === 'dismiss';
}

/** Open: not fixed in the document and not judged a non-failure by a person. */
export function isOpen(f: Finding): boolean {
  return !f.remediated && !isDismissed(f);
}

/** The key a decision is filed under. Location is part of it because a document can have the same kind of problem in ten places. */
export function findingKey(f: Finding): string {
  return `${f.kind}|${f.location}`;
}

/**
 * The four VPAT terms, plus one of our own. "Needs Review" is a criterion
 * with no findings that only a person can vouch for, before a person has.
 * It is never in a delivered report; delivery waits until every one is
 * confirmed or has a finding. It is on the job page so the customer sees
 * what is still owed and by whom.
 */
export type Status = 'Supports' | 'Partially Supports' | 'Does Not Support' | 'Not Applicable' | 'Needs Review';

export interface Assessment {
  criterion: string;
  status: Status;
  /** Open findings that produced the status. Empty when it Supports or is Not Applicable. */
  open: Finding[];
  /** Findings a reviewer judged not failures. They show in the remarks. */
  dismissed: Finding[];
}

export function openFindings(findings: readonly Finding[]): Finding[] {
  return findings.filter(isOpen);
}

/**
 * Status for one criterion. Remediated findings do not count against it – the
 * report describes the document we deliver, not the one we received. A
 * criterion the standard exempts for this kind of content is Not Applicable
 * regardless of findings, so a mis-filed finding cannot fail a document on a
 * criterion it does not owe.
 */
const NONE: ReadonlySet<string> = new Set();

export function assess(
  criterionId: string,
  findings: readonly Finding[],
  kind: ContentKind,
  confirmed: ReadonlySet<string> = NONE,
): Assessment {
  const dismissed = findings.filter((f) => f.criterion === criterionId && isDismissed(f));
  if (!appliesTo(criterionId, kind)) {
    return { criterion: criterionId, status: 'Not Applicable', open: [], dismissed };
  }
  const open = openFindings(findings).filter((f) => f.criterion === criterionId);
  if (open.length > 0) {
    const status: Status = open.some((f) => f.severity === 'blocking') ? 'Does Not Support' : 'Partially Supports';
    return { criterion: criterionId, status, open, dismissed };
  }
  const basis = coverageOf(criterionId, kind)?.coverage;
  if (basis === 'reviewer' && !confirmed.has(criterionId)) {
    return { criterion: criterionId, status: 'Needs Review', open, dismissed };
  }
  return { criterion: criterionId, status: 'Supports', open, dismissed };
}

/** One assessment per criterion in the catalogue, in catalogue order. */
export function assessAll(
  findings: readonly Finding[],
  kind: ContentKind,
  confirmed: ReadonlySet<string> = NONE,
): Assessment[] {
  return criteriaFor('web').map((c) => assess(c.id, findings, kind, confirmed));
}

/** A document conforms when nothing it owes is open and nothing waits on a reviewer. */
export function conforms(findings: readonly Finding[], kind: ContentKind, confirmed: ReadonlySet<string> = NONE): boolean {
  return assessAll(findings, kind, confirmed).every((a) => a.status === 'Supports' || a.status === 'Not Applicable');
}

export interface Progress {
  total: number;
  remediated: number;
  open: number;
  /** 0..1. A document with nothing found is complete, not undefined. */
  fraction: number;
}

export function progress(findings: readonly Finding[]): Progress {
  const total = findings.length;
  const open = openFindings(findings).length;
  const remediated = total - open;
  return { total, remediated, open, fraction: total === 0 ? 1 : remediated / total };
}

export interface Summary {
  conforms: boolean;
  /** Criteria this kind of content owes – 34 for a document, 38 for web. */
  owed: number;
  /** Owed criteria with at least one open finding. */
  short: number;
  /** Owed criteria with no findings that still wait on a reviewer. */
  review: number;
  blocking: number;
  other: number;
}

export function summarise(findings: readonly Finding[], kind: ContentKind, confirmed: ReadonlySet<string> = NONE): Summary {
  const assessments = assessAll(findings, kind, confirmed);
  const owed = assessments.filter((a) => a.status !== 'Not Applicable');
  const short = owed.filter((a) => a.status === 'Partially Supports' || a.status === 'Does Not Support');
  const review = owed.filter((a) => a.status === 'Needs Review').length;
  const open = short.flatMap((a) => a.open);
  const blocking = open.filter((f) => f.severity === 'blocking').length;
  return {
    conforms: short.length === 0 && review === 0,
    owed: owed.length,
    short: short.length,
    review,
    blocking,
    other: open.length - blocking,
  };
}

/**
 * The headline of the report, and the sentence under it. Three states, and
 * the middle one is the honest one: every automated check passes, and the
 * criteria only a person can vouch for are named as still owed rather than
 * quietly counted as met.
 */
export function describeSummary(s: Summary): { headline: string; detail: string } {
  if (s.conforms) {
    return {
      headline: 'Conforms to Section 508',
      detail: `No open issues on any of the ${s.owed} criteria this document owes, and every criterion that needs a person has been confirmed.`,
    };
  }
  if (s.short === 0) {
    return {
      headline: 'Passes every automated check',
      detail: `No open issues. ${s.review} of the ${s.owed} criteria this document owes can only be confirmed by a reviewer, and ${s.review === 1 ? 'that one is' : 'those are'} still waiting. It is not reported as conformant until they are.`,
    };
  }
  const issues = s.blocking + s.other;
  const parts: string[] = [];
  if (s.blocking > 0) parts.push(`${s.blocking} ${s.blocking === 1 ? 'is' : 'are'} blocking`);
  if (s.other > 0) parts.push(`${s.other} ${s.other === 1 ? 'is' : 'are'} partial`);
  const tail = s.review > 0 ? ` ${s.review} more ${s.review === 1 ? 'waits' : 'wait'} on a reviewer.` : '';
  return {
    headline: 'Does not conform to Section 508 yet',
    detail: `${s.short} of the ${s.owed} criteria this document owes ${s.short === 1 ? 'has' : 'have'} open issues: ${issues} in all, of which ${parts.join(' and ')}.${tail}`,
  };
}

/** The Remarks column of the report, without the criterion's name. One place. */
export function describeRemarks(a: Assessment, kind: ContentKind = 'docx'): string {
  const reviewed = a.dismissed.length
    ? ` ${a.dismissed.length} ${a.dismissed.length === 1 ? 'finding was' : 'findings were'} reviewed and judged not ${a.dismissed.length === 1 ? 'a failure' : 'failures'}${dismissedBy(a.dismissed)}.`
    : '';
  switch (a.status) {
    case 'Supports':
      return `${coverageOf(a.criterion, kind)?.remark ?? 'No open issues.'}${reviewed}`;
    case 'Needs Review':
      return `Waiting on a reviewer. ${coverageOf(a.criterion, kind)?.remark ?? ''}`.trim();
    case 'Not Applicable':
      return 'Not required for this content under E205.4.';
    case 'Partially Supports':
    case 'Does Not Support': {
      const n = a.open.length;
      const where = a.open.map((f) => f.location).join(', ');
      return `${n} open ${n === 1 ? 'issue' : 'issues'} (${where}).${reviewed}`;
    }
  }
}

function dismissedBy(dismissed: readonly Finding[]): string {
  const names = [...new Set(dismissed.map((f) => f.decision?.by).filter((n): n is string => !!n))];
  return names.length ? ` by ${names.join(', ')}` : '';
}

/** The one-line form: criterion, then its remarks. */
export function describeAssessment(a: Assessment, kind: ContentKind = 'docx'): string {
  const remarks = describeRemarks(a, kind);
  return `${labelFor(a.criterion)}: ${remarks.charAt(0).toLowerCase()}${remarks.slice(1)}`;
}

/** The word for a finding's state, everywhere it is shown. */
export function stateOf(f: Finding): 'Fixed' | 'Dismissed' | 'Blocking' | 'Open' {
  if (f.remediated) return 'Fixed';
  if (isDismissed(f)) return 'Dismissed';
  return f.severity === 'blocking' ? 'Blocking' : 'Open';
}

/** The sentence that names a finding to a person: what, where, and whether it is done. */
export function describeFinding(f: Finding): string {
  return `${stateOf(f)} – ${labelFor(f.criterion)}, ${f.location}: ${f.description}`;
}
