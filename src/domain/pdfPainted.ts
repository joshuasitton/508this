/**
 * Two criteria a PDF could not answer before there was a renderer.
 *
 * 1.4.3 Contrast and 3.1.2 Language of Parts are both **checked** on the
 * Word path and were both **reviewer** on the PDF one. The difference was
 * never the standard; it was that a .docx says `<w:color w:val="767171"/>`
 * and a PDF paints. Word hands you the colour; a PDF hands you an operator
 * that set the fill before some glyphs were drawn, and the background is
 * whatever was painted underneath.
 *
 * The renderer taken on 22 September changed that. A page can be
 * rasterised, and the colour of ink on paper is then a question about
 * pixels. The arithmetic was already here and already tested —
 * `contrast.ts` is pure and knows nothing about formats — so what was
 * missing was only the sampling.
 *
 * **Nothing leaves the machine for either check.** Language detection is
 * local n-grams in `language.ts`, and contrast is pixel arithmetic. Neither
 * involves a vendor, which is why both work on a document marked CUI —
 * unlike the drafting of alternative text, which cannot.
 *
 * ## Uncertainty is a finding, not a silent pass
 *
 * The value of a conformance statement is that "checked" means checked. A
 * heuristic that is right most of the time and quietly says Supports for
 * the rest launders a guess into a claim the customer is selling onward.
 *
 * So everything here escalates. A run whose background is not one solid
 * colour cannot be measured honestly, and becomes a finding that says so
 * and goes to the reviewer. The criterion is then still fairly called
 * checked: every run was either measured or handed to a person, and the
 * report cannot be delivered until the person has decided.
 */

import { contrastRatio, formatRatio, isLargeText, minimumRatio, toHex, type Rgb } from './contrast';
import { detectLanguage, primarySubtag } from './language';
import { KINDS, type Kind } from './kinds';
import type { Finding, Severity } from './findings';

function finding(kind: Kind, location: string, description: string, severity: Severity): Finding {
  return { kind, criterion: KINDS[kind].criterion, location, description, severity, remediated: false };
}

const SNIPPET = 60;

/**
 * How many letters or digits a run needs before its contrast is judged.
 *
 * A PDF's text layer is full of fragments that are not text to a reader: a
 * lone full stop ending a leader line, a bullet, the stem of a rule drawn
 * with a character. Measured on a real infographic, the first thing this
 * reported was a grey “.”, which is true, useless, and exactly the sort of
 * row that teaches a reviewer to skim the queue.
 */
const ENOUGH_CHARACTERS = 2;

const readable = (text: string): boolean => (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= ENOUGH_CHARACTERS;

function snippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > SNIPPET ? `${t.slice(0, SNIPPET - 1)}…` : t;
}

/**
 * How much of the sampled area one colour has to account for before it can
 * be called "the background".
 *
 * Text covers a minority of the box it sits in, so on a plain page the
 * paper is the overwhelming majority. Below this, something else is going
 * on — a photograph, a gradient, a coloured band ending mid-line — and the
 * honest answer is that a machine did not measure it.
 */
export const SOLID_ENOUGH = 0.6;

/** One run of text on a rendered page, with the colours sampled around it. */
export interface PaintedRun {
  /** 1-based, as a reader counts them. */
  page: number;
  text: string;
  /** Point size on the page, for the large-text threshold. */
  points: number;
  bold: boolean;
  /** The ink, or null when no ink could be told from the paper. */
  foreground: Rgb | null;
  /** The paper, or null when there was no dominant colour. */
  background: Rgb | null;
  /** The share of sampled pixels the background colour accounts for, 0–1. */
  backgroundShare: number;
}

/**
 * 1.4.3 Contrast (Minimum), measured off the rendered page.
 *
 * One finding per page per colour pair rather than one per run: a document
 * with grey body text has one contrast problem, not four hundred, and a
 * queue of four hundred identical rows is a queue nobody reads.
 */
export function contrastFindings(runs: readonly PaintedRun[]): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();

  for (const run of runs) {
    const text = run.text.trim();
    if (!readable(text)) continue;

    const minimum = minimumRatio(isLargeText(run.points, run.bold));

    if (!run.foreground || !run.background || run.backgroundShare < SOLID_ENOUGH) {
      const key = `unmeasured:${run.page}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        finding(
          'contrast',
          `page ${run.page}`,
          `The contrast of “${snippet(text)}” could not be measured: it is not painted on one solid colour. ` +
            'Text over a photograph, a gradient or a coloured edge has to be judged by a person.',
          'partial',
        ),
      );
      continue;
    }

    const ratio = contrastRatio(run.foreground, run.background);
    if (ratio >= minimum) continue;

    const key = `${run.page}:${toHex(run.foreground)}:${toHex(run.background)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      finding(
        'contrast',
        `page ${run.page}`,
        `Text “${snippet(text)}” is #${toHex(run.foreground)} on #${toHex(run.background)}, ` +
          `a contrast of ${formatRatio(ratio)}; it needs ${minimum}:1.`,
        'partial',
      ),
    );
  }

  return out;
}

/** A block of text on a page, as the reader meets it. */
export interface TextBlock {
  page: number;
  text: string;
}

/**
 * 3.1.2 Language of Parts.
 *
 * `detectLanguage` needs a couple of dozen words before it will say
 * anything, which is the same bar the Word path clears — a sentence of
 * loan-words is not a passage in another language, and guessing from six
 * words produces a finding that wastes a reviewer's afternoon.
 *
 * Attribution is the part a PDF makes hard. Knowing *which* structure
 * element a passage belongs to means joining marked-content ids to the tag
 * tree, so this takes the conservative route instead: if the document marks
 * no element at all with the language that was detected, the passage is
 * certainly unmarked and that is a finding stating it. If the document does
 * mark something with that language, it may or may not be this passage —
 * and an escalation saying exactly that is worth more than a guess either
 * way.
 */
export function languageFindings(
  blocks: readonly TextBlock[],
  documentLanguage: string,
  markedLanguages: readonly string[],
): Finding[] {
  const marked = new Set(markedLanguages.map(primarySubtag).filter(Boolean));
  // `en-US` and `en` are the same language to this question, and the
  // catalogue's /Lang is usually the locale. Comparing the raw tag makes
  // every English paragraph in an en-US document look foreign — which is
  // what it did, on the first real file it saw.
  const expected = primarySubtag(documentLanguage) || documentLanguage;
  const out: Finding[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const detected = detectLanguage(block.text, expected);
    if (!detected) continue;

    const key = `${block.page}:${detected.language}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(
      finding(
        'language-parts',
        `page ${block.page}`,
        marked.has(detected.language)
          ? `A passage on this page appears to be in ${detected.name}. The document marks ${detected.name} ` +
            'somewhere, but a PDF does not say which passage carries the mark, so a person has to confirm this one does.'
          : `A passage appears to be in ${detected.name} but nothing in the document is marked as ${detected.name}, ` +
            "so it is read aloud with the document's default voice.",
        'partial',
      ),
    );
  }

  return out;
}
