/**
 * The success criteria 508This remediates against — one place, pinned by a test.
 *
 * The Revised Section 508 Standards (36 CFR Part 1194, Appendix A, in force
 * since January 2018) do not define their own technical criteria for content.
 * E205.4 incorporates WCAG 2.0 Level A and Level AA by reference, so "508
 * conformant" for a document means "meets these 38 criteria". Later WCAG
 * versions add criteria; they do not change what the regulation requires, and
 * a customer who is audited is audited against this list. That is why the
 * catalogue is 2.0 and not 2.2, and why it is written out here rather than
 * fetched from anywhere.
 *
 * E205.4 also carries one exception that matters to a remediation service:
 * non-web documents are not required to meet the four "set of pages" criteria
 * (2.4.1, 2.4.5, 3.2.3, 3.2.4), because a PDF is not a site. A report that
 * marked a Word document "Does Not Support" on Bypass Blocks would be wrong,
 * and wrong in the direction that costs the customer work they do not owe.
 * `appliesTo` encodes that exception; nothing else should.
 */

export type Level = 'A' | 'AA';

export type Principle = 'Perceivable' | 'Operable' | 'Understandable' | 'Robust';

/** What kind of thing is being assessed. Decides which criteria apply. */
export type ContentKind = 'web' | 'document';

export interface Criterion {
  /** WCAG 2.0 number, e.g. "1.1.1". Unique across the catalogue. */
  id: string;
  name: string;
  level: Level;
  principle: Principle;
}

const perceivable = (id: string, name: string, level: Level): Criterion => ({
  id,
  name,
  level,
  principle: 'Perceivable',
});
const operable = (id: string, name: string, level: Level): Criterion => ({
  id,
  name,
  level,
  principle: 'Operable',
});
const understandable = (id: string, name: string, level: Level): Criterion => ({
  id,
  name,
  level,
  principle: 'Understandable',
});
const robust = (id: string, name: string, level: Level): Criterion => ({
  id,
  name,
  level,
  principle: 'Robust',
});

/** WCAG 2.0 Level A and AA, in document order. */
export const CRITERIA: readonly Criterion[] = [
  perceivable('1.1.1', 'Non-text Content', 'A'),
  perceivable('1.2.1', 'Audio-only and Video-only (Prerecorded)', 'A'),
  perceivable('1.2.2', 'Captions (Prerecorded)', 'A'),
  perceivable('1.2.3', 'Audio Description or Media Alternative (Prerecorded)', 'A'),
  perceivable('1.2.4', 'Captions (Live)', 'AA'),
  perceivable('1.2.5', 'Audio Description (Prerecorded)', 'AA'),
  perceivable('1.3.1', 'Info and Relationships', 'A'),
  perceivable('1.3.2', 'Meaningful Sequence', 'A'),
  perceivable('1.3.3', 'Sensory Characteristics', 'A'),
  perceivable('1.4.1', 'Use of Color', 'A'),
  perceivable('1.4.2', 'Audio Control', 'A'),
  perceivable('1.4.3', 'Contrast (Minimum)', 'AA'),
  perceivable('1.4.4', 'Resize text', 'AA'),
  perceivable('1.4.5', 'Images of Text', 'AA'),
  operable('2.1.1', 'Keyboard', 'A'),
  operable('2.1.2', 'No Keyboard Trap', 'A'),
  operable('2.2.1', 'Timing Adjustable', 'A'),
  operable('2.2.2', 'Pause, Stop, Hide', 'A'),
  operable('2.3.1', 'Three Flashes or Below Threshold', 'A'),
  operable('2.4.1', 'Bypass Blocks', 'A'),
  operable('2.4.2', 'Page Titled', 'A'),
  operable('2.4.3', 'Focus Order', 'A'),
  operable('2.4.4', 'Link Purpose (In Context)', 'A'),
  operable('2.4.5', 'Multiple Ways', 'AA'),
  operable('2.4.6', 'Headings and Labels', 'AA'),
  operable('2.4.7', 'Focus Visible', 'AA'),
  understandable('3.1.1', 'Language of Page', 'A'),
  understandable('3.1.2', 'Language of Parts', 'AA'),
  understandable('3.2.1', 'On Focus', 'A'),
  understandable('3.2.2', 'On Input', 'A'),
  understandable('3.2.3', 'Consistent Navigation', 'AA'),
  understandable('3.2.4', 'Consistent Identification', 'AA'),
  understandable('3.3.1', 'Error Identification', 'A'),
  understandable('3.3.2', 'Labels or Instructions', 'A'),
  understandable('3.3.3', 'Error Suggestion', 'AA'),
  understandable('3.3.4', 'Error Prevention (Legal, Financial, Data)', 'AA'),
  robust('4.1.1', 'Parsing', 'A'),
  robust('4.1.2', 'Name, Role, Value', 'A'),
];

/**
 * E205.4 Exception. These four criteria are about navigating a *set* of web
 * pages, and the standard says in so many words that non-web documents need
 * not meet them.
 */
export const DOCUMENT_EXEMPT: ReadonlySet<string> = new Set(['2.4.1', '2.4.5', '3.2.3', '3.2.4']);

const BY_ID: ReadonlyMap<string, Criterion> = new Map(CRITERIA.map((c) => [c.id, c]));

export function criterion(id: string): Criterion | undefined {
  return BY_ID.get(id);
}

export function appliesTo(id: string, kind: ContentKind): boolean {
  if (!BY_ID.has(id)) return false;
  return kind === 'web' || !DOCUMENT_EXEMPT.has(id);
}

/** The criteria a piece of content of this kind is measured against, in order. */
export function criteriaFor(kind: ContentKind): Criterion[] {
  return CRITERIA.filter((c) => appliesTo(c.id, kind));
}

/** Short form used everywhere a criterion is named to a person: "1.1.1 Non-text Content". */
export function labelFor(id: string): string {
  const c = BY_ID.get(id);
  return c ? `${c.id} ${c.name}` : id;
}
