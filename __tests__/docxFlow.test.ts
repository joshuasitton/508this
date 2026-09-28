import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { DocxParts } from '../src/domain/docx';
import { flowOfDocx, formatNumber, mergeSpans, type FlowBlock } from '../src/domain/docxFlow';

/**
 * The same shape as `docx.test.ts`: XML written inline, because the question is
 * what the reader makes of WordprocessingML and a fixture file would hide it.
 */
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function doc(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
}

const STYLES = `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
</w:styles>`;
const CORE = `<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Annual Report</dc:title></cp:coreProperties>`;
const RELS = `<Relationships xmlns="r">
  <Relationship Id="rId9" Type="image" Target="media/image1.png"/>
  <Relationship Id="rId10" Type="hyperlink" Target="https://www.section508.gov/" TargetMode="External"/>
  <Relationship Id="rId11" Type="hyperlink" Target="#bookmark"/>
</Relationships>`;

function flow(body: string, extra: Partial<DocxParts> = {}): FlowBlock[] {
  const parts: DocxParts = { document: doc(body), styles: STYLES, core: CORE, documentRels: RELS, ...extra };
  return flowOfDocx(parts, { fallbackTitle: 'Untitled' }).blocks;
}

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

test('the title and language come from the document, with a fallback for the title', () => {
  const withTitle = flowOfDocx({ document: doc(p('x')), styles: STYLES, core: CORE }, { fallbackTitle: 'report' });
  assert.equal(withTitle.title, 'Annual Report');
  assert.equal(withTitle.language, 'en-US');

  const without = flowOfDocx({ document: doc(p('x')) }, { fallbackTitle: 'quarterly figures' });
  assert.equal(without.title, 'quarterly figures');
  assert.equal(without.language, 'en', 'a document with no declared language is set in English');
});

test('headings keep the level the detector reads', () => {
  const body =
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Scope</w:t></w:r></w:p>` +
    p('Body text.');
  assert.deepEqual(
    flow(body).map((b) => (b.kind === 'heading' ? `h${b.level}` : b.kind)),
    ['h1', 'h2', 'paragraph'],
  );
});

test('bold and italic survive, and runs Word split are joined again', () => {
  const body =
    `<w:p><w:r><w:t xml:space="preserve">Plain </w:t></w:r>` +
    `<w:r><w:rPr><w:b/></w:rPr><w:t>bo</w:t></w:r>` +
    `<w:r><w:rPr><w:b/></w:rPr><w:t>ld</w:t></w:r>` +
    `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> and italic</w:t></w:r></w:p>`;
  const [block] = flow(body);
  assert.equal(block?.kind, 'paragraph');
  assert.deepEqual(block?.kind === 'paragraph' ? block.spans : [], [
    { text: 'Plain ' },
    { text: 'bold', bold: true },
    { text: ' and italic', italic: true },
  ]);
});

test('an empty paragraph is spacing, not a block', () => {
  assert.deepEqual(flow(`<w:p/>` + p('  ') + p('Real text.')).length, 1);
});

/*
 * A hyperlink arrives as several runs and has to come out as one link, or the
 * exported PDF holds four annotations over four fragments of its text, each
 * announced on its own. An internal bookmark is not a link at all: there is no
 * address to follow, and a link announced with nowhere to go is the 2.4.4
 * problem this product reports.
 */
test('an external hyperlink becomes one link; an internal bookmark does not', () => {
  const body =
    `<w:p><w:hyperlink r:id="rId10" xmlns:r="rel"><w:r><w:t>Section</w:t></w:r><w:r><w:t xml:space="preserve"> 508</w:t></w:r></w:hyperlink>` +
    `<w:r><w:t xml:space="preserve"> and </w:t></w:r>` +
    `<w:hyperlink r:id="rId11" xmlns:r="rel"><w:r><w:t>a bookmark</w:t></w:r></w:hyperlink></w:p>`;
  const [block] = flow(body);
  assert.deepEqual(block?.kind === 'paragraph' ? block.spans : [], [
    { text: 'Section 508', href: 'https://www.section508.gov/' },
    { text: ' and a bookmark' },
  ]);
});

test('a picture becomes a figure, with its description, mark and size', () => {
  const drawing = (docPr: string, extra = '') =>
    `<w:p><w:r><w:drawing><wp:inline xmlns:wp="p"><wp:extent cx="2540000" cy="1270000"/>` +
    `<wp:docPr id="3" name="Chart" ${docPr}${extra}` +
    `<a:graphic xmlns:a="a"><a:graphicData><pic:pic xmlns:pic="pic"><pic:blipFill><a:blip r:embed="rId9" xmlns:r="rel"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>` +
    `</wp:inline></w:drawing></w:r></w:p>`;

  const [described] = flow(drawing('descr="Spend by quarter"/>'));
  assert.deepEqual(described, {
    kind: 'figure',
    part: 'word/media/image1.png',
    alt: 'Spend by quarter',
    widthPt: 200,
    heightPt: 100,
    name: 'Chart',
  });

  const [decorative] = flow(
    drawing(
      '><a:extLst xmlns:a="a"><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="d" val="1"/></a:ext></a:extLst></wp:docPr>',
    ),
  );
  assert.equal(decorative?.kind === 'figure' && decorative.decorative, true);
  assert.equal(decorative?.kind === 'figure' && decorative.alt, undefined);
});

/*
 * A drawing sits inside a run, in the middle of a paragraph's text. The text
 * before it and the text after it are two blocks with the figure between them;
 * emitting the figures first, which is the easy way, reorders the document.
 */
test('a figure keeps its place in the middle of a paragraph', () => {
  const body =
    `<w:p><w:r><w:t xml:space="preserve">Before. </w:t></w:r>` +
    `<w:r><w:drawing><wp:inline xmlns:wp="p"><wp:docPr id="4" name="Pic" descr="A photograph"/>` +
    `<a:blip r:embed="rId9" xmlns:a="a" xmlns:r="rel"/></wp:inline></w:drawing></w:r>` +
    `<w:r><w:t>After.</w:t></w:r></w:p>`;
  assert.deepEqual(
    flow(body).map((b) => (b.kind === 'paragraph' ? b.spans.map((s) => s.text).join('') : b.kind)),
    ['Before. ', 'figure', 'After.'],
  );
});

/*
 * Word stores every text box twice — once for modern readers and once in
 * `mc:Fallback` for old ones. Setting both puts the text in the document twice.
 */
test('text in a floating box is read once, in the flow', () => {
  const box = (text: string) =>
    `<w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>`;
  const body =
    p('Before the box.') +
    `<w:p><w:r><mc:AlternateContent xmlns:mc="mc"><mc:Choice Requires="wps"><w:drawing><wp:inline xmlns:wp="p">${box(
      'Pull quote',
    )}</wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict>${box('Pull quote')}</w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>` +
    p('After the box.');
  const texts = flow(body).map((b) => (b.kind === 'paragraph' ? b.spans.map((s) => s.text).join('') : b.kind));
  assert.deepEqual(texts, ['Before the box.', 'Pull quote', 'After the box.']);
});

test('a table carries its header row, its column widths and its spans', () => {
  const body =
    `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>` +
    `<w:tc><w:p><w:r><w:t>Criterion</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Result</w:t></w:r></w:p></w:tc></w:tr>` +
    `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Chapter 5</w:t></w:r></w:p></w:tc></w:tr>` +
    `<w:tr><w:tc><w:p><w:r><w:t>1.1.1</w:t></w:r></w:p><w:p><w:r><w:t>Non-text Content</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:p><w:r><w:t>Supports</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const [block] = flow(body);
  assert.equal(block?.kind, 'table');
  if (block?.kind !== 'table') return;
  assert.deepEqual(block.widths, [4000, 2000]);
  assert.equal(block.rows[0]?.cells[0]?.header, true);
  assert.equal(block.rows[1]?.cells[0]?.colSpan, 2);
  assert.equal(block.rows[2]?.cells[0]?.header, undefined);
  assert.deepEqual(
    block.rows[2]?.cells[0]?.paragraphs.map((spans) => spans.map((s) => s.text).join('')),
    ['1.1.1', 'Non-text Content'],
    'a cell with two paragraphs keeps both',
  );
});

/* ── Numbering ───────────────────────────────────────────────────────── */

/**
 * A .docx does not store "1." or "•" anywhere. Word draws the marker from
 * `numbering.xml`, counting as it goes, and an export that writes its own text
 * has to do the same counting — which is the part most likely to be visibly
 * wrong on the first page of a real document.
 */
const NUMBERING = `<w:numbering ${W}>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num>
</w:numbering>`;

const item = (numId: string, ilvl: number, text: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('a numbered list counts, and a nested level restarts under each number', () => {
  const body =
    item('1', 0, 'First') +
    item('1', 1, 'First child') +
    item('1', 1, 'Second child') +
    item('1', 0, 'Second') +
    item('1', 1, 'Child again');
  const markers = flow(body, { numbering: NUMBERING }).map((b) => (b.kind === 'listItem' ? b.marker : b.kind));
  assert.deepEqual(markers, ['1.', 'a)', 'b)', '2.', 'a)']);
});

test('a bulleted list is bulleted, and an overridden start is honoured', () => {
  const bullets = flow(item('2', 0, 'One') + item('2', 0, 'Two'), { numbering: NUMBERING });
  assert.deepEqual(
    bullets.map((b) => (b.kind === 'listItem' ? b.marker : b.kind)),
    ['•', '•'],
  );
  const restarted = flow(item('3', 0, 'Seventh'), { numbering: NUMBERING });
  assert.equal(restarted[0]?.kind === 'listItem' && restarted[0].marker, '7.');
});

test('a list in a document with no numbering part still reads as a list', () => {
  const blocks = flow(item('1', 0, 'Something'));
  assert.equal(blocks[0]?.kind, 'listItem');
  assert.equal(blocks[0]?.kind === 'listItem' && blocks[0].marker, '•');
});

test('the number formats are the ones Word writes', () => {
  assert.equal(formatNumber(4, 'decimal'), '4');
  assert.equal(formatNumber(4, 'lowerLetter'), 'd');
  assert.equal(formatNumber(27, 'lowerLetter'), 'aa', 'Word overflows to aa, not to a1');
  assert.equal(formatNumber(4, 'upperRoman'), 'IV');
  assert.equal(formatNumber(1944, 'lowerRoman'), 'mcmxliv');
  assert.equal(formatNumber(3, 'none'), '');
});

/* ── Language of parts ───────────────────────────────────────────────── */

test('a paragraph wholly in another language carries that language', () => {
  const french = `<w:p><w:r><w:rPr><w:lang w:val="fr-FR"/></w:rPr><w:t>Bonjour le monde.</w:t></w:r></w:p>`;
  const mixed =
    `<w:p><w:r><w:t xml:space="preserve">He said </w:t></w:r>` +
    `<w:r><w:rPr><w:lang w:val="fr-FR"/></w:rPr><w:t>bonjour</w:t></w:r></w:p>`;
  const [one, two] = flow(french + mixed);
  assert.equal(one?.kind === 'paragraph' && one.lang, 'fr-FR');
  assert.equal(
    two?.kind === 'paragraph' && two.lang,
    undefined,
    'two languages in one paragraph is a judgement, not a fact the export can carry',
  );
});

test('merging spans leaves a whitespace-only paragraph empty', () => {
  assert.deepEqual(mergeSpans([{ text: ' ' }, { text: '\t' }]), []);
  assert.deepEqual(mergeSpans([{ text: 'a' }, { text: 'b' }]), [{ text: 'ab' }]);
  assert.deepEqual(mergeSpans([{ text: 'a', bold: true }, { text: 'b' }]), [{ text: 'a', bold: true }, { text: 'b' }]);
});

/* ── Notes ───────────────────────────────────────────────────────────── */

/**
 * A footnote's text is in another part of the archive, and the body holds only
 * a reference to it. An export that read `document.xml` and stopped would drop
 * the note without a trace — the customer's own words, gone from a delivered
 * document, with nothing in the file to show it had happened.
 */
const FOOTNOTES = `<w:footnotes ${W}>
  <w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:id="1"><w:p><w:r><w:t>Measured against the Revised Section 508 Standards, March 2017.</w:t></w:r></w:p></w:footnote>
  <w:footnote w:id="2"><w:p><w:r><w:t>Two agencies were consulted.</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

const ref = (id: string) => `<w:r><w:footnoteReference w:id="${id}"/></w:r>`;

test('a footnote is marked in the text and set out at the end', () => {
  const body =
    `<w:p><w:r><w:t xml:space="preserve">The standard applies.</w:t></w:r>${ref('2')}</w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">And it was measured.</w:t></w:r>${ref('1')}</w:p>`;
  const blocks = flow(body, { footnotes: FOOTNOTES });
  const text = blocks.map((b) =>
    b.kind === 'paragraph' ? b.spans.map((s) => s.text).join('') : b.kind === 'heading' ? `# ${b.spans[0]?.text}` : b.kind,
  );
  assert.deepEqual(text, [
    'The standard applies.[1]',
    'And it was measured.[2]',
    '# Notes',
    '[1] Two agencies were consulted.',
    '[2] Measured against the Revised Section 508 Standards, March 2017.',
  ]);
});

test('a note referred to twice is numbered once, and separators are not notes', () => {
  const body = `<w:p><w:r><w:t>First.</w:t></w:r>${ref('1')}</w:p><w:p><w:r><w:t>Again.</w:t></w:r>${ref('1')}</w:p>`;
  const blocks = flow(body, { footnotes: FOOTNOTES });
  const paragraphs = blocks.filter((b) => b.kind === 'paragraph');
  assert.equal(paragraphs.length, 3, 'two body paragraphs and one note');
  assert.equal(blocks.filter((b) => b.kind === 'heading').length, 1);
});

test('a document with no notes gets no Notes heading', () => {
  assert.deepEqual(
    flow(p('Nothing to note.'), { footnotes: FOOTNOTES }).map((b) => b.kind),
    ['paragraph'],
  );
});
