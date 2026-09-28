/**
 * The tagged PDF export, from a remediated .docx to bytes.
 *
 * `domain/docxFlow.ts` reads the document into blocks and `domain/pdfBuild.ts`
 * sets them; this file does the two things neither may do — open the archive,
 * and turn a picture into something a PDF can hold — and then checks the result
 * with the same detector the service checks a customer's PDF with.
 *
 * ## Why nothing here is imported at the top of anything
 *
 * It reaches `@napi-rs/canvas`, which is an npm dependency, and `npm test` runs
 * with nothing installed. So this module is loaded through `await import` from
 * `jobs.ts`, the same way `render.ts` and `vision.ts` are, and no test imports
 * it. CI proves the rule by running the tests before it installs anything.
 *
 * ## Pictures
 *
 * A baseline JPEG is handed over untouched: its bytes *are* a PDF image stream
 * under `/DCTDecode`, so the customer's photograph is not recompressed and the
 * file stays small. Everything else — PNG, GIF, WebP, a progressive or CMYK
 * JPEG — is decoded to samples and deflated, which is lossless and needs no
 * format-specific code here.
 *
 * A picture that cannot be decoded at all is the interesting case, and the
 * answer depends on what the document says it is. **A decorative one is
 * dropped**: the customer declared that it carries no information, and taking
 * them at their word is the whole point of the declaration. **Anything else
 * refuses the export**, by name, because a figure quietly missing from a
 * delivered document is exactly the kind of silent loss this service exists
 * not to commit. Word embeds EMF and WMF metafiles that nothing here can read,
 * and the honest answer for those documents is Word's own "Save as PDF".
 */

import { deflateSync } from 'node:zlib';

import { detectPdf } from '@/domain/pdfDetect';
import { flowOfDocx } from '@/domain/docxFlow';
import { buildPdf, type Block, type EmbeddedImage } from '@/domain/pdfBuild';
import { readDocxPart, readDocxParts } from './docx';
import { readPdf } from './pdf';
import { readPdfFacts, readingOrder } from '@/domain/pdfDetect';

/** 200dpi at eight inches across: past this, a figure is bytes nobody sees. */
const MAX_PIXELS = 1600;

export type ExportResult =
  | { ok: true; bytes: Uint8Array; pages: number; criteria: string[]; rendered: boolean }
  | { ok: false; reason: 'unsupported-characters'; characters: string[] }
  | { ok: false; reason: 'unsupported-figure'; figures: string[] }
  | { ok: false; reason: 'not-a-document' };

export interface ExportOptions {
  /** Used as the PDF's title when the document has none of its own. */
  fallbackTitle: string;
  /** The job's timestamp, not the clock's, so the same job exports the same bytes. */
  now: string;
}

export async function exportPdf(docx: Uint8Array, options: ExportOptions): Promise<ExportResult> {
  let flow;
  try {
    flow = flowOfDocx(readDocxParts(docx), { fallbackTitle: options.fallbackTitle });
  } catch {
    // A file the Word reader cannot open is not a document to export. The
    // reason is deliberately not carried: a moment ago it was a customer's.
    return { ok: false, reason: 'not-a-document' };
  }

  const blocks: Block[] = [];
  const refused: string[] = [];
  for (const block of flow.blocks) {
    if (block.kind !== 'figure') {
      blocks.push(block);
      continue;
    }
    const bytes = block.part ? readDocxPart(docx, block.part) : null;
    const image = bytes ? await embeddable(bytes) : null;
    if (!image) {
      // Decorative by the customer's own declaration: nothing is lost.
      if (block.decorative) continue;
      refused.push(describeFigure(block.part, block.name));
      continue;
    }
    blocks.push({
      kind: 'figure',
      image,
      ...(block.alt ? { alt: block.alt } : {}),
      ...(block.decorative ? { decorative: true } : {}),
      ...(block.widthPt ? { widthPt: block.widthPt } : {}),
      ...(block.heightPt ? { heightPt: block.heightPt } : {}),
    });
  }
  if (refused.length) return { ok: false, reason: 'unsupported-figure', figures: [...new Set(refused)] };

  const built = buildPdf({
    title: flow.title,
    language: flow.language,
    blocks,
    now: options.now,
    producer: '508This',
  });
  if (!built.ok) return built;

  const checked = await check(built.bytes);
  return { ok: true, bytes: built.bytes, pages: built.pages, ...checked };
}

/**
 * What the exported PDF still owes, by criterion.
 *
 * The export is put through the whole PDF pipeline — the tag-tree detector and
 * the pass that renders each page for contrast, language and reading order —
 * because "we checked it" has to mean the same check a customer's own PDF gets.
 * Only the criterion numbers are returned: the findings quote the document, and
 * a second copy of the customer's words in the job record is a second thing to
 * scrub at delivery.
 */
async function check(pdf: Uint8Array): Promise<{ criteria: string[]; rendered: boolean }> {
  const doc = readPdf(pdf);
  const findings = [...detectPdf(doc)];
  const facts = readPdfFacts(doc);

  // `inspectPainted` answers an empty list both when it found nothing and when
  // it could not run — it times out rather than throwing, by design. Those are
  // not the same answer here: one is "contrast and reading order were checked",
  // the other is "they were not", and reporting the second as the first would
  // be the service claiming a check it did not make.
  let rendered = false;
  try {
    const { inspectPainted } = await import('./painted');
    const painted = await inspectPainted(pdf, {
      documentLanguage: facts.language || 'en',
      markedLanguages: facts.markedLanguages,
      reading: readingOrder(doc),
      tagged: facts.tagged,
    });
    findings.push(...painted.findings);
    rendered = painted.pages > 0;
  } catch {
    // Left as not rendered, which is what the page will say.
  }
  return { criteria: [...new Set(findings.map((f) => f.criterion))].sort(), rendered };
}

function describeFigure(part: string | undefined, name: string | undefined): string {
  const extension = part ? (part.split('.').pop() ?? '').toLowerCase() : '';
  const format = extension ? `.${extension}` : 'an unknown format';
  return name ? `${name} (${format})` : format;
}

/* ── Pictures ────────────────────────────────────────────────────────── */

async function embeddable(bytes: Uint8Array): Promise<EmbeddedImage | null> {
  const jpeg = baselineJpeg(bytes);
  if (jpeg) return jpeg;
  return decoded(bytes);
}

/**
 * A baseline JPEG, read from its own markers.
 *
 * `/DCTDecode` is JPEG, so a baseline file needs no work at all — only its
 * dimensions and how many colour channels it has, which is in the frame
 * header. A progressive frame (`SOF2`) is refused here on purpose: PDF's filter
 * is defined on baseline JPEG, some readers will not draw a progressive one,
 * and being drawn by every reader matters more than saving a decode.
 */
function baselineJpeg(bytes: Uint8Array): EmbeddedImage | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    if (length < 2) return null;
    // SOF0 and SOF1 are baseline and extended sequential; both are fine.
    if (marker === 0xc0 || marker === 0xc1) {
      const height = ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0);
      const width = ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0);
      const components = bytes[at + 9] ?? 0;
      if (width <= 0 || height <= 0) return null;
      if (components !== 1 && components !== 3) return null; // CMYK goes the long way
      return {
        width,
        height,
        data: bytes,
        filter: 'DCTDecode',
        colourSpace: components === 3 ? 'DeviceRGB' : 'DeviceGray',
      };
    }
    if (marker === 0xda) return null; // image data, and no frame header found
    at += 2 + length;
  }
  return null;
}

/**
 * Anything the canvas can open, as deflated samples.
 *
 * Alpha becomes an `/SMask`, because a logo with a transparent background
 * composited onto black would be a logo nobody can read. Large pictures are
 * scaled down: a 6000-pixel photograph in a document nobody prints at that
 * size is fifty megabytes of PDF for no visible gain.
 */
async function decoded(bytes: Uint8Array): Promise<EmbeddedImage | null> {
  try {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const image = await loadImage(Buffer.from(bytes));
    const scale = Math.min(1, MAX_PIXELS / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);

    const rgb = new Uint8Array(width * height * 3);
    const alpha = new Uint8Array(width * height);
    let transparent = false;
    for (let i = 0, to = 0; i < width * height; i += 1, to += 3) {
      rgb[to] = data[i * 4] ?? 0;
      rgb[to + 1] = data[i * 4 + 1] ?? 0;
      rgb[to + 2] = data[i * 4 + 2] ?? 0;
      const a = data[i * 4 + 3] ?? 255;
      alpha[i] = a;
      if (a !== 255) transparent = true;
    }

    return {
      width,
      height,
      data: deflate(rgb),
      filter: 'FlateDecode',
      colourSpace: 'DeviceRGB',
      ...(transparent ? { smask: { data: deflate(alpha), filter: 'FlateDecode' as const } } : {}),
    };
  } catch {
    // A metafile, a corrupt part, or a format the canvas has no decoder for.
    return null;
  }
}

function deflate(data: Uint8Array): Uint8Array {
  return new Uint8Array(deflateSync(Buffer.from(data), { level: 6 }));
}
