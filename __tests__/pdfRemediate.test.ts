import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';

import { PdfDocument, pdfText } from '../src/domain/pdf';
import { detectPdf } from '../src/domain/pdfDetect';
import { PDF_FIXABLE_KINDS, applyPdfDecisions, remediatePdf } from '../src/domain/pdfRemediate';
import { incrementalUpdate } from '../src/domain/pdfWrite';
import { buildPdf, onePage, type Obj } from './helpers/pdf';

const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(d));
const deflate = (d: Uint8Array) => new Uint8Array(deflateSync(d));
const parse = (b: Uint8Array) => PdfDocument.parse(b, inflate);
const OPTS = { fallbackTitle: 'annual report' };

/** Remediate, write, and read the result back, as the job store does. */
function run(objects: Obj[], info?: string, compressed = false) {
  const doc = parse(buildPdf(objects, { info, compressed }));
  const r = remediatePdf(doc, OPTS);
  const out = incrementalUpdate(doc, r.edits, deflate, r.trailerExtras);
  return { applied: r.applied, after: parse(out), bytes: out, doc };
}

test('a language, a title and the flag that displays it are set, each once', () => {
  const { applied, after } = run(onePage());
  assert.deepEqual(applied.map((a) => a.kind).sort(), ['no-language', 'no-title', 'pdf-title-not-shown']);
  assert.equal(pdfText(after.at(after.catalog, 'Lang')), 'en-US');
  assert.equal(after.at(after.catalog, 'ViewerPreferences', 'DisplayDocTitle'), true);
  assert.equal(pdfText(after.at(after.resolve(after.trailer.get('Info')), 'Title')), 'annual report');
});

test('two fixes to the catalogue are written as one object, not two', () => {
  // The language and the viewer preferences both live in the catalogue. A
  // remediator that wrote an object per fix would append two versions and
  // the second would silently lose the first.
  const { after } = run(onePage());
  assert.equal(pdfText(after.at(after.catalog, 'Lang')), 'en-US');
  assert.equal(after.at(after.catalog, 'ViewerPreferences', 'DisplayDocTitle'), true);
});

test('a document that already has all three is left completely alone', () => {
  const objects = onePage('/Lang (fr-FR) /ViewerPreferences << /DisplayDocTitle true >>');
  const { applied, bytes, doc } = run(objects, '<< /Title (Rapport annuel) >>');
  assert.deepEqual(applied, []);
  assert.equal(bytes, doc.bytes, 'not one byte changed');
});

test('the existing title is kept; the filename is only a fallback', () => {
  const { applied, after } = run(onePage('/Lang (en-US)'), '<< /Title (Veterans Define VA Research) >>');
  assert.deepEqual(applied.map((a) => a.kind), ['pdf-title-not-shown']);
  assert.equal(pdfText(after.at(after.resolve(after.trailer.get('Info')), 'Title')), 'Veterans Define VA Research');
});

test('the fixes hold when the file uses a cross reference stream', () => {
  const { after } = run(onePage(), undefined, true);
  assert.equal(pdfText(after.at(after.catalog, 'Lang')), 'en-US');
  assert.equal(after.at(after.catalog, 'ViewerPreferences', 'DisplayDocTitle'), true);
  assert.equal(after.pages.length, 1);
});

test('PDF_FIXABLE_KINDS is exactly what remediation applies, and excludes what it cannot', () => {
  const { applied } = run(onePage());
  assert.deepEqual([...new Set(applied.map((a) => a.kind))].sort(), [...PDF_FIXABLE_KINDS].sort());
  // Building a tag tree is not a fix with one right answer, and saying it
  // was would be the product's central promise broken.
  assert.equal(PDF_FIXABLE_KINDS.has('pdf-untagged'), false);
  assert.equal(PDF_FIXABLE_KINDS.has('no-headings'), false);
  assert.equal(PDF_FIXABLE_KINDS.has('image-alt'), false);
});

test('an untagged file gets its language and title and is still, correctly, not conformant', () => {
  const art = '0 0 1 rg 10 10 100 100 re f BT /F1 12 Tf (Option 1) Tj ET';
  const { after } = run(onePage('', '', art));
  assert.equal(pdfText(after.at(after.catalog, 'Lang')), 'en-US');
  assert.deepEqual(detectPdf(after).map((f) => f.kind), ['pdf-untagged', 'image-alt']);
});

test('a reviewer’s alternative text is written onto the figure’s own structure element', () => {
  const objects: Obj[] = [
    `<< /Type /Catalog /Pages 2 0 R /Lang (en-US) /MarkInfo << /Marked true >> /StructTreeRoot 5 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>`,
    `<< /Length 28 >>\nstream\nBT /F1 12 Tf (Hi) Tj ET\nendstream`,
    `<< /Type /StructTreeRoot /K 6 0 R >>`,
    `<< /S /Document /K [7 0 R 8 0 R] >>`,
    `<< /S /Figure /Pg 3 0 R >>`,
    `<< /S /Figure /Pg 3 0 R >>`,
  ];
  const doc = parse(buildPdf(objects, { info: '<< /Title (Report) >>' }));
  const findings = detectPdf(doc).filter((f) => f.kind === 'image-alt');
  assert.deepEqual(findings.map((f) => f.anchor), ['struct:7', 'struct:8']);
  findings[0]!.decision = { action: 'apply', value: '  Bar chart of spend by quarter  ', by: 'Josh', at: 'now' };
  findings[1]!.decision = { action: 'dismiss', note: 'Repeats the caption.', by: 'Josh', at: 'now' };

  const r = applyPdfDecisions(doc, findings);
  assert.deepEqual(r.applied.map((a) => a.kind), ['image-alt']);
  const after = parse(incrementalUpdate(doc, r.edits, deflate));
  assert.equal(pdfText(after.at(after.get(7), 'Alt')), 'Bar chart of spend by quarter');
  assert.equal(after.at(after.get(8), 'Alt'), null, 'a dismissal changes nothing in the document');
  // Re-detection agrees: the described figure is gone, the dismissed one is
  // still found, because a dismissal is a judgement and not a change.
  assert.deepEqual(detectPdf(after).map((f) => f.anchor), ['struct:8']);
});
