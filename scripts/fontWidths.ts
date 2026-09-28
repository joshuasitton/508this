/**
 * Writes `src/domain/pdfFontWidths.ts` — how wide every character is in the
 * four Helvetica faces the PDF export sets its text in.
 *
 * The export has to break lines itself. A PDF is painting instructions, not a
 * layout engine: nothing in the file wraps a paragraph, so the writer decides
 * where every line ends, and to do that it needs the advance width of each
 * character in thousandths of an em. Those numbers are the standard-14 metrics,
 * fixed since 1985 and identical in every reader.
 *
 * **They are derived rather than typed in.** Four hundred numbers copied from
 * memory would be wrong somewhere, and a wrong width is not a crash — it is a
 * line that overruns the margin on page nine of a customer's document. pdf.js
 * is already a dependency (it renders pages for the contrast check), it carries
 * Adobe's own tables, and this reads them out of its source: the glyph metrics
 * keyed by glyph name, and the glyph list that says which character each name
 * is. Joining the two against `pdfEncode.ts` gives width by WinAnsi byte, which
 * is the form the writer actually indexes.
 *
 * Run it with `npm run widths`. The output is committed, and
 * `__tests__/pdfFontWidths.test.ts` checks it against values from the
 * published metrics, so a regenerate that read the wrong table fails there
 * rather than in a delivered document.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { winAnsiByte } from '../src/domain/pdfEncode';

const WORKER = 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';

/** The faces the export uses, and the name each has in the metrics table. */
const FACES = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'] as const;

const root = process.cwd();
const source = readFileSync(path.join(root, WORKER), 'utf8');

/**
 * The body of `function (t) { … }` that follows a marker, found by counting
 * braces rather than by matching a closing pattern: the tables are generated
 * code and contain braces of their own.
 */
function bodyAfter(marker: string): string {
  const at = source.indexOf(marker);
  if (at === -1) throw new Error(`pdf.js has no ${marker.trim()} — its source has moved`);
  const open = source.indexOf('{', at + marker.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated table after ${marker.trim()}`);
}

/** `t.name = value;` and `t["name"] = value;` pairs out of one table body. */
function entries(body: string): Map<string, number> {
  const out = new Map<string, number>();
  const pattern = /t(?:\.([A-Za-z0-9_$]+)|\[\s*"([^"]+)"\s*\])\s*=\s*(0x[0-9a-fA-F]+|-?\d+)\s*;/g;
  for (const m of body.matchAll(pattern)) {
    const name = m[1] ?? m[2];
    if (name === undefined) continue;
    out.set(name, Number(m[3]));
  }
  return out;
}

const glyphUnicode = entries(bodyAfter('const getGlyphsUnicode = getLookupTableFactory(function (t) {'));
if (glyphUnicode.size < 3000) throw new Error(`glyph list looks truncated: ${glyphUnicode.size} entries`);

/** Width by WinAnsi byte for one face, with 0 where the encoding has no character. */
function widthsFor(face: string): number[] {
  const marker =
    face === 'Helvetica'
      ? '  t.Helvetica = getLookupTableFactory(function (t) {'
      : `  t["${face}"] = getLookupTableFactory(function (t) {`;
  const metrics = entries(bodyAfter(marker));
  if (metrics.size < 200) throw new Error(`${face} metrics look truncated: ${metrics.size} entries`);

  const widths = new Array<number>(256).fill(0);
  for (const [glyph, width] of metrics) {
    const code = glyphUnicode.get(glyph);
    if (code === undefined) continue;
    const byte = winAnsiByte(String.fromCodePoint(code));
    if (byte === null) continue;
    widths[byte] = width;
  }
  return widths;
}

const tables = FACES.map((face) => [face, widthsFor(face)] as const);

/** Every byte the encoding defines has to have come out with a width. */
for (const [face, widths] of tables) {
  const missing: number[] = [];
  for (let code = 0x20; code <= 0xff; code++) {
    if (winAnsiByte(String.fromCharCode(code)) === null && !(code >= 0x80 && code <= 0x9f)) continue;
    if (widths[code] === 0 && code !== 0xad) missing.push(code);
  }
  // 0x80–0x9f are only defined where `pdfEncode` maps something into them.
  const real = missing.filter((code) => code < 0x80 || code > 0x9f);
  if (real.length) throw new Error(`${face} has no width for ${real.map((c) => `0x${c.toString(16)}`).join(', ')}`);
}

const body = tables
  .map(([face, widths]) => `  '${face}': [\n${rows(widths)}\n  ],`)
  .join('\n');

function rows(widths: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < 256; i += 16) {
    out.push(`    ${widths.slice(i, i + 16).join(', ')},`);
  }
  return out.join('\n');
}

writeFileSync(
  path.join(root, 'src/domain/pdfFontWidths.ts'),
  `/*
 * Advance widths for the four Helvetica faces, in thousandths of an em,
 * indexed by WinAnsi byte. Generated by \`npm run widths\` from the
 * standard-14 metrics pdf.js carries — do not edit by hand.
 *
 * A zero is a byte the encoding does not define. \`pdfEncode.ts\` never
 * produces one, and the writer treats it as the width of a space.
 */

export type Face = ${FACES.map((f) => `'${f}'`).join(' | ')};

export const FONT_WIDTHS: Record<Face, readonly number[]> = {
${body}
};
`,
);

console.log(`Wrote src/domain/pdfFontWidths.ts from ${WORKER}`);
for (const [face, widths] of tables) {
  console.log(`  ${face.padEnd(24)} space ${widths[0x20]}, A ${widths[0x41]}, space+A ${widths[0x20]! + widths[0x41]!}`);
}
