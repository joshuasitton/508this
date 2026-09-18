import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';

import { PdfDocument, PdfName, PdfRef, latin1, pdfText, type PdfValue } from '../src/domain/pdf';
import { incrementalUpdate, pdfString, serialize } from '../src/domain/pdfWrite';
import { buildPdf, onePage } from './helpers/pdf';

const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(d));
const deflate = (d: Uint8Array) => new Uint8Array(deflateSync(d));
const parse = (b: Uint8Array) => PdfDocument.parse(b, inflate);
const text = (v: unknown) => latin1(serialize(v as never));

test('every kind of value goes back to the bytes a PDF holds', () => {
  assert.equal(text(null), 'null');
  assert.equal(text(true), 'true');
  assert.equal(text(42), '42');
  assert.equal(text(-3.5), '-3.5');
  assert.equal(text(1e-7), '0', 'a PDF number is never in exponent notation');
  assert.equal(text(new PdfName('Type')), '/Type');
  assert.equal(text(new PdfName('Odd Name#1')), '/Odd#20Name#231', 'delimiters in a name are escaped');
  assert.equal(text(new PdfRef(12, 0)), '12 0 R');
  assert.equal(text([1, new PdfName('A'), null]), '[1 /A null]');
  const dict = new Map<string, PdfValue>([['Type', new PdfName('Page')], ['N', 3]]);
  assert.equal(text(dict), '<</Type /Page /N 3 >>');
});

test('a string written and read back is the string that went in', () => {
  // The bug this pins: `pdfString` once returned the *delimited* form, and
  // `serialize` wrapped it a second time, so a remediated file came back
  // with its language set to "(en-US)", parentheses and all. Every test
  // passed; reading the output with another library is what found it.
  for (const original of ['en-US', 'Annual Report', 'a (nested) string \\ here', 'Café — résumé', '日本語', '𝄞 clef']) {
    const doc = parse(buildPdf([`<< /Type /Catalog /Pages 2 0 R /T ${latin1(serialize(pdfString(original)))} >>`, '<< /Type /Pages /Kids [] /Count 0 >>']));
    assert.equal(pdfText(doc.at(doc.catalog, 'T')), original, `round trip: ${original}`);
  }
});

test('an update appends: the original survives byte for byte and the new value wins', () => {
  const original = buildPdf(onePage('/Lang (en-GB)'));
  const doc = parse(original);
  const catalog = new Map(doc.catalog);
  catalog.set('Lang', pdfString('fr-CA'));
  const updated = incrementalUpdate(doc, [{ num: 1, value: catalog }], deflate);

  assert.ok(updated.length > original.length);
  assert.deepEqual([...updated.subarray(0, original.length)], [...original], 'not one byte of the original moved');
  const after = parse(updated);
  assert.equal(pdfText(after.at(after.catalog, 'Lang')), 'fr-CA');
  assert.equal(after.pages.length, 1, 'everything the update did not touch still resolves');
  // And the original is still readable inside the new file's history.
  assert.equal(pdfText(parse(original).at(parse(original).catalog, 'Lang')), 'en-GB');
});

test('an update to a file with a cross reference stream writes one too', () => {
  // Mixing the two kinds is what the /XRefStm hybrid mechanism exists for;
  // guessing wrong makes a file some readers call corrupt, which is the one
  // outcome a remediation service can never risk.
  const original = buildPdf(onePage('/Lang (en-GB)'), { compressed: true });
  const doc = parse(original);
  assert.equal(doc.xrefIsStream, true);
  const catalog = new Map(doc.catalog);
  catalog.set('Lang', pdfString('es-US'));
  const updated = incrementalUpdate(doc, [{ num: 1, value: catalog }], deflate);
  assert.match(latin1(updated.subarray(original.length)), /\/Type\s*\/XRef/);
  const after = parse(updated);
  assert.equal(pdfText(after.at(after.catalog, 'Lang')), 'es-US');
  assert.equal(after.pages.length, 1);
});

test('two updates in a row both survive, through the /Prev chain', () => {
  const doc = parse(buildPdf(onePage()));
  const first = incrementalUpdate(doc, [{ num: 1, value: new Map([...doc.catalog, ['Lang', pdfString('en-US')]]) }], deflate);
  const second = parse(first);
  const third = incrementalUpdate(
    second,
    [{ num: 1, value: new Map([...second.catalog, ['Lang', pdfString('en-US')], ['PageMode', new PdfName('UseOutlines')]]) }],
    deflate,
  );
  const after = parse(third);
  assert.equal(pdfText(after.at(after.catalog, 'Lang')), 'en-US');
  assert.equal((after.at(after.catalog, 'PageMode') as PdfName).name, 'UseOutlines');
  assert.equal(after.pages.length, 1);
});

test('an update with nothing in it returns the original, byte for byte', () => {
  // A run that fixes nothing must not alter a customer's file at all.
  const original = buildPdf(onePage());
  assert.equal(incrementalUpdate(parse(original), [], deflate), original);
});

test('a new object and a trailer entry can be added together', () => {
  const original = buildPdf(onePage());
  const doc = parse(original);
  assert.equal(doc.trailer.has('Info'), false);
  const infoNum = doc.size;
  const updated = incrementalUpdate(
    doc,
    [{ num: infoNum, value: new Map([['Title', pdfString('Annual Report')]]) }],
    deflate,
    new Map([['Info', new PdfRef(infoNum, 0)]]),
  );
  const after = parse(updated);
  assert.equal(pdfText(after.at(after.resolve(after.trailer.get('Info')), 'Title')), 'Annual Report');
});
