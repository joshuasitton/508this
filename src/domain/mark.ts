/**
 * The 508This mark, as geometry.
 *
 * One source of truth, because this shape has to exist in three places that
 * cannot import each other: the favicon (a static `.svg` Next serves), the
 * site header (inline SVG in a React tree), and the conformance statement
 * (a raster embedded in a .docx, which is the only one of the three a
 * federal buyer ever files). A logo defined three times is a logo that drifts,
 * and `__tests__/mark.test.ts` pins the generated files to what is here.
 *
 * Two constraints shaped it, both from the design round-table:
 *
 * **It is drawn, not typeset.** The digits are arcs and lines rather than
 * glyphs, so the mark does not depend on a font being installed — not on the
 * visitor's machine, not on the build container, and not inside a Word
 * document being opened on a computer nobody here controls.
 *
 * **It is one colour.** A tile with the number knocked out of it, so the same
 * artwork survives a monochrome office laser, which is where the statement
 * usually ends up.
 */

/** The mark is square. Everything below is in this coordinate space. */
export const VIEWBOX = 64;

/** The rounded tile the number sits in. */
export const TILE_RADIUS = 13;

/*
 * Each digit is drawn in a 12 × 22 box, scaled, and then placed. The scale is
 * what decides how much of the tile the number fills, and it was set by
 * looking at the mark at 16px: smaller digits left the favicon a plain navy
 * square, which is a tile rather than a mark.
 */
const BOX_W = 12;
const BOX_H = 22;
const SCALE = 1.2;
const GAP = 3.6;

/** Stroke width of the digits, scaled with them so the weight holds. */
export const STROKE = round1(2.9 * SCALE);

const ROW_W = 3 * BOX_W * SCALE + 2 * GAP;
const LEFT = round1((VIEWBOX - ROW_W) / 2);
const TOP = round1((VIEWBOX - BOX_H * SCALE) / 2);

/** Where each digit's box starts, left to right. */
export const DIGIT_ORIGINS: readonly (readonly [number, number])[] = [
  [LEFT, TOP],
  [round1(LEFT + BOX_W * SCALE + GAP), TOP],
  [round1(LEFT + 2 * (BOX_W * SCALE + GAP)), TOP],
];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The three digits, in local coordinates within a 12 × 22 box.
 *
 * "5" is the only one that is not made of circles: a bar, a stem, and a bowl
 * that opens to the left, which is what keeps it from reading as an "S".
 */
export const DIGIT_PATHS: readonly string[] = [
  // 5
  'M 10.1 1.9 H 2.5 V 9.1 H 5.7 A 5.5 5.5 0 1 1 2.2 18.7',
  // 0
  'M 6 1.9 A 4.4 9.1 0 0 1 6 20.1 A 4.4 9.1 0 0 1 6 1.9 Z',
  // 8
  'M 6 1.9 A 3.5 3.5 0 0 1 6 8.9 A 3.5 3.5 0 0 1 6 1.9 Z M 6 8.9 A 5.6 5.6 0 0 1 6 20.1 A 5.6 5.6 0 0 1 6 8.9 Z',
];

/** The digits as one path, already translated — what both renderers draw. */
export function digitsPath(): string {
  return DIGIT_PATHS.map((d, i) => place(d, DIGIT_ORIGINS[i]![0], DIGIT_ORIGINS[i]![1])).join(' ');
}

/**
 * Scale a path about its own origin and move it into place, walking the
 * commands rather than treating the string as a list of numbers: an arc
 * carries radii and flags, and the flags must not be scaled or shifted.
 */
function place(d: string, dx: number, dy: number): string {
  const out: string[] = [];
  const tokens = d.split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i]!;
    i += 1;
    out.push(cmd);
    if (cmd === 'M' || cmd === 'L') {
      out.push(round(Number(tokens[i]!) * SCALE + dx), round(Number(tokens[i + 1]!) * SCALE + dy));
      i += 2;
    } else if (cmd === 'H') {
      out.push(round(Number(tokens[i]!) * SCALE + dx));
      i += 1;
    } else if (cmd === 'V') {
      out.push(round(Number(tokens[i]!) * SCALE + dy));
      i += 1;
    } else if (cmd === 'A') {
      // rx ry rotation large-arc sweep x y — the radii scale, the flags do not.
      out.push(round(Number(tokens[i]!) * SCALE), round(Number(tokens[i + 1]!) * SCALE));
      out.push(tokens[i + 2]!, tokens[i + 3]!, tokens[i + 4]!);
      out.push(round(Number(tokens[i + 5]!) * SCALE + dx), round(Number(tokens[i + 6]!) * SCALE + dy));
      i += 7;
    }
  }
  return out.join(' ');
}

/** Two decimals at most, and no trailing zeros: path data nobody has to squint at. */
function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * The whole mark as an SVG document.
 *
 * `tile` paints the square and `ink` draws the number. Passing both in is what
 * lets the same geometry be navy-on-transparent for the web and black-on-white
 * for a document, without a second definition of the shape.
 */
export function markSvg(tile: string, ink: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" width="${VIEWBOX}" height="${VIEWBOX}" role="img" aria-label="508This">` +
    `<rect width="${VIEWBOX}" height="${VIEWBOX}" rx="${TILE_RADIUS}" fill="${tile}"/>` +
    `<path d="${digitsPath()}" fill="none" stroke="${ink}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"/>` +
    '</svg>'
  );
}
