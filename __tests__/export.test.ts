import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { DocxParts } from '../src/domain/docx';
import { detectDocx } from '../src/domain/docx';
import { flowOfDocx } from '../src/domain/docxFlow';
import { PdfDocument, PdfStream, latin1, pdfText } from '../src/domain/pdf';
import { buildPdf, type Block, type EmbeddedImage } from '../src/domain/pdfBuild';
import { detectPdf } from '../src/domain/pdfDetect';

/**
 * The join: a Word document in, a tagged PDF out, checked by the detector that
 * checks a customer's own PDF.
 *
 * `docxFlow.test.ts` says the reader understands WordprocessingML and
 * `pdfBuild.test.ts` says the writer writes a conformant file. Neither says the
 * two agree, and that is where a document loses a paragraph — so this runs the
 * whole way through and then asks the two questions that matter: does the
 * exported PDF pass, and is every word of the document still in it.
 *
 * The server's part — unzipping the archive and decoding pictures — is not
 * here, because it takes an npm dependency and `npm test` runs with none
 * installed. The picture below is raw samples for the same reason.
 */
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const STYLES = `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
</w:styles>`;
const CORE = `<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Widget Reporting System — accessibility</dc:title></cp:coreProperties>`;
const RELS = `<Relationships xmlns="r">
  <Relationship Id="rId9" Type="image" Target="media/image1.png"/>
  <Relationship Id="rId10" Type="hyperlink" Target="https://www.access-board.gov/ict/" TargetMode="External"/>
</Relationships>`;
const NUMBERING = `<w:numbering ${W}>
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const PARAGRAPHS = [
  'This report states how the Widget Reporting System meets the Revised Section 508 standards.',
  'The assessment covers the application, the documents it generates, and the sign-in flow.',
  'Every claim is either measured or attributed to the person who judged it.',
];

const body =
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Accessibility of the Widget Reporting System</w:t></w:r></w:p>` +
  PARAGRAPHS.map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join('') +
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>The application itself.</w:t></w:r></w:p>` +
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>The monthly summary.</w:t></w:r></w:p>` +
  `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Findings</w:t></w:r></w:p>` +
  `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
  `<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Criterion</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Result</w:t></w:r></w:p></w:tc></w:tr>` +
  `<w:tr><w:tc><w:p><w:r><w:t>1.1.1 Non-text Content</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Supports</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
  `<w:p><w:r><w:t xml:space="preserve">The criteria are published at </w:t></w:r><w:hyperlink r:id="rId10" xmlns:r="rel"><w:r><w:t>the Access Board’s ICT standards</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>` +
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="p"><wp:extent cx="1143000" cy="1143000"/>` +
  `<wp:docPr id="1" name="Mark" descr="The 508This mark, in a rounded square."/>` +
  `<a:blip r:embed="rId9" xmlns:a="a" xmlns:r="rel"/></wp:inline></w:drawing></w:r></w:p>`;

const PARTS: DocxParts = {
  document: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
  styles: STYLES,
  core: CORE,
  documentRels: RELS,
  numbering: NUMBERING,
};

/** A 2×2 greyscale picture: raw samples, so no test needs a compressor. */
const GREY: EmbeddedImage = {
  width: 2,
  height: 2,
  data: Uint8Array.from([0, 90, 180, 255]),
  filter: null,
  colourSpace: 'DeviceGray',
};

function exported(parts: DocxParts = PARTS): Uint8Array {
  const flow = flowOfDocx(parts, { fallbackTitle: 'sample' });
  const blocks: Block[] = flow.blocks.map((block) =>
    block.kind === 'figure'
      ? {
          kind: 'figure',
          image: GREY,
          ...(block.alt ? { alt: block.alt } : {}),
          ...(block.decorative ? { decorative: true } : {}),
        }
      : block,
  );
  const result = buildPdf({ title: flow.title, language: flow.language, blocks, now: '2026-09-28T12:00:00.000Z' });
  assert.ok(result.ok, result.ok ? '' : `refused: ${result.characters.join('')}`);
  return result.bytes;
}

test('a Word document with nothing open exports to a PDF with nothing open', () => {
  assert.deepEqual(detectDocx(PARTS), [], 'the fixture itself has to be clean, or this proves nothing');
  const findings = detectPdf(PdfDocument.parse(exported(), inflateNever));
  assert.deepEqual(findings, [], findings.map((f) => `${f.kind}: ${f.description}`).join('\n'));
});

/*
 * The failure this export could have that no criterion names: a paragraph
 * quietly missing from the delivered file. Nothing in the tag tree would look
 * wrong, the detector would pass it, and the customer would find out.
 */
test('every word of the document is in the exported PDF', () => {
  const painted = paintedText(exported());
  for (const text of [...PARAGRAPHS, 'Accessibility of the Widget Reporting System', 'The monthly summary.', '1.1.1 Non-text Content', 'Supports', 'the Access Board’s ICT standards']) {
    assert.ok(painted.includes(squash(text)), `the exported PDF does not contain “${text}”`);
  }
});

test('the exported PDF carries the document’s own title and language', () => {
  const doc = PdfDocument.parse(exported(), inflateNever);
  const info = doc.resolve(doc.trailer.get('Info'));
  assert.equal(pdfText(doc.at(info, 'Title')), 'Widget Reporting System — accessibility');
  assert.equal(pdfText(doc.at(doc.catalog, 'Lang')), 'en-US');
});

/*
 * A document whose own findings are still open exports a PDF with the same
 * findings open. The export is not a second chance to fix the document, and a
 * figure with no description must not arrive in the PDF looking described.
 */
test('a figure with no description stays undescribed in the export', () => {
  const stripped: DocxParts = { ...PARTS, document: PARTS.document.replace(' descr="The 508This mark, in a rounded square."', '') };
  assert.equal(detectDocx(stripped).filter((f) => f.kind === 'image-alt').length, 1);
  const findings = detectPdf(PdfDocument.parse(exported(stripped), inflateNever));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'image-alt');
});

function inflateNever(): Uint8Array {
  throw new Error('an exported PDF compresses nothing but pictures');
}

/** Everything the pages paint, as one string with the spacing taken out. */
function paintedText(bytes: Uint8Array): string {
  const doc = PdfDocument.parse(bytes, inflateNever);
  let out = '';
  for (const page of doc.pages) {
    const contents = doc.resolve(page.get('Contents'));
    const streams = Array.isArray(contents) ? contents.map((c) => doc.resolve(c)) : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PdfStream)) continue;
      const text = latin1(stream.raw);
      // A literal for printable text, hex for anything with a curly quote or
      // a dash in it — `serialize` picks, and both have to be read back here.
      for (const match of text.matchAll(/(?:\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]*)>)\s*Tj/g)) {
        if (match[1] !== undefined) out += match[1].replace(/\\([()\\])/g, '$1');
        else if (match[2] !== undefined) out += fromWinAnsiHex(match[2]);
      }
    }
  }
  return squash(out);
}

/** Hex-encoded WinAnsi bytes, back to the characters they stand for. */
function fromWinAnsiHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16);
    out += WIN_ANSI_HIGH[byte] ?? String.fromCharCode(byte);
  }
  return out;
}

/** The few WinAnsi codes that are not Latin-1, which is where curly quotes live. */
const WIN_ANSI_HIGH: Record<number, string> = {
  0x91: '\u2018',
  0x92: '\u2019',
  0x93: '\u201c',
  0x94: '\u201d',
  0x95: '\u2022',
  0x96: '\u2013',
  0x97: '\u2014',
  0x85: '\u2026',
};

/**
 * Comparing painted text to source text needs the spacing gone: the writer
 * breaks lines where the source did not, and a word set in bold is a separate
 * piece. What must survive is the letters, in order.
 */
function squash(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, '');
}
