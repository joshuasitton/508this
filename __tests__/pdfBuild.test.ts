import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PdfDocument, PdfName, pdfText, type PdfDict } from '../src/domain/pdf';
import { buildPdf, type Block, type Cell, type EmbeddedImage, type PdfModel } from '../src/domain/pdfBuild';
import { detectPdf, readPdfFacts, readingOrder, type StructElement } from '../src/domain/pdfDetect';

/**
 * The export writes a PDF. These tests read it back with 508This's own PDF
 * reader and run 508This's own PDF detector over it, which is the only way the
 * claim on the page — "the exported PDF was checked and conforms" — can be
 * anything other than marketing.
 *
 * Nothing here needs `inflate`: the writer compresses nothing but image data,
 * on purpose, so the whole file can be read with no dependencies installed.
 * A model with an image would need one, and the image tests below use bytes
 * that are already raw.
 */
const noInflate = (): Uint8Array => {
  throw new Error('nothing in a built PDF should need inflating');
};

function read(bytes: Uint8Array): PdfDocument {
  return PdfDocument.parse(bytes, noInflate);
}

function built(blocks: Block[], overrides: Partial<PdfModel> = {}): Uint8Array {
  const result = buildPdf({
    title: 'Quarterly accessibility report',
    language: 'en-US',
    now: '2026-09-28T12:00:00.000Z',
    producer: '508This',
    blocks,
    ...overrides,
  });
  assert.ok(result.ok, `build refused: ${result.ok ? '' : result.characters.join('')}`);
  return result.bytes;
}

/** One cell of plain text, and one header cell of it. */
const cell = (text: string): Cell => ({ paragraphs: [[{ text }]] });
const head = (text: string): Cell => ({ paragraphs: [[{ text }]], header: true });

const PROSE: Block[] = [
  { kind: 'heading', level: 1, spans: [{ text: 'Quarterly accessibility report' }] },
  {
    kind: 'paragraph',
    spans: [
      { text: 'This document was remediated by 508This and exported as a tagged PDF. ' },
      { text: 'Every figure carries a description', bold: true },
      { text: ', and the reading order is the order it was written in.' },
    ],
  },
  { kind: 'heading', level: 2, spans: [{ text: 'What was changed' }] },
  { kind: 'listItem', level: 0, marker: '1.', spans: [{ text: 'The document language is set.' }] },
  { kind: 'listItem', level: 0, marker: '2.', spans: [{ text: 'The table below has a header row.' }] },
  {
    kind: 'table',
    widths: [2, 1, 1],
    rows: [
      { cells: [head('Criterion'), head('Level'), head('Result')] },
      { cells: [cell('1.1.1 Non-text Content'), cell('A'), cell('Supports')] },
      { cells: [cell('1.3.1 Info and Relationships'), cell('A'), cell('Supports')] },
    ],
  },
  {
    kind: 'paragraph',
    spans: [
      { text: 'The standard itself is at ' },
      { text: 'the Access Board’s Section 508 standards', href: 'https://www.access-board.gov/ict/' },
      { text: '.' },
    ],
  },
];

/** A 2×2 greyscale picture, raw, which needs no filter and so no zlib. */
const GREY: EmbeddedImage = {
  width: 2,
  height: 2,
  data: Uint8Array.from([0, 90, 180, 255]),
  filter: null,
  colourSpace: 'DeviceGray',
};

function flatten(elements: readonly StructElement[]): StructElement[] {
  const out: StructElement[] = [];
  const walk = (list: readonly StructElement[]) => {
    for (const el of list) {
      out.push(el);
      walk(el.kids);
    }
  };
  walk(elements);
  return out;
}

test('what the writer writes, our own reader opens', () => {
  const doc = read(built(PROSE));
  const facts = readPdfFacts(doc);
  assert.equal(facts.pages, 1);
  assert.equal(facts.title, 'Quarterly accessibility report');
  assert.equal(facts.language, 'en-US');
  assert.ok(facts.displayDocTitle, 'a title nobody is told to display is not a title');
  assert.ok(facts.tagged);
});

/*
 * The one that matters. Everything else in this file is a control for it: if
 * the detector reports nothing on the export, the export meets the criteria
 * this product sells — and the controls below prove the detector was looking.
 */
test('the detector finds nothing in the exported document', () => {
  const blocks: Block[] = [...PROSE, { kind: 'figure', image: GREY, alt: 'A grey gradient, four squares.' }];
  const findings = detectPdf(read(built(blocks)));
  assert.deepEqual(findings, [], findings.map((f) => `${f.kind}: ${f.description}`).join('\n'));
});

test('a figure with no description is reported, not papered over', () => {
  const findings = detectPdf(read(built([...PROSE, { kind: 'figure', image: GREY }])));
  assert.equal(findings.length, 1, findings.map((f) => f.kind).join(', '));
  assert.equal(findings[0]?.kind, 'image-alt');
  assert.match(findings[0]?.location ?? '', /figure 1, page 1/);
});

test('a decorative figure is an artifact, and no reader announces it', () => {
  const bytes = built([...PROSE, { kind: 'figure', image: GREY, decorative: true }]);
  const doc = read(bytes);
  const facts = readPdfFacts(doc);
  assert.equal(
    flatten(facts.elements).filter((el) => el.role === 'Figure').length,
    0,
    'a decorative picture must not be in the tag tree at all',
  );
  assert.equal(facts.rasterImages, 1, 'and it must still be in the document');
  assert.deepEqual(detectPdf(doc), []);
});

test('a table of data cells with no header row is reported', () => {
  const rows = PROSE.map((block) =>
    block.kind === 'table'
      ? { ...block, rows: block.rows.map((row) => ({ cells: row.cells.map((c) => ({ paragraphs: c.paragraphs })) })) }
      : block,
  );
  const findings = detectPdf(read(built(rows as Block[])));
  assert.equal(findings.length, 1, findings.map((f) => f.kind).join(', '));
  assert.equal(findings[0]?.kind, 'table-header');
});

test('a link is announced by its own words, and generic words are reported', () => {
  const doc = read(built(PROSE));
  const annotation = linkAnnotation(doc);
  assert.equal(pdfText(doc.resolve(annotation.get('Contents'))), 'the Access Board’s Section 508 standards');
  assert.equal(pdfText(doc.at(annotation, 'A', 'URI')), 'https://www.access-board.gov/ict/');

  const vague: Block[] = [
    { kind: 'paragraph', spans: [{ text: 'Read it here: ' }, { text: 'click here', href: 'https://example.gov/' }] },
  ];
  const findings = detectPdf(read(built(vague)));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'link-text');
});

function linkAnnotation(doc: PdfDocument): PdfDict {
  for (const page of doc.pages) {
    const annots = doc.resolve(page.get('Annots'));
    if (!Array.isArray(annots)) continue;
    for (const ref of annots) {
      const annot = doc.resolve(ref);
      if (annot instanceof Map) return annot;
    }
  }
  throw new Error('the document has no link annotation');
}

/*
 * A link's text has to be *inside* the Link element, not merely beside it: a
 * reader walks the tree, and text tagged as the paragraph's own is text the
 * link does not have. This was wrong in the first draft, which put both under
 * one marked-content id and produced a link a reader announced as empty.
 */
test('a link owns the text it is made of, and points at its annotation', () => {
  const doc = read(built(PROSE));
  const link = flatten(readPdfFacts(doc).elements).find((el) => el.role === 'Link');
  assert.ok(link, 'no Link element in the tag tree');
  const kids = doc.resolve(link.dict.get('K'));
  const list = Array.isArray(kids) ? kids : [kids];
  const kinds = list.map((kid) => {
    const value = doc.resolve(kid);
    const type = value instanceof Map ? doc.resolve(value.get('Type')) : null;
    return type instanceof PdfName ? type.name : '';
  });
  assert.ok(kinds.includes('MCR'), 'the link has no text of its own');
  assert.ok(kinds.includes('OBJR'), 'the link does not reach its annotation');
});

test('the reading order is the order the document was written in', () => {
  const doc = read(built(PROSE));
  const order = readingOrder(doc);
  assert.ok(order.length > 6, `only ${order.length} marked pieces`);
  // Page by page, ids ascend: the tag tree reads the page the way the page
  // paints it, which is what 1.3.2 compares.
  let page = 0;
  let previous = -1;
  for (const ref of order) {
    if (ref.page !== page) {
      page = ref.page;
      previous = -1;
    }
    assert.ok(ref.mcid > previous, `mcid ${ref.mcid} follows ${previous} on page ${ref.page}`);
    previous = ref.mcid;
  }
});

test('a long document flows onto more pages, and every page has text on it', () => {
  const many: Block[] = [{ kind: 'heading', level: 1, spans: [{ text: 'A long report' }] }];
  for (let i = 0; i < 60; i += 1) {
    many.push({
      kind: 'paragraph',
      spans: [
        {
          text:
            `Paragraph ${i + 1}. ` +
            'Section 508 requires that electronic content be accessible to people with disabilities, ' +
            'which for a document means its structure is readable and not merely its appearance.',
        },
      ],
    });
  }
  const doc = read(built(many));
  const facts = readPdfFacts(doc);
  assert.ok(facts.pages > 3, `${facts.pages} pages`);
  assert.deepEqual(facts.pagesWithoutText, [], 'a page with no text reads as a picture of a page');
  assert.deepEqual(detectPdf(doc), []);
});

/*
 * A paragraph that straddles a page break is one element with marked content
 * on two pages. It is the case the parent tree exists for, and the case a
 * writer that assumed "one element, one page" would silently get wrong.
 */
test('a paragraph across a page break stays one element', () => {
  const filler: Block[] = [{ kind: 'heading', level: 1, spans: [{ text: 'A long report' }] }];
  for (let i = 0; i < 25; i += 1) {
    filler.push({ kind: 'paragraph', spans: [{ text: `Filler paragraph number ${i + 1}, which takes up room.` }] });
  }
  const long =
    'A single very long paragraph, written to be longer than the space left on the page it starts on. '.repeat(14);
  const doc = read(built([...filler, { kind: 'paragraph', spans: [{ text: long }] }]));
  const order = readingOrder(doc);
  const pagesTouched = new Set(order.map((o) => o.page));
  assert.ok(pagesTouched.size > 1);

  const paragraphs = flatten(readPdfFacts(doc).elements).filter((el) => el.role === 'P');
  const last = paragraphs[paragraphs.length - 1];
  assert.ok(last);
  const kids = doc.resolve(last.dict.get('K'));
  const list = Array.isArray(kids) ? kids : [kids];
  const pages = new Set(
    list.map((kid) => {
      const value = doc.resolve(kid);
      const pg = value instanceof Map ? doc.resolve(value.get('Pg')) : null;
      return pg instanceof Map ? doc.pages.indexOf(pg) + 1 : 0;
    }),
  );
  assert.equal(pages.size, 2, `the last paragraph is marked on pages ${[...pages].join(', ')}`);
  assert.deepEqual(detectPdf(doc), []);
});

test('a table row too tall for the page is cut, not overflowed', () => {
  const long = 'A cell with a great deal of text in it, enough to fill a column for most of a page. '.repeat(45);
  const doc = read(
    built([
      {
        kind: 'table',
        rows: [
          { cells: [head('Left'), head('Right')] },
          { cells: [{ paragraphs: [[{ text: long }]] }, { paragraphs: [[{ text: long }]] }] },
        ],
      },
    ]),
  );
  const facts = readPdfFacts(doc);
  assert.ok(facts.pages > 1, 'the row should have been sliced across pages');
  assert.deepEqual(detectPdf(doc), []);

  const cells = flatten(facts.elements).filter((el) => el.role === 'TD');
  assert.equal(cells.length, 2, 'slicing a row must not invent cells');
});

test('text the encoding cannot set refuses the export rather than changing it', () => {
  const result = buildPdf({
    title: 'Report',
    language: 'en',
    now: '2026-09-28T12:00:00.000Z',
    blocks: [{ kind: 'paragraph', spans: [{ text: '提案書 and a résumé' }] }],
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.characters.includes('提'));
  // The accented Latin is fine; it is the characters WinAnsi has no place for.
  assert.ok(!result.ok && !result.characters.includes('é'));
});

/*
 * Typographic characters a Word document is full of must not trip the refusal
 * above: curly quotes and dashes are in WinAnsi, and the ones that are not
 * have exact equivalents that `pdfEncode` folds.
 */
test('the punctuation a real document uses does not refuse', () => {
  const result = buildPdf({
    title: 'Notes — draft',
    language: 'en',
    now: '2026-09-28T12:00:00.000Z',
    blocks: [
      {
        kind: 'paragraph',
        spans: [{ text: '“Quoted” – with an en dash, an em dash —, a bullet •, a no-break space and a ﬁ ligature.' }],
      },
    ],
  });
  assert.ok(result.ok, result.ok ? '' : result.characters.join(''));
});

test('the same document builds the same bytes twice', () => {
  assert.deepEqual(built(PROSE), built(PROSE), 'a delivered file that differs run to run cannot be a pure function');
});

/**
 * A heading alone at the foot of a page names a section that starts overleaf.
 * The sweep is the test rather than one carefully-placed heading: whatever the
 * measurements are, no position in this range may strand one.
 */
test('a heading is never left at the bottom of a page on its own', () => {
  for (let fillers = 20; fillers <= 32; fillers += 1) {
    const blocks: Block[] = [{ kind: 'heading', level: 1, spans: [{ text: 'A report' }] }];
    for (let i = 0; i < fillers; i += 1) {
      blocks.push({ kind: 'paragraph', spans: [{ text: `Filler paragraph number ${i + 1}, taking up room.` }] });
    }
    blocks.push({ kind: 'heading', level: 2, spans: [{ text: 'The last section' }] });
    blocks.push({ kind: 'paragraph', spans: [{ text: 'The first paragraph of the last section.' }] });

    const doc = read(built(blocks));
    const all = flatten(readPdfFacts(doc).elements);
    const heading = all.filter((el) => el.role === 'H2').at(-1);
    const paragraph = all.filter((el) => el.role === 'P').at(-1);
    assert.equal(
      heading?.page,
      paragraph?.page,
      `with ${fillers} paragraphs before it, the heading is on page ${heading?.page} and its text on ${paragraph?.page}`,
    );
  }
});
