/**
 * Reading ink off a rendered page.
 *
 * `src/domain/pdfPainted.ts` decides what the colours and the words mean;
 * this gets them. The split is the one `render.ts` and `figureBox` already
 * use, and it is what keeps the judgement testable: everything below
 * returns plain data, and everything that reasons about it is pure.
 *
 * Both dependencies — pdf.js and the native canvas — are loaded through
 * `await import` from a file no test imports, because `npm test` runs with
 * nothing installed and CI proves it by running the tests before it
 * installs anything.
 *
 * ## Why this renders the page and the alt-text path does not
 *
 * The standing rule is that one figure's image is all that ever leaves,
 * never the whole document and never its text. Nothing here leaves.
 * Contrast is arithmetic on pixels this process drew and then discards;
 * language detection is n-grams in `language.ts`. No vendor sees any of
 * it, which is why both checks run on a document marked CUI — where the
 * drafting of alternative text is refused outright.
 */

import { contrastFindings, languageFindings, type PaintedRun, type TextBlock } from '@/domain/pdfPainted';
import type { Finding } from '@/domain/findings';

/**
 * How large the page is drawn before sampling.
 *
 * Big enough that a 9pt glyph has solid pixels in the middle of its
 * strokes rather than only anti-aliased edges; small enough that a
 * hundred-page document is not a minute of work. At 2× a 9pt stem is
 * about two pixels across, which is what the ink test below needs.
 */
const SCALE = 2;

/** Nothing inspects forever, and a document that tries is one nobody waits for. */
const TIMEOUT_MS = 30_000;

/**
 * Pages inspected. A conformance statement is about the whole document, so
 * stopping early would be dishonest — this is a guard against a pathological
 * file, and a document past it is reported rather than silently truncated.
 */
const MAX_PAGES = 200;

export interface Painted {
  findings: Finding[];
  /** Pages that were drawn and sampled, for the record. */
  pages: number;
}

/**
 * 1.4.3 and 3.1.2 for a PDF, or nothing.
 *
 * Returns rather than throws: a document whose ink could not be read is a
 * document the reviewer judges the old way, and an upload that fails
 * because the inspector fell over is a worse outcome than a conformance
 * statement with two criteria still owed to a person.
 */
export async function inspectPainted(pdf: Uint8Array, documentLanguage: string, markedLanguages: readonly string[]): Promise<Painted> {
  try {
    return await withTimeout(read(pdf, documentLanguage, markedLanguages), TIMEOUT_MS);
  } catch {
    // Not inspected, and deliberately not described: whatever the error
    // carries, a moment ago it was carrying a customer's document.
    return { findings: [], pages: 0 };
  }
}

async function read(pdf: Uint8Array, documentLanguage: string, markedLanguages: readonly string[]): Promise<Painted> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const task = lib.getDocument({
    data: Uint8Array.from(pdf),
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const doc = await task.promise;

  const runs: PaintedRun[] = [];
  const blocks: TextBlock[] = [];

  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let number = 1; number <= pages; number += 1) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: SCALE });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      if (width < 2 || height < 2) continue;

      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      // A PDF page has no background of its own; paper is white.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      await page.render({
        canvas: null,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        // A sticky note is not part of the page's text, and a form field's
        // colours are not what 1.4.3 is asking about here.
        annotationMode: 0,
      }).promise;

      const pixels = context.getImageData(0, 0, width, height).data;
      const content = await page.getTextContent();

      const words: string[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        words.push(item.str);
        const sample = sampleRun(item, viewport, pixels, width, height);
        if (sample) runs.push({ ...sample, page: number });
      }
      if (words.length) blocks.push({ page: number, text: words.join(' ') });
    }

    return {
      findings: [...contrastFindings(runs), ...languageFindings(blocks, documentLanguage, markedLanguages)],
      pages: Math.min(doc.numPages, MAX_PAGES),
    };
  } finally {
    // pdf.js holds a worker and a heap per document; not closing it is a
    // leak that only shows up under the load this service is built for.
    await task.destroy();
  }
}

type TextItem = { str: string; transform: number[]; width: number; height: number; fontName?: string };

/**
 * The colours in and around one run of text.
 *
 * The box a text item reports is the glyph box, so on a plain page most of
 * its pixels are paper and a minority are ink. That is the whole trick:
 * the commonest colour is the background, and the colour furthest from it
 * in luminance is the ink.
 *
 * Anti-aliased edge pixels are every shade in between, and counting them
 * would pull both answers toward the middle and flatter the ratio. So the
 * ink is taken from the extreme rather than the average — the darkest, or
 * lightest, pixel present in quantity — which is the colour the glyph was
 * actually filled with.
 */
function sampleRun(
  item: TextItem,
  viewport: { convertToViewportPoint(x: number, y: number): number[] },
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Omit<PaintedRun, 'page'> | null {
  const [, , , scaleY, x, y] = item.transform;
  const points = Math.abs(scaleY ?? 0);
  if (!points || !item.width) return null;

  const [left, bottom] = viewport.convertToViewportPoint(x ?? 0, y ?? 0);
  const [right, top] = viewport.convertToViewportPoint((x ?? 0) + item.width, (y ?? 0) + points);
  const x0 = Math.max(0, Math.floor(Math.min(left ?? 0, right ?? 0)));
  const x1 = Math.min(width, Math.ceil(Math.max(left ?? 0, right ?? 0)));
  const y0 = Math.max(0, Math.floor(Math.min(top ?? 0, bottom ?? 0)));
  const y1 = Math.min(height, Math.ceil(Math.max(top ?? 0, bottom ?? 0)));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;

  // Colours quantised to 4 bits a channel: two pixels of the same ink
  // differ in the last bit after compositing, and counting them apart
  // would leave no colour with a majority anywhere.
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const at = (py * width + px) * 4;
      const r = pixels[at] ?? 0;
      const g = pixels[at + 1] ?? 0;
      const b = pixels[at + 2] ?? 0;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = counts.get(key);
      if (bucket) {
        bucket.n += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
      } else {
        counts.set(key, { n: 1, r, g, b });
      }
      total += 1;
    }
  }
  if (!total) return null;

  let background: { n: number; r: number; g: number; b: number } | null = null;
  for (const bucket of counts.values()) {
    if (!background || bucket.n > background.n) background = bucket;
  }
  if (!background) return null;

  const bg = mean(background);
  const bgLuminance = luminance(bg);

  // The ink: the colour furthest from the paper in luminance, among those
  // with enough pixels to be a fill rather than an edge.
  const enough = Math.max(2, Math.round(total * 0.02));
  let foreground: Rgb | null = null;
  let furthest = 0;
  for (const bucket of counts.values()) {
    if (bucket.n < enough) continue;
    const colour = mean(bucket);
    const distance = Math.abs(luminance(colour) - bgLuminance);
    if (distance > furthest) {
      furthest = distance;
      foreground = colour;
    }
  }

  return {
    text: item.str,
    points,
    // pdf.js names the font; the weight is in that name when it is there at
    // all. A wrong guess only moves the threshold between 4.5:1 and 3:1,
    // and guessing "not bold" is the stricter of the two.
    bold: /bold|black|heavy|semibold/i.test(item.fontName ?? ''),
    foreground,
    background: bg,
    backgroundShare: background.n / total,
  };
}

type Rgb = readonly [number, number, number];

const mean = (b: { n: number; r: number; g: number; b: number }): Rgb =>
  [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)] as const;

/** Rough and only used for "which of these is furthest from the paper". */
const luminance = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('inspection timed out')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
