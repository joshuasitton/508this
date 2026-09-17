import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { PdfDocument } from '../src/domain/pdf';
import { detectPdf } from '../src/domain/pdfDetect';
import { buildPdf, onePage, type Obj } from './helpers/pdf';

const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(d));
const TITLE = '<< /Title (Annual Report) >>';
// `null` means no /Info at all. It cannot be `undefined`: passing that
// explicitly still triggers the default, which is the whole point of the
// parameter.
const detect = (objects: Obj[], compressed = false, info: string | null = TITLE) =>
  detectPdf(PdfDocument.parse(buildPdf(objects, { compressed, info: info ?? undefined }), inflate));
const kinds = (objects: Obj[], compressed = false) => detect(objects, compressed).map((f) => f.kind);

/** A tagged one-page document; `tree` is the structure element list. */
function tagged(tree: string, extras = '', content = 'BT /F1 12 Tf (Hello) Tj ET'): Obj[] {
  return [
    `<< /Type /Catalog /Pages 2 0 R /Lang (en-US) /MarkInfo << /Marked true >> /StructTreeRoot 5 0 R /ViewerPreferences << /DisplayDocTitle true >> ${extras} >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Type /StructTreeRoot /K 6 0 R /RoleMap << /BodyText /P /Head1 /H1 >> >>`,
    `<< /S /Document /K ${tree} >>`,
  ];
}

test('an untagged PDF fails at the first hurdle, and says the artwork has nowhere to be described', () => {
  // The logo sheet a designer sends: one page of vector artwork with a few
  // words set in it, no tags, no language. Everything the standard asks for
  // depends on tags, so this finding is worth more than all the rest.
  const art = '0 0 1 rg 10 10 100 100 re f BT /F1 12 Tf (Option 1) Tj ET';
  const found = detect(onePage('', '', art), false, null);
  assert.deepEqual(
    found.map((f) => [f.kind, f.criterion, f.severity]),
    [
      ['no-title', '2.4.2', 'blocking'],
      ['no-language', '3.1.1', 'blocking'],
      ['pdf-untagged', '1.3.1', 'blocking'],
      ['image-alt', '1.1.1', 'blocking'],
    ],
  );
  assert.match(found[3]!.description, /nowhere to record what that artwork shows/);
  assert.equal(found.some((f) => f.kind === 'pdf-no-text'), false, 'there is text, it just has no structure');
});

test('a title that is set but not shown is a finding, and a missing one outranks it', () => {
  // Every PDF out of InDesign carries a title and almost none are set to
  // display it, so the reader shows the filename regardless.
  const notShown = tagged('[]').map((o) => o.replace('/DisplayDocTitle true', '/DisplayDocTitle false'));
  const found = detect(notShown);
  assert.deepEqual(found.map((f) => f.kind), ['pdf-title-not-shown']);
  assert.match(found[0]!.description, /“Annual Report”/);
  assert.deepEqual(detect(tagged('[]')).map((f) => f.kind), [], 'set and shown is clean');
  assert.deepEqual(detect(notShown, false, null).map((f) => f.kind), ['no-title'], 'no title at all outranks it');
});

test('a figure without alternative text is found, per figure, with its page', () => {
  const found = detect(
    tagged('[<< /S /Figure /Pg 3 0 R >> << /S /Figure /Alt (Bar chart of spend) /Pg 3 0 R >> << /S /Figure /ActualText (2024) >>]'),
  );
  const figures = found.filter((f) => f.kind === 'image-alt');
  assert.equal(figures.length, 1, 'alt text and actual text both count as a description');
  assert.equal(figures[0]!.location, 'figure 1, page 1');
});

test('a tagged PDF with paragraphs and no headings is a finding; the role map is applied', () => {
  // InDesign tags paragraphs with the designer's own style names and maps
  // them in /RoleMap. A detector that read the raw tag would see no
  // paragraphs at all and stay silent on a document with no headings.
  const paras = Array.from({ length: 7 }, () => '<< /S /BodyText >>').join(' ');
  assert.deepEqual(kinds(tagged(`[${paras}]`)), ['no-headings']);
  assert.deepEqual(kinds(tagged(`[<< /S /Head1 >> ${paras}]`)), [], 'a mapped heading counts as a heading');
  assert.deepEqual(kinds(tagged('[<< /S /BodyText >> << /S /BodyText >>]')), [], 'a short document needs no headings');
});

test('a skipped heading level is found', () => {
  const found = detect(tagged('[<< /S /H1 >> << /S /H3 /Pg 3 0 R >>]'));
  assert.deepEqual(found.map((f) => f.kind), ['heading-skip']);
  assert.match(found[0]!.description, /level 3 follows heading level 1/);
});

test('a table whose cells are all data cells is a finding; one with header cells is not', () => {
  const rows = (cells: string) => `<< /S /Table /Pg 3 0 R /K [<< /S /TR /K [${cells}] >>] >>`;
  assert.deepEqual(kinds(tagged(`[${rows('<< /S /TD >> << /S /TD >>')}]`)), ['table-header']);
  assert.deepEqual(kinds(tagged(`[${rows('<< /S /TH >> << /S /TD >>')}]`)), []);
  assert.deepEqual(kinds(tagged(`[<< /S /Table /K [] >>]`)), [], 'a table with no cells says nothing');
});

test('a link annotation with no description, or a useless one, is a finding', () => {
  const link = (extra: string) => `<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] ${extra} >>`;
  const objects = tagged('[]');
  objects[2] = objects[2]!.replace(
    '/Contents 4 0 R',
    `/Contents 4 0 R /Annots [${link('/A << /URI (https://www.gsa.gov/508) >>')} ${link('/Contents (click here)')} ${link('/Contents (The GSA Section 508 page)')}]`,
  );
  const found = detect(objects).filter((f) => f.kind === 'link-text');
  assert.equal(found.length, 2);
  assert.match(found[0]!.description, /has no description/);
  assert.match(found[0]!.description, /https:\/\/www\.gsa\.gov\/508/);
  assert.match(found[1]!.description, /“click here”/);
});

test('a page that paints pictures but no text is a scan, and that is blocking', () => {
  const objects = onePage('/Lang (en-US) /MarkInfo << /Marked true >> /StructTreeRoot 5 0 R', '', '100 100 m 200 200 l S');
  objects.push('<< /Type /StructTreeRoot /K 6 0 R >>', '<< /S /Document /K [] >>');
  const found = detect(objects);
  const scan = found.find((f) => f.kind === 'pdf-no-text');
  assert.ok(scan, 'a page with strokes and no text-showing operator is a scan');
  assert.equal(scan.severity, 'blocking');
  assert.equal(scan.location, 'all 1 page');
});

test('a form and an embedded recording take the document out of the "static" class', () => {
  const objects = tagged('[]', '/AcroForm << /Fields [7 0 R] >>');
  objects[2] = objects[2]!.replace('/Contents 4 0 R', '/Contents 4 0 R /Annots [<< /Type /Annot /Subtype /Screen >>]');
  objects.push('<< /T (Name) >>');
  const found = detect(objects);
  assert.deepEqual(found.map((f) => f.kind).sort(), ['forms', 'media']);
});

test('every finding carries a criterion from the catalogue and starts unremediated', () => {
  const found = detect(tagged('[<< /S /Figure >>]'));
  assert.ok(found.length > 0);
  for (const f of found) {
    assert.equal(f.remediated, false);
    assert.match(f.criterion, /^\d\.\d\.\d$/);
  }
});

test('the checks work the same when the structure tree is inside an object stream', () => {
  // Which is where every PDF that has been through Acrobat keeps it.
  assert.deepEqual(kinds(tagged('[<< /S /Figure >>]'), true), ['image-alt']);
});
