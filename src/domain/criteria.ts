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

/**
 * What is being assessed. It decides two things: which criteria apply at all
 * (E205.4 exempts non-web documents from four of them) and, for a document,
 * what the service is able to check by machine. Those differ by format – a
 * .docx says its text colour in an attribute, a PDF says it in a content
 * stream nobody here interprets – so the format is part of the kind.
 */
export type ContentKind = 'web' | 'docx' | 'pdf';

export function isDocument(kind: ContentKind): boolean {
  return kind !== 'web';
}

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

/**
 * How 508This knows a document meets a criterion. This is the honesty line
 * in the report. A criterion with no findings is not thereby met; it is met
 * if a check looked and found nothing, or if a static document has nothing
 * the criterion governs, or if a person looked. Anything else is "Needs
 * Review" in the report, never "Supports", because a buyer reads Supports
 * as a claim and the claim has to have a basis.
 *
 * - checked: an automated check covers it, in `docx.ts` or `pdfDetect.ts`.
 * - static: a Word document with no interactive or time-based content has
 *   nothing this criterion governs. The detector emits a finding if it sees
 *   media or form fields, which moves the criterion out of this class for
 *   that document.
 * - reviewer: only a person can tell. Colour as the only signal, sensory
 *   instructions, images of text, whether headings describe their sections.
 *
 * The three classes are not the same for every format, and pretending they
 * were would be the same lie as saying "Supports" on nothing. A .docx names
 * its text colour in an attribute, so contrast is checked; a PDF paints text
 * with operators in a content stream, and short of interpreting the whole
 * graphics state nothing here can measure it, so for a PDF contrast is a
 * reviewer's job and the report says so. Seven criteria need a person for a
 * PDF against four for a Word file, and that is the honest count, not a
 * defect to be papered over.
 */
export type Coverage = 'checked' | 'static' | 'reviewer';

export interface CoverageInfo {
  coverage: Coverage;
  /** The remark the report carries when the criterion is met on this basis. */
  remark: string;
}

const STATIC_INTERACTIVE = 'A static document has no interactive content this criterion governs.';
const STATIC_MEDIA = 'The document contains no audio or video.';
const STATIC_FORMS = 'The document contains no form fields.';

export const WORD_COVERAGE: Record<string, CoverageInfo> = {
  '1.1.1': { coverage: 'checked', remark: 'Every image has alternative text or is marked decorative.' },
  '1.2.1': { coverage: 'static', remark: STATIC_MEDIA },
  '1.2.2': { coverage: 'static', remark: STATIC_MEDIA },
  '1.2.3': { coverage: 'static', remark: STATIC_MEDIA },
  '1.2.4': { coverage: 'static', remark: STATIC_MEDIA },
  '1.2.5': { coverage: 'static', remark: STATIC_MEDIA },
  '1.3.1': { coverage: 'checked', remark: 'Headings run in order and every table has a header row.' },
  '1.3.2': { coverage: 'checked', remark: 'Text flows in document order: no floating text boxes, frames or layout tables.' },
  '1.3.3': { coverage: 'reviewer', remark: 'A reviewer confirms no instruction relies on shape, size, position or sound alone; the screen flags every sentence that names one.' },
  '1.4.1': { coverage: 'reviewer', remark: 'A reviewer confirms colour is never the only way information is conveyed; the screen flags colour words in instructions, colour-only emphasis and charts.' },
  '1.4.2': { coverage: 'static', remark: STATIC_MEDIA },
  '1.4.3': { coverage: 'checked', remark: 'Every coloured run meets the minimum contrast against its background.' },
  '1.4.4': { coverage: 'static', remark: 'Word documents scale text without loss of content.' },
  '1.4.5': { coverage: 'reviewer', remark: 'A reviewer confirms no image is used in place of text.' },
  '2.1.1': { coverage: 'static', remark: STATIC_INTERACTIVE },
  '2.1.2': { coverage: 'static', remark: STATIC_INTERACTIVE },
  '2.2.1': { coverage: 'static', remark: STATIC_INTERACTIVE },
  '2.2.2': { coverage: 'static', remark: 'The document contains no moving or auto-updating content.' },
  '2.3.1': { coverage: 'static', remark: 'The document contains no flashing content.' },
  '2.4.1': { coverage: 'static', remark: 'Not required for documents.' },
  '2.4.2': { coverage: 'checked', remark: 'The document has a title.' },
  '2.4.3': { coverage: 'static', remark: STATIC_INTERACTIVE },
  '2.4.4': { coverage: 'checked', remark: 'Every link’s text says where it goes.' },
  '2.4.5': { coverage: 'static', remark: 'Not required for documents.' },
  '2.4.6': { coverage: 'reviewer', remark: 'A reviewer confirms headings describe their sections.' },
  '2.4.7': { coverage: 'static', remark: STATIC_INTERACTIVE },
  '3.1.1': { coverage: 'checked', remark: 'The document declares its language.' },
  '3.1.2': { coverage: 'checked', remark: 'Passages in another language are marked with their language.' },
  '3.2.1': { coverage: 'static', remark: STATIC_INTERACTIVE },
  '3.2.2': { coverage: 'static', remark: STATIC_FORMS },
  '3.2.3': { coverage: 'static', remark: 'Not required for documents.' },
  '3.2.4': { coverage: 'static', remark: 'Not required for documents.' },
  '3.3.1': { coverage: 'static', remark: STATIC_FORMS },
  '3.3.2': { coverage: 'static', remark: STATIC_FORMS },
  '3.3.3': { coverage: 'static', remark: STATIC_FORMS },
  '3.3.4': { coverage: 'static', remark: STATIC_FORMS },
  '4.1.1': { coverage: 'checked', remark: 'The document’s XML parsed without error.' },
  '4.1.2': { coverage: 'static', remark: STATIC_FORMS },
};

const PDF_STATIC_INTERACTIVE = 'A static PDF has no interactive content this criterion governs.';
const PDF_MEDIA = 'The PDF embeds no audio or video.';
const PDF_FORMS = 'The PDF has no form fields.';

export const PDF_COVERAGE: Record<string, CoverageInfo> = {
  '1.1.1': { coverage: 'checked', remark: 'Every figure in the tag tree carries alternative text.' },
  '1.2.1': { coverage: 'static', remark: PDF_MEDIA },
  '1.2.2': { coverage: 'static', remark: PDF_MEDIA },
  '1.2.3': { coverage: 'static', remark: PDF_MEDIA },
  '1.2.4': { coverage: 'static', remark: PDF_MEDIA },
  '1.2.5': { coverage: 'static', remark: PDF_MEDIA },
  '1.3.1': { coverage: 'checked', remark: 'The PDF is tagged, its headings run in order and its tables have header cells.' },
  '1.3.2': { coverage: 'reviewer', remark: 'A reviewer confirms the tag order matches the visual order of the page.' },
  '1.3.3': { coverage: 'reviewer', remark: 'A reviewer confirms no instruction relies on shape, size, position or sound alone.' },
  '1.4.1': { coverage: 'reviewer', remark: 'A reviewer confirms colour is never the only way information is conveyed.' },
  '1.4.2': { coverage: 'static', remark: PDF_MEDIA },
  '1.4.3': {
    coverage: 'checked',
    remark:
      'Every run of text is measured against the colour painted behind it, off the rendered page. Text on a photograph, a gradient or a coloured edge is not measured but reported, for a person to judge.',
  },
  '1.4.4': { coverage: 'static', remark: 'The PDF has a real text layer, which reflows and scales in a reader.' },
  '1.4.5': { coverage: 'reviewer', remark: 'A reviewer confirms no image is used in place of text.' },
  '2.1.1': { coverage: 'static', remark: PDF_STATIC_INTERACTIVE },
  '2.1.2': { coverage: 'static', remark: PDF_STATIC_INTERACTIVE },
  '2.2.1': { coverage: 'static', remark: PDF_STATIC_INTERACTIVE },
  '2.2.2': { coverage: 'static', remark: 'The PDF has no moving or auto-updating content.' },
  '2.3.1': { coverage: 'static', remark: 'The PDF has no flashing content.' },
  '2.4.1': { coverage: 'static', remark: 'Not required for documents.' },
  '2.4.2': { coverage: 'checked', remark: 'The PDF has a title and is set to show it in the window.' },
  '2.4.3': { coverage: 'static', remark: PDF_STATIC_INTERACTIVE },
  '2.4.4': { coverage: 'checked', remark: 'Every link says where it goes.' },
  '2.4.5': { coverage: 'static', remark: 'Not required for documents.' },
  '2.4.6': { coverage: 'reviewer', remark: 'A reviewer confirms headings describe their sections.' },
  '2.4.7': { coverage: 'static', remark: PDF_STATIC_INTERACTIVE },
  '3.1.1': { coverage: 'checked', remark: 'The PDF declares its language.' },
  '3.1.2': {
    coverage: 'checked',
    remark: 'Each page is read for passages in another language, and checked against the languages the document marks.',
  },
  '3.2.1': { coverage: 'static', remark: PDF_STATIC_INTERACTIVE },
  '3.2.2': { coverage: 'static', remark: PDF_FORMS },
  '3.2.3': { coverage: 'static', remark: 'Not required for documents.' },
  '3.2.4': { coverage: 'static', remark: 'Not required for documents.' },
  '3.3.1': { coverage: 'static', remark: PDF_FORMS },
  '3.3.2': { coverage: 'static', remark: PDF_FORMS },
  '3.3.3': { coverage: 'static', remark: PDF_FORMS },
  '3.3.4': { coverage: 'static', remark: PDF_FORMS },
  '4.1.1': { coverage: 'checked', remark: 'The PDF\u2019s structure parsed without error.' },
  '4.1.2': { coverage: 'static', remark: PDF_FORMS },
};

export const COVERAGE: Record<Exclude<ContentKind, 'web'>, Record<string, CoverageInfo>> = {
  docx: WORD_COVERAGE,
  pdf: PDF_COVERAGE,
};

export function coverageOf(id: string, kind: ContentKind = 'docx'): CoverageInfo | undefined {
  if (kind === 'web') return undefined;
  return COVERAGE[kind][id];
}

/** Short form used everywhere a criterion is named to a person: "1.1.1 Non-text Content". */
export function labelFor(id: string): string {
  const c = BY_ID.get(id);
  return c ? `${c.id} ${c.name}` : id;
}
