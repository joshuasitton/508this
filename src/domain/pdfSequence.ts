/**
 * 1.3.2 Meaningful Sequence: does the tagged order match the visual one?
 *
 * A PDF carries two orders. The tag tree is the order a screen reader
 * announces; the page is the order a sighted reader follows. The criterion
 * is that they agree, and a document can fail it while looking perfect —
 * which is exactly why it was a reviewer's job: somebody had to read the
 * page and then read the tags.
 *
 * Both orders are now available. The tag tree gives marked-content ids in
 * reading order; the rendered page gives each one a box. Comparing them is
 * arithmetic.
 *
 * ## Why this reports less than it could
 *
 * The naive version sorts every block top to bottom and calls any
 * difference a failure. On a two-column page that fails every correct
 * document, and a check that cries wolf on correct documents is worse than
 * no check: the reviewer learns to click past it, and then misses the real
 * one.
 *
 * So this reports two things and nothing else:
 *
 * - **An unambiguous inversion.** A block that is read later but sits
 *   *entirely above* an earlier one, clear of it by more than a line. No
 *   column model and no reading direction makes that the right order.
 * - **A page it will not judge.** More than one column of text means the
 *   visual order depends on a layout intent no machine should infer, so
 *   the page is handed to a person with the reason named.
 *
 * Everything else passes. That is the same bargain `pdfPainted.ts` makes:
 * measure what can be measured, escalate the rest, and never let a guess
 * become a claim in a statement the customer sells onward.
 */

import { KINDS, type Kind } from './kinds';
import type { Finding, Severity } from './findings';

function finding(kind: Kind, location: string, description: string, severity: Severity): Finding {
  return { kind, criterion: KINDS[kind].criterion, location, description, severity, remediated: false };
}

const SNIPPET = 40;

function snippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > SNIPPET ? `${t.slice(0, SNIPPET - 1)}…` : t;
}

/** Two letters or digits, the same bar `pdfPainted.ts` uses: a bullet is not a block. */
const readable = (text: string): boolean => (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;

/**
 * A gutter has to be this much of the page's width before it counts as
 * separating columns. Narrower than this is the space between words in a
 * ragged right margin, and treating that as a column boundary would hand
 * every page to a reviewer.
 */
export const GUTTER = 0.04;

/** And each side needs this many blocks: two boxes side by side are not columns. */
export const COLUMN_BLOCKS = 3;

/** One tagged block of text, with where it is read and where it sits. */
export interface PlacedBlock {
  /** Its position in the tag tree's reading order, ascending. */
  order: number;
  text: string;
  /** Device space, y growing downward, as the page is drawn. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PageSequence {
  page: number;
  /** The drawn width, which is what `GUTTER` is a fraction of. */
  width: number;
  blocks: PlacedBlock[];
}

/**
 * The findings for a document's reading order.
 *
 * `tagged` is separate because an untagged PDF has no reading order at all
 * rather than a wrong one — and without this it would pass, silently, for
 * want of anything to disagree with.
 */
export function sequenceFindings(pages: readonly PageSequence[], tagged: boolean): Finding[] {
  if (!tagged) {
    return [
      finding(
        'reading-order',
        'whole document',
        'The PDF is not tagged, so it has no reading order for assistive technology to follow. ' +
          'What a screen reader announces is whatever order the text happens to be painted in.',
        'blocking',
      ),
    ];
  }

  // A tagged document whose tag tree could not be matched to anything on
  // the page would otherwise pass for want of evidence, which is the one
  // way this check could quietly claim something it never tested. Some
  // producers tag in ways nothing here can join; that is a fact about the
  // file and a reviewer's job, not a pass.
  if (!pages.some((page) => page.blocks.some((block) => readable(block.text)))) {
    return [
      finding(
        'reading-order',
        'whole document',
        'The document is tagged, but none of its tags could be matched to text on the page, so the reading ' +
          'order could not be compared with the visual one. It has to be checked by a person.',
        'partial',
      ),
    ];
  }

  const out: Finding[] = [];
  for (const page of pages) {
    const blocks = page.blocks.filter((b) => readable(b.text));
    if (blocks.length < 2) continue;

    const columns = countColumns(blocks, page.width);
    if (columns > 1) {
      out.push(
        finding(
          'reading-order',
          `page ${page.page}`,
          `This page is laid out in ${columns} columns. Which order a reader follows them in is a judgement about the ` +
            'layout, not something measurable, so the tag order has to be checked against the page by a person.',
          'partial',
        ),
      );
      continue;
    }

    const inversion = firstInversion(blocks);
    if (inversion) {
      out.push(
        finding(
          'reading-order',
          `page ${page.page}`,
          `The tagged order reads “${snippet(inversion.earlier.text)}” before “${snippet(inversion.later.text)}”, ` +
            'but the second sits above the first on the page. A screen reader announces them in that order; ' +
            'somebody reading the page does not.',
          'partial',
        ),
      );
    }
  }

  return out;
}

/**
 * How many columns of text the page has.
 *
 * Horizontal spans are merged, and a gap between them wide enough to be a
 * gutter separates columns — provided each side holds enough blocks to be
 * one. A pull quote beside a paragraph is not a two-column page.
 */
export function countColumns(blocks: readonly PlacedBlock[], width: number): number {
  const spans = blocks
    .map((b) => [Math.min(b.left, b.right), Math.max(b.left, b.right)] as const)
    .sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const [left, right] of spans) {
    const last = merged.at(-1);
    if (last && left <= last[1]) last[1] = Math.max(last[1], right);
    else merged.push([left, right]);
  }

  if (merged.length < 2 || width <= 0) return 1;

  let columns = 1;
  for (let i = 1; i < merged.length; i += 1) {
    const gutter = (merged[i]![0] - merged[i - 1]![1]) / width;
    if (gutter < GUTTER) continue;
    const boundary = merged[i - 1]![1];
    const before = blocks.filter((b) => (b.left + b.right) / 2 <= boundary).length;
    const after = blocks.length - before;
    if (before >= COLUMN_BLOCKS && after >= COLUMN_BLOCKS) columns += 1;
  }
  return columns;
}

/**
 * The first block that is read after another and sits entirely above it.
 *
 * "Entirely above, clear by more than a line" is the whole test, and it is
 * deliberately strict. Two blocks that share a line, overlap, or sit a few
 * points apart are not evidence of anything — superscripts, footnote
 * markers and inline spans all look like that — and reporting them is how
 * a reviewer learns to skim.
 */
function firstInversion(blocks: readonly PlacedBlock[]): { earlier: PlacedBlock; later: PlacedBlock } | null {
  const read = [...blocks].sort((a, b) => a.order - b.order);
  const gap = lineHeight(blocks) / 2;

  let deepest: PlacedBlock | null = null;
  for (const block of read) {
    if (deepest && block.bottom < deepest.top - gap) return { earlier: deepest, later: block };
    if (!deepest || block.top > deepest.top) deepest = block;
  }
  return null;
}

/** The median block height, which is a line on this page whatever its type size. */
function lineHeight(blocks: readonly PlacedBlock[]): number {
  const heights = blocks.map((b) => Math.abs(b.bottom - b.top)).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] ?? 0;
}
