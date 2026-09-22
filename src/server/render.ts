/**
 * Drawing a figure that is not a picture.
 *
 * The Chairman took the rendering dependency on 22 September, on evidence:
 * three real PDFs, eighty-odd figures, **not one raster image among them**.
 * The artwork in the documents this business receives comes out of
 * Illustrator and InDesign, which means it is paths, which means the
 * drafting feature reached none of it. A renderer turns those paths into
 * pixels and the feature starts working on the files that actually arrive.
 *
 * ## The crop is the whole safety argument
 *
 * This renders **one figure**, never a page. That is not a nicety: the
 * standing rule is that one figure's image is all that ever leaves, never
 * the whole document and never its text, and a rendered page is a picture
 * of the page's text. So the figure's bounding box — which the tag tree
 * carries, and which PDF/UA requires — is what makes the dependency
 * acceptable at all. **No box, no render.** The reviewer is told, exactly
 * as they were told before this existed.
 *
 * The page is drawn shifted so the box lands at the origin of a canvas cut
 * to the box's size; everything outside falls off the edge and is never
 * composited. Text *inside* the box is drawn, and that is correct — a
 * chart's own axis labels are part of the chart.
 *
 * ## The two packages, and the one that was refused
 *
 * `pdfjs-dist` (Apache-2.0) and `@napi-rs/canvas` (MIT). MuPDF is the
 * better renderer and it is **AGPL**: linking it into a commercial service
 * means publishing the service, and buying Artifex's commercial licence is
 * a decision several sizes larger than this feature. The licence, not the
 * quality, is why it is not here.
 *
 * Both are loaded with `await import` from a file no test imports, which is
 * the same arrangement `vision.ts` has and the same reason: `npm test` runs
 * with nothing installed, and CI proves it by running the tests before it
 * installs anything.
 */

import { MAX_IMAGE_BYTES, type FigureImage, type NoImage } from '@/domain/alt';
import type { FigureBox } from '@/domain/pdfImages';

export type Rendered = { ok: true; image: FigureImage } | { ok: false; reason: NoImage };

/**
 * The long edge of what gets drawn, in pixels.
 *
 * Above about this size a vision model scales the image back down before
 * it looks at it, so anything larger is bytes and time spent to be thrown
 * away. Below it, a figure with small type in it stops being legible, and
 * an illegible figure produces a confident description of something the
 * model could not read.
 */
const LONG_EDGE = 1400;

/** Nothing renders forever; a figure that tries is a figure nobody waits for. */
const TIMEOUT_MS = 20_000;

let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;

async function library() {
  // Loaded here rather than at the top of the file: this module is reached
  // only through `await import` from the job store, and nothing a test
  // imports may take a dependency.
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/**
 * One figure, drawn, as a PNG.
 *
 * Returns rather than throws, because every caller has to say the same
 * thing to the reviewer whether the render failed or there was nothing to
 * draw: describe it yourself.
 */
export async function renderFigure(pdf: Uint8Array, where: FigureBox): Promise<Rendered> {
  try {
    return await withTimeout(draw(pdf, where), TIMEOUT_MS);
  } catch {
    // The error is not inspected and not rethrown: whatever it carries, a
    // moment ago it was carrying a customer's document.
    return { ok: false, reason: 'render-failed' };
  }
}

async function draw(pdf: Uint8Array, where: FigureBox): Promise<Rendered> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const lib = await library();

  // A copy of the bytes, because pdf.js takes ownership of the buffer it is
  // given and the caller still needs theirs — the same bytes go to the
  // detectors and the remediator.
  const task = lib.getDocument({
    data: Uint8Array.from(pdf),
    // Nothing is fetched from anywhere while rendering a customer's
    // document: no font files, no character maps, no system fonts. A
    // renderer that reaches the network on a server holding federal
    // records is a renderer that tells somebody it has them.
    useSystemFonts: false,
    useWorkerFetch: false,
    // Carry on past a malformed object rather than abandoning the page: a
    // figure that draws is better than a refusal over something elsewhere.
    stopAtErrors: false,
    verbosity: 0,
  });
  const doc = await task.promise;

  try {
    if (where.page < 1 || where.page > doc.numPages) return { ok: false, reason: 'not-found' };
    const page = await doc.getPage(where.page);

    const [x0, y0, x1, y1] = where.box;
    const scale = Math.min(LONG_EDGE / Math.abs(x1 - x0), LONG_EDGE / Math.abs(y1 - y0), 4);
    const viewport = page.getViewport({ scale });

    const [ax, ay] = viewport.convertToViewportPoint(x0, y0);
    const [bx, by] = viewport.convertToViewportPoint(x1, y1);
    const left = Math.min(ax, bx);
    const top = Math.min(ay, by);
    const width = Math.ceil(Math.abs(bx - ax));
    const height = Math.ceil(Math.abs(by - ay));
    if (width < 2 || height < 2) return { ok: false, reason: 'no-box' };

    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    // A PDF page has no background; without this a figure drawn in dark ink
    // arrives as dark ink on transparent, which renders as dark on black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    await page.render({
      // `canvas: null` is what pdf.js 6 requires when the context is passed
      // directly, which is the only option here: this canvas is a native
      // one, not a DOM element.
      canvas: null,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      // The shift that does the cropping: the rest of the page is drawn
      // outside the canvas and never composited.
      transform: [1, 0, 0, 1, -left, -top],
      // No annotations. A form field or a sticky note is not part of the
      // figure, and a comment on a federal document is exactly the sort of
      // text that must not be pixelated into an image and sent anywhere.
      annotationMode: 0,
    }).promise;

    const bytes = new Uint8Array(canvas.toBuffer('image/png'));
    if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: 'too-large' };
    return { ok: true, image: { bytes, mediaType: 'image/png' } };
  } finally {
    // pdf.js holds a worker and a heap per document. Not closing it is a
    // leak that only shows up under the load this service is built for.
    await task.destroy();
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('render timed out')), ms);
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
