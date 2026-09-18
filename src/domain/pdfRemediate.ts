/**
 * Remediation for PDFs: what can be fixed correctly without a person.
 *
 * The same rule as the Word remediator. A fix belongs here only when it has
 * one right answer that re-detection can verify afterwards, and the list is
 * shorter for a PDF than for a `.docx` because a PDF's structure is a
 * parallel tree rather than the document itself.
 *
 * What is here: the document language, the title, and the flag that tells a
 * reader to display the title. Three entries in two dictionaries, each with
 * exactly one correct value, and together they are most of what a tagged
 * PDF out of InDesign is missing.
 *
 * What is deliberately not here, and will not be: building a tag tree for
 * an untagged file. That is not a fix with one right answer – it is
 * deciding what every mark on the page *is*, in what order a person reads
 * them, and no rule produces that from vector artwork. It goes to a
 * reviewer, and the plainest sign that this line is drawn in the right
 * place is that the logo sheet gets its language and its title set and is
 * still, correctly, reported as not conforming.
 *
 * Alternative text a reviewer writes is applied here too, by the structure
 * element's own object number, which is why the detector records one.
 */

import type { Finding } from './findings';
import type { Applied } from './job';
import { PdfName, PdfRef, pdfText, type PdfDict, type PdfDocument, type PdfValue } from './pdf';
import { pdfString, type PdfEdit } from './pdfWrite';
import { readPdfFacts } from './pdfDetect';

export interface PdfRemediationOptions {
  /** Used for the title when the document has none of its own. */
  fallbackTitle: string;
  /** BCP 47, e.g. "en-US". */
  language?: string;
}

export interface PdfRemediation {
  edits: PdfEdit[];
  /** Entries the new trailer needs, when a file had no /Info to change. */
  trailerExtras: Map<string, PdfValue>;
  applied: Applied[];
}

/** The finding kinds this module fixes without a person. */
export const PDF_FIXABLE_KINDS: ReadonlySet<string> = new Set(['no-language', 'no-title', 'pdf-title-not-shown']);

function cloneDict(value: PdfValue): PdfDict {
  return value instanceof Map ? new Map(value) : new Map();
}

export function remediatePdf(doc: PdfDocument, options: PdfRemediationOptions): PdfRemediation {
  const applied: Applied[] = [];
  const edits = new Map<number, PdfValue>();
  const trailerExtras = new Map<string, PdfValue>();
  const facts = readPdfFacts(doc);

  const rootRef = doc.trailer.get('Root');
  const catalogNum = rootRef instanceof PdfRef ? rootRef.num : -1;
  // Edits accumulate on one copy of the catalogue, so two fixes to it do
  // not write two objects and lose one another.
  const catalog = cloneDict(doc.catalog);
  let catalogChanged = false;

  // 3.1.1 – a document language.
  if (!facts.language && catalogNum >= 0) {
    const language = options.language ?? 'en-US';
    catalog.set('Lang', pdfString(language));
    catalogChanged = true;
    applied.push({
      kind: 'no-language',
      location: 'document catalogue',
      description: `Set the document language to ${language}.`,
    });
  }

  // 2.4.2 – a title, and a reader told to show it.
  const title = facts.title || options.fallbackTitle.replace(/\s+/g, ' ').trim();
  const infoRef = doc.trailer.get('Info');
  if (!facts.title && title) {
    const infoNum = infoRef instanceof PdfRef ? infoRef.num : doc.size;
    const info = cloneDict(doc.resolve(infoRef));
    info.set('Title', pdfString(title));
    edits.set(infoNum, info);
    if (!(infoRef instanceof PdfRef)) trailerExtras.set('Info', new PdfRef(infoNum, 0));
    applied.push({
      kind: 'no-title',
      location: 'document properties',
      description: `Set the title to “${title}”, from the filename.`,
    });
  }
  if (!facts.displayDocTitle && catalogNum >= 0) {
    const prefs = cloneDict(doc.at(doc.catalog, 'ViewerPreferences'));
    prefs.set('DisplayDocTitle', true);
    catalog.set('ViewerPreferences', prefs);
    catalogChanged = true;
    applied.push({
      kind: 'pdf-title-not-shown',
      location: 'document properties',
      description: 'Set the document to display its title, so readers show it instead of the filename.',
    });
  }

  if (catalogChanged) edits.set(catalogNum, catalog);
  return { edits: [...edits].map(([num, value]) => ({ num, value })), trailerExtras, applied };
}

/**
 * A reviewer's alternative text, written onto the figure's own structure
 * element. The element is found by the object number the detector recorded
 * on the finding, never by counting figures again: automatic remediation
 * may have run first, and the object number is the one thing it does not
 * move.
 */
export function applyPdfDecisions(doc: PdfDocument, findings: readonly Finding[]): PdfRemediation {
  const applied: Applied[] = [];
  const edits: PdfEdit[] = [];
  for (const f of findings) {
    const d = f.decision;
    if (!d || d.action === 'dismiss' || f.kind !== 'image-alt') continue;
    if (!f.anchor?.startsWith('struct:')) continue;
    const num = Number(f.anchor.slice('struct:'.length));
    const element = doc.get(num);
    if (!(element instanceof Map)) continue;
    const updated = new Map(element);
    if (d.action === 'decorative') {
      // A PDF marks a decorative figure by taking it out of the tag tree
      // entirely, which is a change to its parent, not to it. Until that is
      // built, the honest thing is an empty description, which readers
      // announce as nothing.
      updated.set('Alt', pdfString(''));
      applied.push({
        kind: f.kind,
        location: f.location,
        description: `Marked the figure decorative, on ${d.by}’s decision.`,
      });
    } else if (d.action === 'apply' && d.value?.trim()) {
      updated.set('Alt', pdfString(d.value.trim()));
      applied.push({
        kind: f.kind,
        location: f.location,
        description: `Set the alternative text to “${d.value.trim()}”, as written by ${d.by}.`,
      });
    } else {
      continue;
    }
    edits.push({ num, value: updated });
  }
  return { edits, trailerExtras: new Map(), applied };
}

/** Whether the document already reports this language, for a test to read. */
export function languageOf(doc: PdfDocument): string {
  return pdfText(doc.at(doc.catalog, 'Lang')).trim();
}

export { PdfName };
