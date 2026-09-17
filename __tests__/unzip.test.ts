import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import { unzip } from '../src/server/unzip';
import { NotADocxError, readDocxParts } from '../src/server/docx';

/**
 * A minimal zip writer, here and not in src/, because the product never
 * writes archives yet and a test that depends on the code under test to
 * build its own input proves nothing.
 */
export function zip(entries: Record<string, string | Uint8Array>, opts: { store?: boolean; comment?: string } = {}): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = enc.encode(name);
    const raw = typeof value === 'string' ? enc.encode(value) : value;
    const method = opts.store ? 0 : 8;
    const data = opts.store ? raw : new Uint8Array(deflateRawSync(raw));
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const comment = enc.encode(opts.comment ?? '');
  const eocd = new Uint8Array(22 + comment.length);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, comment.length, true);
  eocd.set(comment, 22);
  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

test('reads deflated and stored entries', () => {
  const big = 'lorem ipsum '.repeat(500);
  const deflated = unzip(zip({ 'a.txt': 'hello', 'dir/b.txt': big }));
  assert.equal(text(deflated.get('a.txt')!), 'hello');
  assert.equal(text(deflated.get('dir/b.txt')!), big);
  const stored = unzip(zip({ 'a.txt': 'hello' }, { store: true }));
  assert.equal(text(stored.get('a.txt')!), 'hello');
});

test('finds the directory behind an archive comment', () => {
  // Word does not write comments, but other tools do, and the scan for the
  // end record has to look past one rather than declare the file corrupt.
  const bytes = unzip(zip({ 'a.txt': 'x' }, { comment: 'made by a tool' }));
  assert.equal(text(bytes.get('a.txt')!), 'x');
});

test('refuses what is not a zip, with a message that says so', () => {
  assert.throws(() => unzip(new TextEncoder().encode('<html>not a zip</html>')), /Not a zip archive/);
  assert.throws(() => unzip(new Uint8Array(0)), /Not a zip archive/);
});

test('readDocxParts returns the parts the detector wants and tolerates missing optional ones', () => {
  const parts = readDocxParts(
    zip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document/>',
      'word/styles.xml': '<w:styles/>',
      'docProps/core.xml': '<cp:coreProperties/>',
    }),
  );
  assert.equal(parts.document, '<w:document/>');
  assert.equal(parts.styles, '<w:styles/>');
  assert.equal(parts.core, '<cp:coreProperties/>');
  assert.equal(parts.settings, undefined);
});

test('a zip without a document part is not a Word document', () => {
  // A .pptx renamed to .docx passes the signature check; this is where it
  // is caught, with an error the action can turn into a sentence.
  assert.throws(() => readDocxParts(zip({ 'ppt/presentation.xml': '<p/>' })), NotADocxError);
  assert.throws(() => readDocxParts(new TextEncoder().encode('junk')), NotADocxError);
});
