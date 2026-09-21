import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { PdfDocument } from '../src/domain/pdf';
import { docPrId, imagePartFor, targetOfIn } from '../src/domain/docxImages';
import { figureImage, structNum } from '../src/domain/pdfImages';
import { sendableImage } from '../src/server/images';
import { buildPdf, type Obj } from './helpers/pdf';

const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(d));

const W = 'xmlns:w="w"';
const RELS = (target: string, mode = '') =>
  `<Relationships><Relationship Id="rId4" Type="http://x/image" Target="${target}"${mode}/></Relationships>`;

function docWithDrawing(id: string, embed = 'rId4'): string {
  return `<w:document ${W}><w:body><w:p><w:r><w:drawing>
    <wp:inline><wp:docPr id="${id}" name="Picture"/>
    <a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${embed}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p></w:body></w:document>`;
}

test('a Word figure is reached through its relationship id, not by counting images', () => {
  // The same reason remediation applies fixes by anchor: automatic
  // remediation may have run first, and the docPr id is the one thing it
  // does not move.
  const parts = { document: docWithDrawing('7'), documentRels: RELS('media/chart.png') };
  assert.deepEqual(imagePartFor(parts, 'docPr:7'), { part: 'word/media/chart.png', mediaType: 'image/png' });
  assert.equal(imagePartFor(parts, 'docPr:9'), null, 'a different figure');
  assert.equal(imagePartFor(parts, 'hyperlink:2'), null, 'not a figure anchor at all');
  assert.equal(imagePartFor(parts, undefined), null);
});

test('anchors are read strictly, so a stray string cannot select a figure', () => {
  assert.equal(docPrId('docPr:12'), '12');
  assert.equal(docPrId('struct:12'), null);
  assert.equal(docPrId(undefined), null);
  assert.equal(structNum('struct:25'), 25);
  assert.equal(structNum('struct:x'), null);
  assert.equal(structNum('docPr:25'), null);
});

test('a picture Word only links to has no bytes here to send', () => {
  // An externally linked image is a document that will not even print the
  // same on another machine; there is nothing in the archive to extract.
  assert.equal(targetOfIn(RELS('https://example.gov/chart.png'), 'rId4'), null);
  assert.equal(targetOfIn(RELS('../elsewhere/chart.png', ' TargetMode="External"'), 'rId4'), null);
});

test('formats Word embeds happily but no model accepts are refused', () => {
  for (const name of ['chart.emf', 'chart.tiff', 'chart.wmf', 'chart']) {
    assert.equal(targetOfIn(RELS(`media/${name}`), 'rId4'), null, name);
  }
  assert.deepEqual(targetOfIn(RELS('media/photo.JPG'), 'rId4'), {
    part: 'word/media/photo.JPG',
    mediaType: 'image/jpeg',
  });
});

test('a relative target that climbs out of word/ still resolves to one path', () => {
  assert.deepEqual(targetOfIn(RELS('../customXml/chart.png'), 'rId4'), {
    part: 'customXml/chart.png',
    mediaType: 'image/png',
  });
});

/**
 * A page whose first figure draws an image and whose second paints a box.
 *
 * The image is greyscale, uncompressed, and its four samples are the bytes
 * of "ABCD" – because the helper writes object bodies as UTF-8 text, and a
 * sample above 127 (or a deflate stream) would be re-encoded into something
 * else on the way into the file. That trap has now cost two debugging
 * rounds in this repository.
 */
function pdfWithFigures(): Uint8Array {
  const content =
    'BT /F1 12 Tf (Hi) Tj ET\n/P <</MCID 0>> BDC\nq 100 0 0 80 50 50 cm /Im1 Do Q\nEMC\n/P <</MCID 1>> BDC\n0 0 1 rg 10 10 40 40 re f\nEMC\n';
  const objects: Obj[] = [
    `<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 5 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /XObject << /Im1 7 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /StructTreeRoot /K [6 0 R 8 0 R] >>`,
    `<< /S /Figure /Pg 3 0 R /K 0 >>`,
    `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\nABCD\nendstream`,
    `<< /S /Figure /Pg 3 0 R /K 1 >>`,
  ];
  return buildPdf(objects, { info: '<< /Title (Figures) >>' });
}

test('a PDF figure that paints an image gives up the image', () => {
  const doc = PdfDocument.parse(pdfWithFigures(), inflate);
  const found = figureImage(doc, 'struct:6');
  assert.equal(found.ok, true);
  if (!found.ok) return;
  const out = sendableImage(doc, found.stream);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.image.mediaType, 'image/png');
  // The PNG signature, so what comes back is a file and not raw samples.
  assert.deepEqual([...out.image.bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('a PDF figure drawn as vector artwork reports vector, which is an answer and not a failure', () => {
  // This is the ordinary case on design work, and the reason a reviewer is
  // describing the figure by hand. Reporting it as an error would tell them
  // to try again at something that cannot work.
  const doc = PdfDocument.parse(pdfWithFigures(), inflate);
  const found = figureImage(doc, 'struct:8');
  assert.equal(found.ok, false);
  if (found.ok) return;
  assert.equal(found.reason, 'vector');
});

test('an anchor that points at nothing is told apart from one that points at vector art', () => {
  const doc = PdfDocument.parse(pdfWithFigures(), inflate);
  assert.deepEqual(figureImage(doc, 'struct:99'), { ok: false, reason: 'not-found' });
  assert.deepEqual(figureImage(doc, undefined), { ok: false, reason: 'no-anchor' });
  assert.deepEqual(figureImage(doc, 'docPr:6'), { ok: false, reason: 'no-anchor' });
});

test('a JPEG is handed over untouched, because it is already a file', () => {
  // Re-encoding would show the model something the document does not
  // contain, and would lose nothing but fidelity.
  const jpeg = 'JPEGBYTES';
  const objects: Obj[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>`,
    `<< /Length 3 >>\nstream\n   \nendstream`,
    `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n${jpeg}\nendstream`,
  ];
  const doc = PdfDocument.parse(buildPdf(objects), inflate);
  const stream = doc.get(5);
  const out = sendableImage(doc, stream as never);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.image.mediaType, 'image/jpeg');
  assert.equal(new TextDecoder().decode(out.image.bytes), jpeg);
});

test('a filter or colour space this service cannot decode is refused by name', () => {
  // Better a reviewer told to describe it themselves than a description of
  // whatever the bytes happened to look like.
  const make = (dict: string): Uint8Array =>
    buildPdf([
      `<< /Type /Catalog /Pages 2 0 R >>`,
      `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
      `<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>`,
      `<< /Length 3 >>\nstream\n   \nendstream`,
      `${dict}\nstream\nxx\nendstream`,
    ]);
  const cases: Array<[string, string]> = [
    ['<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /Filter /JPXDecode /Length 2 >>', 'unsupported-filter'],
    ['<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /Filter /CCITTFaxDecode /Length 2 >>', 'unsupported-filter'],
    [
      '<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Length 2 >>',
      'unsupported-colour',
    ],
    [
      '<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Length 2 >>',
      'unsupported-colour',
    ],
    ['<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ImageMask true /Length 2 >>', 'unsupported-colour'],
  ];
  for (const [dict, reason] of cases) {
    const doc = PdfDocument.parse(make(dict), inflate);
    const out = sendableImage(doc, doc.get(5) as never);
    assert.deepEqual(out, { ok: false, reason }, dict);
  }
});
