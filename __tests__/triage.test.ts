import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { PdfDocument } from '../src/domain/pdf';
import { detectPdf, readPdfFacts } from '../src/domain/pdfDetect';
import {
  TIERS,
  canDraftAltText,
  countByTier,
  describeFigures,
  describeMix,
  promiseFor,
  triagePdf,
  type Tier,
  type Triage,
} from '../src/domain/triage';
import { buildPdf, onePage, type Obj } from './helpers/pdf';

const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(d));
const parse = (objects: Obj[], info?: string) => PdfDocument.parse(buildPdf(objects, { info }), inflate);

function tierOf(objects: Obj[], info?: string): Tier {
  const doc = parse(objects, info);
  return triagePdf(readPdfFacts(doc), detectPdf(doc)).tier;
}

function triage(objects: Obj[], info?: string): Triage {
  const doc = parse(objects, info);
  return triagePdf(readPdfFacts(doc), detectPdf(doc));
}

/** A tagged document whose structure elements are the roles given. */
function tagged(roles: string[]): Obj[] {
  const first = 6; // objects 1–5 are the catalogue, pages, page, content, struct root
  const kids = roles.map((_, i) => `${first + i} 0 R`).join(' ');
  return [
    `<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 5 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>`,
    `<< /Length 26 >>\nstream\nBT /F1 12 Tf (Hi) Tj ET\nendstream`,
    `<< /Type /StructTreeRoot /K [${kids}] >>`,
    ...roles.map((role) => `<< /S /${role} /Pg 3 0 R >>`),
  ];
}

test('a PDF with no text on any page is a scan, whatever else it has', () => {
  // Pictures of words. Nothing here can be tagged or described, and saying
  // otherwise would sell OCR the service does not do.
  assert.equal(tierOf(onePage('', '', '0 0 1 rg 10 10 100 100 re f')), 'scan');
});

test('a blank page inside a document with text is not a scan', () => {
  // One empty page is ordinary. Reading it as a scan would file a real
  // document under the one tier the service cannot help at all.
  const objects: Obj[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>`,
    `<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>`,
    `<< /Length 26 >>\nstream\nBT /F1 12 Tf (Hi) Tj ET\nendstream`,
    `<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>`,
    `<< /Length 1 >>\nstream\n \nendstream`,
  ];
  assert.equal(tierOf(objects), 'untagged');
});

test('a text PDF with no tag tree is untagged, and the promise says it cannot be certified', () => {
  assert.equal(tierOf(onePage()), 'untagged');
  assert.match(promiseFor('untagged'), /cannot certify/);
});

test('a tagged PDF with no headings is "tagged": the heading structure is the gap', () => {
  // The Chairman's infographic exactly: InDesign tagged everything, and
  // applied one paragraph style, so nothing in the tree is a heading.
  const t = triage(tagged(['P', 'P', 'P', 'Figure', 'Figure']), '<< /Title (Infographic) >>');
  assert.equal(t.tier, 'tagged');
  assert.equal(t.paragraphs, 3);
  assert.equal(t.headings, 0);
  assert.equal(t.figures, 2);
  assert.equal(t.figuresWithoutAlt, 2);
});

test('a tagged PDF with headings is structured, the closest tier to certifiable', () => {
  const t = triage(tagged(['H1', 'P', 'H2', 'P']), '<< /Title (Handbook) >>');
  assert.equal(t.tier, 'structured');
  assert.equal(t.headings, 2);
  assert.equal(t.paragraphs, 2);
});

test('a designer’s own tag name counts as what the role map says it is', () => {
  // InDesign writes NormalParagraphStyle and maps it to P. Counting the
  // written tag rather than the mapped role would report a document with
  // twelve paragraphs as having none.
  const objects = tagged(['NormalParagraphStyle', 'NormalParagraphStyle']);
  objects[4] = `<< /Type /StructTreeRoot /K [6 0 R 7 0 R] /RoleMap << /NormalParagraphStyle /P >> >>`;
  const t = triage(objects, '<< /Title (Report) >>');
  assert.equal(t.paragraphs, 2);
  assert.equal(t.tier, 'tagged');
});

test('every tier has a promise, and none of them promises conformance it cannot deliver', () => {
  for (const tier of TIERS) {
    const promise = promiseFor(tier);
    assert.ok(promise.length > 40, tier);
    if (tier === 'scan' || tier === 'untagged') {
      assert.match(promise, /cannot|does not/, `${tier} must say what it cannot do`);
    }
  }
});

test('the mix is counted and stated as a share, because that share decides the roadmap', () => {
  const counts = countByTier([
    { tier: 'untagged' } as Triage,
    { tier: 'tagged' } as Triage,
    { tier: 'structured' } as Triage,
    { tier: 'scan' } as Triage,
  ]);
  assert.deepEqual(counts, { scan: 1, untagged: 1, tagged: 1, structured: 1 });
  const sentence = describeMix(counts);
  assert.match(sentence, /2 of 4 \(50%\)/);
  assert.match(sentence, /before they pay/);
  assert.equal(describeMix({ scan: 0, untagged: 0, tagged: 0, structured: 0 }), 'No PDFs were read.');
});

/** An image XObject, so a file has pixels somewhere in it. */
const IMAGE = `<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 16 >>\nstream\nAAAAAAAAAAAAAAAA\nendstream`;

test('a figure drawn as vector artwork has no image to send a model', () => {
  // The Chairman's infographic exactly: four Figure elements, 9,450 curve
  // operators and not one raster image in the file. A vision pass needs
  // pixels, so for a document like this there is nothing to send at all -
  // which is a different problem from "the model gave a poor description".
  const t = triage(tagged(['Figure', 'Figure', 'P']), '<< /Title (Infographic) >>');
  assert.equal(t.figures, 2);
  assert.equal(t.figuresWithoutAlt, 2);
  assert.equal(t.rasterImages, 0);
  assert.equal(canDraftAltText(t), false);
});

test('a file that carries raster images reports them, and can be drafted for', () => {
  const objects = tagged(['Figure', 'P']);
  objects.push(IMAGE, IMAGE);
  const t = triage(objects, '<< /Title (Report) >>');
  assert.equal(t.rasterImages, 2);
  assert.equal(t.figuresWithoutAlt, 1);
  assert.equal(canDraftAltText(t), true);
});

test('an inline image counts too, because it is pixels a model could be shown', () => {
  // BI ... ID ... EI paints an image with no XObject anywhere in the file.
  // Counting only XObjects would call such a page vector-only and send a
  // describable figure to a reviewer for no reason.
  const content = 'BT /F1 12 Tf (Hi) Tj ET q 10 0 0 10 0 0 cm BI /W 2 /H 2 /CS /G /BPC 8 ID \u0001\u0002\u0003\u0004 EI Q';
  const objects: Obj[] = [
    `<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 5 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /StructTreeRoot /K [6 0 R] >>`,
    `<< /S /Figure /Pg 3 0 R >>`,
  ];
  const t = triage(objects, '<< /Title (Inline) >>');
  assert.equal(t.rasterImages, 1);
  assert.equal(canDraftAltText(t), true);
});

test('a document with no undescribed figures is not a candidate, images or not', () => {
  const objects = tagged(['P']);
  objects.push(IMAGE);
  const t = triage(objects, '<< /Title (Prose) >>');
  assert.equal(t.rasterImages, 1);
  assert.equal(t.figuresWithoutAlt, 0);
  assert.equal(canDraftAltText(t), false);
});

test('the folder summary separates "needs a description" from "has anything to send"', () => {
  const vector = { figuresWithoutAlt: 4, rasterImages: 0 } as Triage;
  const raster = { figuresWithoutAlt: 2, rasterImages: 9 } as Triage;
  const clean = { figuresWithoutAlt: 0, rasterImages: 3 } as Triage;
  const sentence = describeFigures([vector, raster, clean]);
  assert.match(sentence, /6 figures across 2 documents/);
  assert.match(sentence, /1 of those documents contain raster images/);
  assert.match(sentence, /in the other 1 the artwork is vector/);
  assert.equal(describeFigures([clean]), 'No document has a figure waiting for a description.');
});
