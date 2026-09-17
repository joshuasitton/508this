import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { PdfDocument, PdfName, PdfRef, PdfStream, PdfError, latin1, pdfText } from '../src/domain/pdf';
import { buildPdf, onePage } from './helpers/pdf';

const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(d));
const parse = (bytes: Uint8Array) => PdfDocument.parse(bytes, inflate);

test('reads a classic xref table, the page tree, and every kind of object', () => {
  const doc = parse(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R /Lang (en-US) /Kit << /Deep [1 true null (s)] >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Note 5 0 R >>',
      '<< /Hex <48656C6C6F> /Name /A#20B /Neg -3.5 /Esc (a\\(b\\)c\\n) >>',
      '(indirect)',
    ]),
  );
  assert.equal(doc.version, '1.5');
  assert.equal(doc.pages.length, 1);
  assert.equal(pdfText(doc.at(doc.catalog, 'Lang')), 'en-US');
  const deep = doc.at(doc.catalog, 'Kit', 'Deep') as unknown[];
  assert.deepEqual([deep[0], deep[1], deep[2]], [1, true, null]);
  assert.equal(pdfText(deep[3] as Uint8Array), 's');
  const four = doc.get(4);
  assert.equal(pdfText(doc.at(four, 'Hex')), 'Hello');
  assert.equal((doc.at(four, 'Name') as PdfName).name, 'A B', 'a #20 escape in a name');
  assert.equal(doc.at(four, 'Neg'), -3.5);
  assert.equal(pdfText(doc.at(four, 'Esc')), 'a(b)c\n');
  // An indirect reference is followed, and only when asked.
  const page = doc.pages[0]!;
  assert.ok(page.get('Note') instanceof PdfRef);
  assert.equal(pdfText(doc.resolve(page.get('Note'))), 'indirect');
});

test('reads a cross reference stream with objects packed into an object stream', () => {
  // What Acrobat writes, and what the structure tree of a real InDesign PDF
  // lives inside. Without this the reader sees an empty document.
  for (const predictor of [false, true]) {
    const doc = parse(
      buildPdf(
        [
          '<< /Type /Catalog /Pages 2 0 R /Lang (fr-CA) /StructTreeRoot 5 0 R >>',
          '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
          '<< /Type /Page /Parent 2 0 R >>',
          '<< /Unused true >>',
          '<< /Type /StructTreeRoot /K 6 0 R >>',
          '<< /S /Document /K [] >>',
        ],
        { compressed: true, predictor },
      ),
    );
    assert.equal(pdfText(doc.at(doc.catalog, 'Lang')), 'fr-CA', `predictor: ${predictor}`);
    assert.equal(doc.pages.length, 1);
    assert.equal(((doc.at(doc.catalog, 'StructTreeRoot', 'K') as Map<string, unknown>).get('S') as PdfName).name, 'Document');
  }
});

test('a stream decodes, and its length may be an indirect reference', () => {
  const doc = parse(
    buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
      '<< /Length 5 0 R >>\nstream\nwords on a page\nendstream',
      '15',
    ]),
  );
  const stream = doc.at(doc.pages[0]!, 'Contents');
  assert.ok(stream instanceof PdfStream);
  assert.equal(latin1(doc.decode(stream)), 'words on a page');
});

test('a file with a broken cross reference is read by scanning for its objects', () => {
  // A document nobody can open is exactly the kind that arrives needing
  // remediation. Refusing it would turn a customer away at the door.
  const good = buildPdf(onePage('/Lang (en-GB)'));
  const text = latin1(good);
  const broken = new TextEncoder().encode(text.replace(/startxref\n\d+/, 'startxref\n999999'));
  const doc = parse(broken);
  assert.equal(pdfText(doc.at(doc.catalog, 'Lang')), 'en-GB');
  assert.equal(doc.pages.length, 1);
});

test('an encrypted PDF is refused, with a sentence that says what to do', () => {
  const objects = onePage();
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  const raw = latin1(buildPdf(objects)).replace('/Root 1 0 R', '/Root 1 0 R /Encrypt 9 0 R');
  assert.throws(() => parse(new TextEncoder().encode(raw)), (e: unknown) => e instanceof PdfError && /encrypted/i.test((e as Error).message));
});

test('not a PDF at all is refused before anything else', () => {
  assert.throws(() => parse(new TextEncoder().encode('<html>not a pdf</html>')), /does not begin with %PDF/);
});

test('a UTF-16 string comes back as its characters', () => {
  const utf16 = '\\376\\377\\000C\\000a\\000f\\000\\351'; // BOM + "Café"
  const doc = parse(buildPdf([`<< /Type /Catalog /Pages 2 0 R /T (${utf16}) >>`, '<< /Type /Pages /Kids [] /Count 0 >>']));
  assert.equal(pdfText(doc.at(doc.catalog, 'T')), 'Café');
});
