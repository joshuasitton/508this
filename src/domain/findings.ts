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

import { appliesTo, labelFor, type ContentKind, criteriaFor } from './criteria';

export type Severity =
  /** The document fails the criterion outright – e.g. a scanned PDF with no text layer. */
  | 'blocking'
  /** The criterion is mostly met and this is a gap – e.g. one image among many missing alt text. */
  | 'partial';

export interface Finding {
  /** WCAG 2.0 criterion id from `criteria.ts`. */
  criterion: string;
  /** Where in the document, in the customer's terms: "page 3", "slide 12", "table 2, row 4". */
  location: string;
  /** What is wrong, as a sentence a non-specialist can act on. */
  description: string;
  severity: Severity;
  /** True once the fix has been made in the delivered document. */
  remediated: boolean;
}

export type Status = 'Supports' | 'Partially Supports' | 'Does Not Support' | 'Not Applicable';

export interface Assessment {
  criterion: string;
  status: Status;
  /** Open findings that produced the status. Empty when it Supports or is Not Applicable. */
  open: Finding[];
}

export function openFindings(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => !f.remediated);
}

/**
 * Status for one criterion. Remediated findings do not count against it – the
 * report describes the document we deliver, not the one we received. A
 * criterion the standard exempts for this kind of content is Not Applicable
 * regardless of findings, so a mis-filed finding cannot fail a document on a
 * criterion it does not owe.
 */
export function assess(criterionId: string, findings: readonly Finding[], kind: ContentKind): Assessment {
  if (!appliesTo(criterionId, kind)) {
    return { criterion: criterionId, status: 'Not Applicable', open: [] };
  }
  const open = openFindings(findings).filter((f) => f.criterion === criterionId);
  if (open.length === 0) return { criterion: criterionId, status: 'Supports', open };
  const status: Status = open.some((f) => f.severity === 'blocking') ? 'Does Not Support' : 'Partially Supports';
  return { criterion: criterionId, status, open };
}

/** One assessment per criterion in the catalogue, in catalogue order. */
export function assessAll(findings: readonly Finding[], kind: ContentKind): Assessment[] {
  return criteriaFor('web').map((c) => assess(c.id, findings, kind));
}

/** A document conforms when nothing it owes is open. */
export function conforms(findings: readonly Finding[], kind: ContentKind): boolean {
  return assessAll(findings, kind).every((a) => a.status === 'Supports' || a.status === 'Not Applicable');
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

/** The sentence that goes in the report's Remarks column. One place. */
export function describeAssessment(a: Assessment): string {
  const label = labelFor(a.criterion);
  switch (a.status) {
    case 'Supports':
      return `${label}: no open issues.`;
    case 'Not Applicable':
      return `${label}: not required for this content under E205.4.`;
    case 'Partially Supports':
    case 'Does Not Support': {
      const n = a.open.length;
      const where = a.open.map((f) => f.location).join(', ');
      return `${label}: ${n} open ${n === 1 ? 'issue' : 'issues'} (${where}).`;
    }
  }
}

/** The sentence that names a finding to a person: what, where, and whether it is done. */
export function describeFinding(f: Finding): string {
  const state = f.remediated ? 'Fixed' : f.severity === 'blocking' ? 'Blocking' : 'Open';
  return `${state} – ${labelFor(f.criterion)}, ${f.location}: ${f.description}`;
}
