/**
 * The picture a PDF figure is made of, when it is made of one at all.
 *
 * A `/Figure` structure element does not hold an image. It holds a *marked
 * content id*, and somewhere in the page's content stream is a span
 * `/P <</MCID 24>> BDC … EMC` that paints whatever the figure is. Finding
 * the picture means finding that span and looking for an image being drawn
 * inside it — `/Im3 Do`, where `Im3` resolves through the page's resources
 * to an image XObject.
 *
 * Most of the time, on the documents this service actually receives, there
 * is no such draw. The span contains path operators, because the artwork
 * came out of Illustrator or InDesign and is vector. That is reported as
 * `vector` rather than as a failure: it is the answer, and it is the reason
 * a reviewer is describing the figure by hand.
 *
 * Nothing here renders anything. Turning a vector span into pixels is a PDF
 * renderer, which is a product and not a feature.
 */

import { PdfName, PdfStream, latin1, type PdfDict, type PdfDocument, type PdfValue } from './pdf';
import type { NoImage } from './alt';

export type FigureImageSource =
  | { ok: true; stream: PdfStream }
  | { ok: false; reason: NoImage };

/** The structure element object number in an anchor like `struct:25`. */
export function structNum(anchor: string | undefined): number | null {
  if (!anchor) return null;
  const m = /^struct:(\d+)$/.exec(anchor);
  return m ? Number(m[1]) : null;
}

function contentOf(doc: PdfDocument, page: PdfDict): string {
  const contents = doc.resolve(page.get('Contents'));
  const streams = Array.isArray(contents) ? contents.map((c) => doc.resolve(c)) : [contents];
  let out = '';
  for (const s of streams) {
    if (!(s instanceof PdfStream)) continue;
    try {
      out += latin1(doc.decode(s));
    } catch {
      // An undecodable stream is not a picture we can reach.
    }
  }
  return out;
}

/**
 * Every marked content id the element claims. `/K` is a number, a marked
 * content reference dictionary, an object reference, or an array of any of
 * those — a figure assembled from several spans has several.
 */
function mcidsOf(doc: PdfDocument, element: PdfDict): number[] {
  const out: number[] = [];
  const walk = (value: PdfValue, depth: number) => {
    if (depth > 6) return;
    const v = doc.resolve(value);
    if (typeof v === 'number') {
      out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }
    if (v instanceof Map) {
      const mcid = doc.resolve(v.get('MCID'));
      if (typeof mcid === 'number') out.push(mcid);
      // A nested element's own kids are not this figure's content.
    }
  };
  walk(element.get('K') ?? null, 0);
  return out;
}

interface Token {
  at: number;
  kind: 'open' | 'close' | 'draw';
  /** The MCID for an `open`, or the XObject name for a `draw`. */
  value: string;
}

/**
 * `BDC` takes a property list either inline (`<</MCID 24>>`) or by name
 * (`/Pr3`), the latter resolved through the page's `/Properties`. Both turn
 * up in real files; InDesign writes the named form.
 */
function tokenise(content: string, properties: PdfDict | null, doc: PdfDocument): Token[] {
  const tokens: Token[] = [];
  const re = /<<([^<>]*)>>\s*BDC|\/([A-Za-z0-9#._-]+)\s+BDC|(BMC)|(EMC)|\/([A-Za-z0-9#._-]+)\s+Do/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== undefined) {
      const mcid = /\/MCID\s+(\d+)/.exec(m[1]);
      tokens.push({ at: m.index, kind: 'open', value: mcid?.[1] ?? '' });
    } else if (m[2] !== undefined) {
      let mcid = '';
      if (properties) {
        const list = doc.resolve(properties.get(m[2]));
        if (list instanceof Map) {
          const value = doc.resolve(list.get('MCID'));
          if (typeof value === 'number') mcid = String(value);
        }
      }
      tokens.push({ at: m.index, kind: 'open', value: mcid });
    } else if (m[3] !== undefined) {
      tokens.push({ at: m.index, kind: 'open', value: '' });
    } else if (m[4] !== undefined) {
      tokens.push({ at: m.index, kind: 'close', value: '' });
    } else if (m[5] !== undefined) {
      tokens.push({ at: m.index, kind: 'draw', value: m[5] });
    }
  }
  return tokens;
}

/** XObject names drawn inside the span that opens with this marked content id. */
function drawsInside(tokens: readonly Token[], mcid: number): string[] {
  const want = String(mcid);
  const names: string[] = [];
  let depth = 0;
  let inside = 0;
  for (const token of tokens) {
    if (token.kind === 'open') {
      depth += 1;
      if (inside === 0 && token.value === want) inside = depth;
    } else if (token.kind === 'close') {
      if (inside > 0 && depth === inside) inside = 0;
      depth = Math.max(0, depth - 1);
    } else if (inside > 0) {
      names.push(token.value);
    }
  }
  return names;
}

/** Resources are inheritable, so the page's own may be on an ancestor. */
function resourcesOf(doc: PdfDocument, page: PdfDict): PdfDict | null {
  let node: PdfValue = page;
  for (let depth = 0; depth < 8; depth++) {
    if (!(node instanceof Map)) break;
    const resources = doc.resolve(node.get('Resources'));
    if (resources instanceof Map) return resources;
    node = doc.resolve(node.get('Parent'));
  }
  return null;
}

/**
 * The image a figure paints, or why there is not one. `vector` is the
 * ordinary answer on design work and is not an error.
 */
export function figureImage(doc: PdfDocument, anchor: string | undefined): FigureImageSource {
  const num = structNum(anchor);
  if (num === null) return { ok: false, reason: 'no-anchor' };

  const element = doc.get(num);
  if (!(element instanceof Map)) return { ok: false, reason: 'not-found' };

  const page = doc.resolve(element.get('Pg'));
  if (!(page instanceof Map)) return { ok: false, reason: 'not-found' };

  const mcids = mcidsOf(doc, element);
  if (mcids.length === 0) return { ok: false, reason: 'not-found' };

  const resources = resourcesOf(doc, page);
  const properties = resources && doc.resolve(resources.get('Properties')) instanceof Map
    ? (doc.resolve(resources.get('Properties')) as PdfDict)
    : null;
  const xobjects = resources ? doc.resolve(resources.get('XObject')) : null;

  const tokens = tokenise(contentOf(doc, page), properties, doc);
  const names = mcids.flatMap((mcid) => drawsInside(tokens, mcid));
  if (names.length === 0) return { ok: false, reason: 'vector' };
  if (!(xobjects instanceof Map)) return { ok: false, reason: 'not-found' };

  for (const name of names) {
    const stream = doc.resolve(xobjects.get(name));
    if (!(stream instanceof PdfStream)) continue;
    const subtype = stream.dict.get('Subtype');
    if (subtype instanceof PdfName && subtype.name === 'Image') return { ok: true, stream };
  }
  // A span that draws only form XObjects is still vector artwork, one
  // indirection further away.
  return { ok: false, reason: 'vector' };
}
