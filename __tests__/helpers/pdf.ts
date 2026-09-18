import { deflateSync } from 'node:zlib';

/**
 * A tiny PDF writer, here and not in src/, because the product does not
 * write PDFs from scratch and a test that builds its input with the code
 * under test proves nothing. It emits the two shapes real files come in: a
 * classic `xref` table, and a PDF 1.5 cross reference stream with the
 * objects packed into an object stream, which is what Acrobat writes.
 */

export type Obj = string;

export interface PdfOptions {
  /** Pack objects into an object stream and use a cross reference stream. */
  compressed?: boolean;
  /** Apply the PNG "up" predictor to the cross reference stream. */
  predictor?: boolean;
  /** A document information dictionary, referenced from the trailer. */
  info?: string;
}

const enc = new TextEncoder();

function bytes(s: string): Uint8Array {
  return enc.encode(s);
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

/**
 * `objects[i]` is the body of object number i+1. A `null` entry means the
 * object is not written at all. Object 1 must be the catalogue.
 */
export function buildPdf(objects: Obj[], options: PdfOptions = {}): Uint8Array {
  // The title lives in the trailer's /Info, so a fixture that wants one
  // needs an object and a trailer entry, exactly as a real file has.
  let trailerInfo = '';
  if (options.info) {
    objects = [...objects, options.info];
    trailerInfo = ` /Info ${objects.length} 0 R`;
  }
  // Offsets are byte counts, never string lengths: the binary comment on
  // the second line is four non-ASCII characters and eight bytes, and a
  // cross reference that is four bytes out points into the middle of a
  // token. Every real PDF carries that comment, so the tests use one too.
  const header = '%PDF-1.5\n%\xe2\xe3\xcf\xd3\n';
  const headerBytes = bytes(header);
  if (!options.compressed) {
    const parts: Uint8Array[] = [headerBytes];
    let at = headerBytes.length;
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets[i] = at;
      const s = bytes(`${i + 1} 0 obj\n${body}\nendobj\n`);
      parts.push(s);
      at += s.length;
    });
    const startxref = at;
    let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) table += `${String(off).padStart(10, '0')} 00000 n \n`;
    table += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerInfo} >>\nstartxref\n${startxref}\n%%EOF\n`;
    parts.push(bytes(table));
    return concat(parts);
  }

  // Compressed: every object that is not a stream goes into an object
  // stream; the cross reference is itself a stream.
  const inStream: Array<{ num: number; body: string }> = [];
  const direct: Array<{ num: number; body: string }> = [];
  objects.forEach((body, i) => {
    const num = i + 1;
    if (/\bstream\b/.test(body)) direct.push({ num, body });
    else inStream.push({ num, body });
  });

  const objStmNum = objects.length + 1;
  const xrefNum = objects.length + 2;

  let pairs = '';
  let payload = '';
  for (const o of inStream) {
    pairs += `${o.num} ${payload.length} `;
    payload += `${o.body} `;
  }
  const objStmData = pairs + payload;
  const first = bytes(pairs).length;
  const objStmCompressed = new Uint8Array(deflateSync(bytes(objStmData)));

  const parts: Uint8Array[] = [headerBytes];
  let at = headerBytes.length;
  const offsets = new Map<number, number>();
  for (const o of direct) {
    offsets.set(o.num, at);
    const s = bytes(`${o.num} 0 obj\n${o.body}\nendobj\n`);
    parts.push(s);
    at += s.length;
  }
  offsets.set(objStmNum, at);
  const objStmHead = bytes(
    `${objStmNum} 0 obj\n<< /Type /ObjStm /N ${inStream.length} /First ${first} /Length ${objStmCompressed.length} /Filter /FlateDecode >>\nstream\n`,
  );
  const objStmTail = bytes('\nendstream\nendobj\n');
  parts.push(objStmHead, objStmCompressed, objStmTail);
  at += objStmHead.length + objStmCompressed.length + objStmTail.length;

  // The cross reference stream: 1-byte type, 4-byte field 2, 2-byte field 3.
  const size = xrefNum + 1;
  const rowLength = 7;
  const rows: number[][] = [];
  rows.push([0, 0, 65535]); // the free head
  for (let num = 1; num <= xrefNum; num++) {
    const offset = offsets.get(num);
    if (offset !== undefined) rows.push([1, offset, 0]);
    else if (num === xrefNum) rows.push([1, at, 0]);
    else {
      const index = inStream.findIndex((o) => o.num === num);
      rows.push(index >= 0 ? [2, objStmNum, index] : [0, 0, 0]);
    }
  }
  const raw = new Uint8Array(rows.length * rowLength);
  rows.forEach((r, i) => {
    const o = i * rowLength;
    raw[o] = r[0]!;
    raw[o + 1] = (r[1]! >>> 24) & 0xff;
    raw[o + 2] = (r[1]! >>> 16) & 0xff;
    raw[o + 3] = (r[1]! >>> 8) & 0xff;
    raw[o + 4] = r[1]! & 0xff;
    raw[o + 5] = (r[2]! >>> 8) & 0xff;
    raw[o + 6] = r[2]! & 0xff;
  });

  let body = raw;
  let parms = '';
  if (options.predictor) {
    // PNG "up": each row is the difference from the row above it.
    const withTags = new Uint8Array(rows.length * (rowLength + 1));
    let prev = new Uint8Array(rowLength);
    for (let i = 0; i < rows.length; i++) {
      const row = raw.subarray(i * rowLength, (i + 1) * rowLength);
      withTags[i * (rowLength + 1)] = 2; // filter type "up"
      for (let j = 0; j < rowLength; j++) {
        withTags[i * (rowLength + 1) + 1 + j] = (row[j]! - prev[j]! + 256) & 0xff;
      }
      prev = row;
    }
    body = withTags;
    parms = ` /DecodeParms << /Predictor 12 /Columns ${rowLength} >>`;
  }
  const xrefCompressed = new Uint8Array(deflateSync(body));
  const xrefHead = bytes(
    `${xrefNum} 0 obj\n<< /Type /XRef /Size ${size} /W [1 4 2] /Root 1 0 R${trailerInfo} /Length ${xrefCompressed.length} /Filter /FlateDecode${parms} >>\nstream\n`,
  );
  parts.push(xrefHead, xrefCompressed, bytes(`\nendstream\nendobj\nstartxref\n${at}\n%%EOF\n`));
  return concat(parts);
}

/** The objects for a one-page document, with whatever catalogue entries are given. */
export function onePage(catalogExtras = '', pageExtras = '', content = 'BT /F1 12 Tf (Hello) Tj ET'): Obj[] {
  return [
    `<< /Type /Catalog /Pages 2 0 R ${catalogExtras} >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ${pageExtras} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
}
