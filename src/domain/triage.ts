/**
 * What kind of PDF is this, and what can 508This honestly promise for it?
 *
 * The question arrived the moment the Chairman said the documents would
 * mostly be PDFs. For a Word file the answer is easy — a .docx is XML and
 * nearly everything the standard asks about is readable and rewritable. A
 * PDF is four different products wearing one file extension, and which one
 * a customer has sent decides whether the service can certify their
 * document, improve it, or do nothing useful at all.
 *
 * So this is the triage, and it exists to be run over a folder of real
 * documents before any more of the roadmap is built. Guessing the mix and
 * building for the guess is how a remediation service ends up able to fix
 * the files nobody sends.
 *
 * The four tiers, worst to best:
 *
 * - **scan** – no text layer anywhere. There is nothing to tag, only
 *   pictures of words. That is OCR, which is a different product, and no
 *   amount of structure editing touches it.
 * - **untagged** – a real text layer and no tag tree. Language and title
 *   can be set; nothing else can, because tags are the only structure a PDF
 *   has and there is nothing to attach a description to. Building the tree
 *   is deciding what every mark on the page *is*, which is a person's job.
 * - **tagged** – a tag tree, but no headings in it. Alternative text can be
 *   written onto the figures. The heading structure is the gap, and it is
 *   the gap worth closing.
 * - **structured** – tagged, with headings. The file is close, and what is
 *   left is usually alternative text and a reviewer's judgement.
 *
 * Nothing here reads or reports a word of the document's contents: counts,
 * page numbers and tags only. The triage runs on the customer's own machine
 * over the customer's own folder, and it should still be true that running
 * it leaks nothing if the output is pasted somewhere.
 */

import type { Finding } from './findings';
import type { PdfFacts, StructElement } from './pdfDetect';

export type Tier = 'scan' | 'untagged' | 'tagged' | 'structured';

export const TIERS: readonly Tier[] = ['scan', 'untagged', 'tagged', 'structured'];

export interface Triage {
  tier: Tier;
  pages: number;
  figures: number;
  figuresWithoutAlt: number;
  /**
   * Raster images in the file. A figure can only be *described* by a model
   * if there are pixels to send it, and a PDF figure is only sometimes made
   * of them – artwork out of Illustrator or InDesign is vector, drawn with
   * path operators, with no image in the file at all. Figures without
   * images are the reviewer's to describe by hand, or nobody's until
   * somebody writes a renderer.
   */
  rasterImages: number;
  paragraphs: number;
  headings: number;
  tables: number;
  findings: number;
  blocking: number;
}

function flatten(elements: readonly StructElement[]): StructElement[] {
  const out: StructElement[] = [];
  const walk = (list: readonly StructElement[]) => {
    for (const e of list) {
      out.push(e);
      walk(e.kids);
    }
  };
  walk(elements);
  return out;
}

export function triagePdf(facts: PdfFacts, findings: readonly Finding[]): Triage {
  const all = flatten(facts.elements);
  const figures = all.filter((e) => e.role === 'Figure');
  const headings = all.filter((e) => /^H[1-6]$/.test(e.role) || e.role === 'H').length;
  const paragraphs = all.filter((e) => e.role === 'P').length;
  const tables = all.filter((e) => e.role === 'Table').length;

  // A scan is a file with a page count and no text on any of it. One blank
  // page in a text document must not read as a scan, so it is every page.
  const noText = facts.pages > 0 && facts.pagesWithoutText.length === facts.pages;
  const tier: Tier = noText ? 'scan' : !facts.tagged ? 'untagged' : headings > 0 ? 'structured' : 'tagged';

  return {
    tier,
    pages: facts.pages,
    figures: figures.length,
    rasterImages: facts.rasterImages,
    figuresWithoutAlt: findings.filter((f) => f.kind === 'image-alt').length,
    paragraphs,
    headings,
    tables,
    findings: findings.length,
    blocking: findings.filter((f) => f.severity === 'blocking').length,
  };
}

/**
 * What the service can truthfully say it will do for a document of this
 * tier. This is the sentence that has to appear before anybody pays, and it
 * is here rather than in the sales copy so it cannot drift from what the
 * code actually does.
 */
export function promiseFor(tier: Tier): string {
  switch (tier) {
    case 'scan':
      return 'Pictures of words, with no text layer. Nothing here can be tagged or described; this needs OCR first, which 508This does not do.';
    case 'untagged':
      return 'No tag tree. The language and title can be set, and that is all: conformance needs structure, and creating it is a person deciding what every mark on the page is. 508This cannot certify this document.';
    case 'tagged':
      return 'Tagged, with no headings. Alternative text can be written onto the figures. The missing heading structure is what stands between this file and conformance.';
    case 'structured':
      return 'Tagged, with headings. The usual gap is alternative text and the criteria only a person can confirm — the closest of the four to a document 508This can certify.';
  }
}

/**
 * Whether a vision pass could help this document at all: it has figures
 * nobody has described, and pixels to send for them.
 *
 * A document with four undescribed figures and no raster images is not a
 * smaller version of the same problem – it is a different one. Drafting its
 * descriptions means rendering vector artwork to an image first, which is a
 * PDF renderer, which is a product and not a feature.
 */
export function canDraftAltText(t: Triage): boolean {
  return t.figuresWithoutAlt > 0 && t.rasterImages > 0;
}

/** One line per tier: how many of a folder's documents landed in it. */
export function countByTier(all: readonly Triage[]): Record<Tier, number> {
  const counts = { scan: 0, untagged: 0, tagged: 0, structured: 0 };
  for (const t of all) counts[t.tier] += 1;
  return counts;
}

/**
 * The sentence the whole triage exists to produce. A service whose
 * customers mostly send untagged files and scans is not the service this
 * repository is building, and finding that out from a folder is cheaper
 * than finding it out from a customer.
 */
/**
 * The sentence for the vision pass: of the documents with figures nobody has
 * described, how many have any pixels to send. Reported separately from the
 * tier mix because it is a separate decision – the tiers say what structure
 * editing could reach, this says what drafted alternative text could.
 */
export function describeFigures(all: readonly Triage[]): string {
  const needing = all.filter((t) => t.figuresWithoutAlt > 0);
  if (needing.length === 0) return 'No document has a figure waiting for a description.';
  const draftable = needing.filter(canDraftAltText);
  const undescribed = needing.reduce((n, t) => n + t.figuresWithoutAlt, 0);
  return `${undescribed} figures across ${needing.length} ${
    needing.length === 1 ? 'document' : 'documents'
  } have no description. ${draftable.length} of those documents contain raster images a model could be shown; in the other ${
    needing.length - draftable.length
  } the artwork is vector, so there is nothing to send without rendering the page first.`;
}

export function describeMix(counts: Record<Tier, number>): string {
  const total = TIERS.reduce((n, t) => n + counts[t], 0);
  if (total === 0) return 'No PDFs were read.';
  const certifiable = counts.tagged + counts.structured;
  const share = Math.round((certifiable / total) * 100);
  return `${certifiable} of ${total} (${share}%) are tagged, so they are the ones structure editing would reach. ${
    counts.untagged
  } ${counts.untagged === 1 ? 'is' : 'are'} untagged and ${counts.scan} ${
    counts.scan === 1 ? 'is a scan' : 'are scans'
  }: for those, 508This can improve the file but cannot make it conformant, and a customer has to be told that before they pay.`;
}
