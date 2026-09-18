/**
 * Writing changes back into a PDF, by incremental update.
 *
 * A PDF is not rewritten to change it. The format was designed so that an
 * edit is *appended*: the original bytes stay exactly where they are, the
 * changed objects are written after them, and a new cross reference section
 * points at the new copies and chains back to the old one through `/Prev`.
 * A reader takes the newest definition of each object and never sees the
 * old.
 *
 * That is the right mechanism here for the same reason `writeDocx` overlays
 * changed parts on the original archive: everything the service did not
 * touch survives byte for byte. In a customer's PDF that is fonts, colour
 * profiles, embedded artwork and the digital provenance of a federal
 * document. Rebuilding the file to change one dictionary entry would be
 * both riskier and a worse answer to "what did you do to my document".
 *
 * The new section matches the original's kind. A file whose newest section
 * is a classic `xref` table gets a table; one written by Acrobat, whose
 * section is a cross reference *stream*, gets a stream. Mixing the two is
 * what the `/XRefStm` hybrid mechanism exists for, and guessing wrong
 * produces a file some readers call corrupt – the one outcome a remediation
 * service can never risk. Compression is passed in, as everywhere else in
 * the domain.
 */

import { PdfName, PdfRef, PdfStream, type PdfDict, type PdfDocument, type PdfValue } from './pdf';

export type Deflate = (data: Uint8Array) => Uint8Array;

export interface PdfEdit {
  /** The object number being replaced, or a fresh one being added. */
  num: number;
  value: PdfValue;
}

const encoder = new TextEncoder();

function bytes(s: string): Uint8Array {
  return encoder.encode(s);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A name, with the characters that cannot appear in one escaped. */
function serializeName(name: string): string {
  let out = '/';
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code < 0x21 || code > 0x7e || '()<>[]{}/%#'.includes(ch)) {
      out += `#${code.toString(16).padStart(2, '0')}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * A text string's *content* bytes, which is what the reader hands back and
 * therefore the one representation used everywhere: `serialize` puts the
 * delimiters on. Anything outside ASCII becomes UTF-16 big-endian with a
 * byte order mark, which is what Acrobat writes and every reader
 * understands; the alternative is guessing at PDFDocEncoding and losing an
 * accent in somebody's name.
 *
 * Returning the delimited form here instead was a real bug: `serialize`
 * wrapped it a second time and a remediated file came back with its
 * language set to "(en-US)", parentheses and all. Nothing in the test suite
 * saw it; reading the output with another library did.
 */
export function pdfString(text: string): Uint8Array {
  if (/^[\x20-\x7e\n\r\t]*$/.test(text)) return bytes(text);
  const out: number[] = [0xfe, 0xff];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const v = code - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      out.push(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
    } else {
      out.push(code >> 8, code & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Any value, back to the bytes a PDF file holds. */
export function serialize(value: PdfValue): Uint8Array {
  if (value === null) return bytes('null');
  if (value === true) return bytes('true');
  if (value === false) return bytes('false');
  if (typeof value === 'number') {
    // A PDF number is never in exponent notation.
    if (Number.isInteger(value)) return bytes(String(value));
    return bytes(value.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''));
  }
  if (value instanceof PdfName) return bytes(serializeName(value.name));
  if (value instanceof PdfRef) return bytes(`${value.num} ${value.gen} R`);
  if (value instanceof Uint8Array) {
    // A string object's content. Printable ASCII goes out as a literal;
    // anything else as hex, because a reader normalises the end-of-line
    // bytes inside a literal string and that would corrupt UTF-16 text
    // containing 0x0D.
    const printable = value.every((b) => b >= 0x20 && b <= 0x7e);
    if (!printable) {
      let hex = '';
      for (const b of value) hex += b.toString(16).padStart(2, '0');
      return bytes(`<${hex.toUpperCase()}>`);
    }
    const parts: number[] = [0x28];
    for (const b of value) {
      if (b === 0x28 || b === 0x29 || b === 0x5c) parts.push(0x5c);
      parts.push(b);
    }
    parts.push(0x29);
    return Uint8Array.from(parts);
  }
  if (Array.isArray(value)) {
    const inner = value.map(serialize);
    return concat([bytes('['), ...joinWithSpace(inner), bytes(']')]);
  }
  if (value instanceof PdfStream) {
    const dict = new Map(value.dict);
    dict.set('Length', value.raw.length);
    return concat([serialize(dict), bytes('\nstream\n'), value.raw, bytes('\nendstream')]);
  }
  // A dictionary.
  const parts: Uint8Array[] = [bytes('<<')];
  for (const [k, v] of value as PdfDict) {
    parts.push(bytes(serializeName(k)), bytes(' '), serialize(v), bytes(' '));
  }
  parts.push(bytes('>>'));
  return concat(parts);
}

function joinWithSpace(items: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  items.forEach((item, i) => {
    if (i > 0) out.push(bytes(' '));
    out.push(item);
  });
  return out;
}

/**
 * The original bytes, then the changed objects, then a new cross reference
 * pointing at them. Returns the original unchanged when there is nothing to
 * write, so a run that fixes nothing cannot alter a byte of the customer's
 * file.
 */
export function incrementalUpdate(
  doc: PdfDocument,
  edits: readonly PdfEdit[],
  deflate: Deflate,
  /** Entries to add to the new trailer, for a file that had no /Info of its own. */
  trailerExtras: ReadonlyMap<string, PdfValue> = new Map(),
): Uint8Array {
  if (edits.length === 0) return doc.bytes;

  const parts: Uint8Array[] = [doc.bytes];
  let at = doc.bytes.length;
  // An update must begin on its own line, or the appended object runs into
  // whatever the original's last byte was.
  if (doc.bytes[at - 1] !== 0x0a) {
    parts.push(bytes('\n'));
    at += 1;
  }

  const offsets = new Map<number, number>();
  const sorted = [...edits].sort((a, b) => a.num - b.num);
  for (const edit of sorted) {
    offsets.set(edit.num, at);
    const body = concat([bytes(`${edit.num} 0 obj\n`), serialize(edit.value), bytes('\nendobj\n')]);
    parts.push(body);
    at += body.length;
  }

  const highest = sorted[sorted.length - 1]!.num;
  const size = Math.max(doc.size, highest + 1 + (doc.xrefIsStream ? 1 : 0));
  const startxref = at;

  if (!doc.xrefIsStream) {
    parts.push(bytes(classicTable(sorted, offsets, doc, size, startxref, trailerExtras)));
    return concat(parts);
  }

  // A cross reference stream. It is itself an object, so it needs a number
  // of its own, and it must appear in its own table.
  const xrefNum = size - 1;
  offsets.set(xrefNum, startxref);
  const rows = [...offsets.entries()].sort((a, b) => a[0] - b[0]);
  const data = new Uint8Array(rows.length * 7);
  rows.forEach(([, offset], i) => {
    const o = i * 7;
    data[o] = 1;
    data[o + 1] = (offset >>> 24) & 0xff;
    data[o + 2] = (offset >>> 16) & 0xff;
    data[o + 3] = (offset >>> 8) & 0xff;
    data[o + 4] = offset & 0xff;
    data[o + 5] = 0;
    data[o + 6] = 0;
  });
  const compressed = deflate(data);
  const dict: PdfDict = new Map();
  dict.set('Type', new PdfName('XRef'));
  dict.set('Size', size);
  dict.set('Index', indexOf(rows.map(([num]) => num)));
  dict.set('W', [1, 4, 2]);
  dict.set('Root', doc.trailer.get('Root') ?? null);
  const info = trailerExtras.get('Info') ?? doc.trailer.get('Info');
  if (info) dict.set('Info', info);
  if (doc.trailer.has('ID')) dict.set('ID', doc.trailer.get('ID')!);
  dict.set('Prev', doc.startXref);
  dict.set('Filter', new PdfName('FlateDecode'));
  const stream = new PdfStream(dict, compressed);
  parts.push(
    concat([bytes(`${xrefNum} 0 obj\n`), serialize(stream), bytes(`\nendobj\nstartxref\n${startxref}\n%%EOF\n`)]),
  );
  return concat(parts);
}

/** Consecutive runs of object numbers, as /Index wants them. */
function indexOf(numbers: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < numbers.length) {
    const first = numbers[i]!;
    let count = 1;
    while (i + count < numbers.length && numbers[i + count] === first + count) count++;
    out.push(first, count);
    i += count;
  }
  return out;
}

function classicTable(
  sorted: readonly PdfEdit[],
  offsets: ReadonlyMap<number, number>,
  doc: PdfDocument,
  size: number,
  startxref: number,
  trailerExtras: ReadonlyMap<string, PdfValue>,
): string {
  let table = 'xref\n';
  const numbers = sorted.map((e) => e.num);
  let i = 0;
  while (i < numbers.length) {
    const first = numbers[i]!;
    let count = 1;
    while (i + count < numbers.length && numbers[i + count] === first + count) count++;
    table += `${first} ${count}\n`;
    for (let k = 0; k < count; k++) {
      table += `${String(offsets.get(first + k)!).padStart(10, '0')} 00000 n \n`;
    }
    i += count;
  }
  const root = doc.trailer.get('Root');
  const info = trailerExtras.get('Info') ?? doc.trailer.get('Info');
  const id = doc.trailer.get('ID');
  let trailer = `trailer\n<< /Size ${size}`;
  if (root) trailer += ` /Root ${latin1Of(serialize(root))}`;
  if (info) trailer += ` /Info ${latin1Of(serialize(info))}`;
  if (id) trailer += ` /ID ${latin1Of(serialize(id))}`;
  trailer += ` /Prev ${doc.startXref} >>\nstartxref\n${startxref}\n%%EOF\n`;
  return table + trailer;
}

function latin1Of(data: Uint8Array): string {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return s;
}
