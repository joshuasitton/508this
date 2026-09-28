/**
 * A tagged PDF, written from scratch.
 *
 * This is the last artefact in the delivered package. A .docx can be fixed in
 * place — alternative text, heading levels, header rows and language are all
 * XML attributes, so the customer's own file comes back changed as little as
 * possible. A PDF *export* is the opposite problem: there is no PDF to fix, so
 * one has to be written, and everything Section 508 asks about a PDF has to be
 * put there deliberately.
 *
 * ## What this is, and what it is not
 *
 * It is a **conformant reading copy**: the document's words, headings, lists,
 * tables, links and figures, with a tag tree that says which is which, a
 * reading order, alternative text on every figure that has any, a language and
 * a title. Run 508This's own PDF detector over the output and it finds nothing
 * the source document had not already left open — which is the only claim a
 * conformance service should make about a file it wrote, and
 * `__tests__/pdfBuild.test.ts` is where that claim is checked.
 *
 * It is **not a visual replica** of the Word file. Text is set in the four
 * standard Helvetica faces at sizes this file chooses, lines are broken here,
 * and colour is not carried across. Two reasons, and neither is laziness:
 *
 * - **Fonts.** Reproducing the original's typography means embedding its fonts,
 *   which means having them and having a licence to redistribute them inside a
 *   document. The standard fourteen need neither: every reader has them, so the
 *   file is small and sets the same everywhere, including on a government
 *   machine with nothing installed.
 * - **Colour.** Black on white is 21:1 and cannot fail 1.4.3, and text that was
 *   set apart by colour alone in the original is set apart by weight here.
 *   Carrying the palette across would import the two findings this product
 *   exists to remove.
 *
 * Where visual fidelity matters more than automation, Word's own "Save as PDF"
 * on the remediated .docx is the better tool, and the reviewer is told so on
 * the page rather than left to find out. That is a real trade, written down.
 *
 * ## Why a writer and not a converter
 *
 * LibreOffice headless was the obvious route and was tried first: the copy in
 * this project's container cannot open any .docx at all, Word-authored files
 * included, so an export built on it could not be run or verified here. A
 * converter nobody can test is not a feature. Everything below is arithmetic
 * over `pdfFontWidths.ts` and the object grammar `pdfWrite.ts` already
 * serialises, so it runs wherever the tests do — with nothing installed.
 *
 * ## The shape of the file
 *
 * One page tree, four fonts, one content stream per page, an image XObject per
 * figure, and a structure tree whose elements point back at marked content in
 * those streams. Two rules matter and are easy to get wrong:
 *
 * - **Every piece of painted text is inside marked content** that some
 *   structure element claims, or inside an `/Artifact` that deliberately none
 *   does. The page footer is the artifact; everything else is content.
 * - **The parent tree is the inverse of the structure tree** — page by page,
 *   marked-content id to the element that owns it. A reader uses it to answer
 *   "what is this text?", and a structure tree without one is a tree no
 *   assistive technology can enter from the page.
 */

import { PdfName, PdfRef, PdfStream, type PdfDict, type PdfValue } from './pdf';
import { encodeWinAnsi, foldToWinAnsi } from './pdfEncode';
import { FONT_WIDTHS, type Face } from './pdfFontWidths';
import { pdfString, serialize } from './pdfWrite';

/* ── The page, in points ─────────────────────────────────────────────── */

const PAGE_WIDTH = 612; // US Letter, which is what a federal filing expects
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const TOP = PAGE_HEIGHT - MARGIN;
const BOTTOM = MARGIN;

const BODY_SIZE = 11;
const LINE_HEIGHT = 1.35;
const PARAGRAPH_GAP = 7;
const FOOTER_SIZE = 9;
const FOOTER_BASELINE = MARGIN - 28;

/** Heading sizes by level. Six, because a .docx can carry nine and a reader stops caring. */
const HEADING_SIZE = [0, 19, 16, 13.5, 12, 11.5, 11] as const;
const HEADING_BEFORE = [0, 16, 14, 12, 11, 10, 10] as const;
const HEADING_AFTER = [0, 7, 6, 5, 4, 4, 4] as const;

const CELL_PAD = 5;
const RULE = 0.5;
const INDENT = 18;
const HEADER_GREY = 0.902; // black on this is about 17:1

/* ── What a caller hands over ────────────────────────────────────────── */

/** A run of text with the only variations the export carries. */
export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** An absolute URL. A span with one is underlined and gets a link annotation. */
  href?: string;
}

/**
 * A figure's picture, already in a form a PDF can hold.
 *
 * `filter` is the PDF filter its bytes are in — `DCTDecode` for a JPEG passed
 * through untouched, `FlateDecode` for samples the server deflated. Encoding is
 * not done here: compression is a `node:zlib` job and this file takes no
 * dependencies, the same split `pdf.ts` makes for reading.
 */
export interface EmbeddedImage {
  width: number;
  height: number;
  data: Uint8Array;
  filter: 'DCTDecode' | 'FlateDecode' | null;
  colourSpace: 'DeviceRGB' | 'DeviceGray';
  /** An 8-bit alpha channel, if the picture has one. */
  smask?: { data: Uint8Array; filter: 'FlateDecode' | null };
}

export type Block =
  | { kind: 'heading'; level: number; spans: Span[]; lang?: string }
  | { kind: 'paragraph'; spans: Span[]; lang?: string }
  | { kind: 'listItem'; level: number; marker: string; spans: Span[]; lang?: string }
  | { kind: 'figure'; image: EmbeddedImage; alt?: string; decorative?: boolean; widthPt?: number; heightPt?: number }
  | { kind: 'table'; rows: Row[]; widths?: readonly number[] };

export interface Row {
  cells: Cell[];
}

export interface Cell {
  /** One entry per paragraph in the cell, because Word cells often hold several. */
  paragraphs: Span[][];
  /** A header cell: tagged `TH`, set bold, on a tinted ground. */
  header?: boolean;
  /** Columns this cell covers, from Word's `gridSpan`. */
  colSpan?: number;
}

export interface PdfModel {
  /** 2.4.2. Never empty: the caller falls back to the filename's stem. */
  title: string;
  /** 3.1.1, as a BCP 47 tag. */
  language: string;
  blocks: Block[];
  /** ISO 8601. The one otherwise non-deterministic input, so the output is reproducible. */
  now: string;
  /** Named in `/Producer` and in the footer beside the page number. */
  producer?: string;
}

export type BuildResult =
  | { ok: true; bytes: Uint8Array; pages: number }
  | { ok: false; reason: 'unsupported-characters'; characters: string[] };

/* ── Measuring ───────────────────────────────────────────────────────── */

function faceOf(bold: boolean, italic: boolean): Face {
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

const FONT_KEY: Record<Face, string> = {
  Helvetica: 'F1',
  'Helvetica-Bold': 'F2',
  'Helvetica-Oblique': 'F3',
  'Helvetica-BoldOblique': 'F4',
};

/** The width of already-folded text in one face, in points. */
export function widthOf(text: string, face: Face, size: number): number {
  const widths = FONT_WIDTHS[face];
  const { bytes } = encodeWinAnsi(text);
  let thousandths = 0;
  for (const byte of bytes) thousandths += widths[byte] || widths[0x20] || 0;
  return (thousandths * size) / 1000;
}

/** Every character in the model that WinAnsi cannot set, in order, without repeats. */
export function unsupportedCharacters(model: PdfModel): string[] {
  const out: string[] = [];
  const check = (text: string) => {
    for (const ch of encodeWinAnsi(text).missing) if (!out.includes(ch)) out.push(ch);
  };
  check(model.title);
  for (const block of model.blocks) {
    if (block.kind === 'figure') {
      if (block.alt) check(block.alt);
      continue;
    }
    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const paragraph of cell.paragraphs) for (const span of paragraph) check(span.text);
        }
      }
      continue;
    }
    if (block.kind === 'listItem') check(block.marker);
    for (const span of block.spans) check(span.text);
  }
  return out;
}

/* ── Lines ───────────────────────────────────────────────────────────── */

/** One piece of a line: text in one face, at one size, owned by at most one link. */
interface Piece {
  text: string;
  face: Face;
  size: number;
  width: number;
  /** Index into the block's links. */
  link?: number;
}

interface Line {
  pieces: Piece[];
  height: number;
}

interface Token extends Piece {
  space: boolean;
}

interface LinkSpec {
  href: string;
  /** What the link says, which is what a reader announces. */
  text: string;
}

/**
 * Spans to tokens — words and the spaces between them — carrying the face and
 * the link each came from. Wrapping happens over tokens rather than spans
 * because a line break lands between two words, and a word can be half bold.
 */
function tokenise(spans: readonly Span[], size: number): { tokens: Token[]; links: LinkSpec[] } {
  const tokens: Token[] = [];
  const links: LinkSpec[] = [];
  for (const span of spans) {
    const face = faceOf(span.bold === true, span.italic === true);
    // A tab is not painted; it stands in for the spaces it represents.
    const text = foldToWinAnsi(span.text).replace(/\t/g, '  ');
    let link: number | undefined;
    if (span.href && text.trim() !== '') {
      link = links.length;
      links.push({ href: span.href, text: text.trim() });
    }
    for (const part of text.split(/(\s+)/)) {
      if (part === '') continue;
      const space = /^\s+$/.test(part);
      const piece = space ? ' ' : part;
      tokens.push({ text: piece, face, size, width: widthOf(piece, face, size), space, link });
    }
  }
  return { tokens, links };
}

/** Greedy wrap. A word wider than the line is split by character, never dropped. */
function wrap(tokens: readonly Token[], maxWidth: number): Line[] {
  const lines: Line[] = [];
  let pieces: Piece[] = [];
  let width = 0;
  let size = 0;

  const flush = () => {
    while (pieces.length && pieces[pieces.length - 1]!.text === ' ') {
      width -= pieces[pieces.length - 1]!.width;
      pieces.pop();
    }
    if (pieces.length === 0) return;
    lines.push({ pieces, height: size * LINE_HEIGHT });
    pieces = [];
    width = 0;
    size = 0;
  };

  for (const token of tokens) {
    const piece: Piece = { text: token.text, face: token.face, size: token.size, width: token.width, link: token.link };
    if (token.space && pieces.length === 0) continue; // no line starts with a space
    if (pieces.length === 0 && !token.space && token.width > maxWidth) {
      for (const chunk of splitToFit(token, maxWidth)) {
        lines.push({ pieces: [chunk], height: chunk.size * LINE_HEIGHT });
      }
      continue;
    }
    if (width + token.width <= maxWidth || pieces.length === 0) {
      pieces.push(piece);
      width += token.width;
      size = Math.max(size, token.size);
      continue;
    }
    flush();
    if (token.space) continue;
    pieces.push(piece);
    width = token.width;
    size = token.size;
  }
  flush();
  return lines.length ? lines : [{ pieces: [], height: (tokens[0]?.size ?? BODY_SIZE) * LINE_HEIGHT }];
}

function splitToFit(token: Token, maxWidth: number): Piece[] {
  const out: Piece[] = [];
  let text = '';
  let width = 0;
  for (const ch of token.text) {
    const w = widthOf(ch, token.face, token.size);
    if (text !== '' && width + w > maxWidth) {
      out.push({ text, face: token.face, size: token.size, width, link: token.link });
      text = '';
      width = 0;
    }
    text += ch;
    width += w;
  }
  if (text !== '') out.push({ text, face: token.face, size: token.size, width, link: token.link });
  return out;
}

/* ── The structure tree, as it is built ──────────────────────────────── */

interface StructElement {
  /** A standard tag: Document, P, H1…H6, L, LI, Lbl, LBody, Figure, Table, TR, TH, TD, Link. */
  tag: string;
  num: number;
  parent?: StructElement;
  /** Marked-content references, annotation references and child elements, in reading order. */
  kids: Array<{ page: number; mcid: number } | { objr: number; page: number } | StructElement>;
  /** The first page any of its content appears on. */
  page?: number;
  alt?: string;
  lang?: string;
  /** Columns a `TH` or `TD` covers. A reader needs it to know the shape of the table. */
  colSpan?: number;
}

function isElement(kid: StructElement['kids'][number]): kid is StructElement {
  return 'tag' in kid;
}

/* ── The writer ──────────────────────────────────────────────────────── */

interface Page {
  num: number;
  /** Content stream operators, latin-1, in painting order. */
  ops: string[];
  annots: number[];
  images: Map<string, number>;
  /** Index into the parent tree, which is also the page's `/StructParents`. */
  parents: number;
}

/**
 * A link being painted: one annotation per page its text reaches.
 *
 * `element` is created when the link's first piece of text is painted, not
 * when the link is found. That ordering is not a detail: a structure element's
 * children are read in the order they were added, so a `Link` appended to its
 * paragraph before the paragraph's own text would be read *first* — a reading
 * order that puts the end of the sentence at its beginning. The first draft did
 * exactly that, and `pdfBuild.test.ts` caught it by walking the tag tree's
 * marked-content ids and finding them out of sequence.
 */
interface OpenLink {
  owner: StructElement;
  element?: StructElement;
  href: string;
  text: string;
  boxes: Map<number, { left: number; right: number; top: number; bottom: number }>;
}

export function buildPdf(model: PdfModel): BuildResult {
  const missing = unsupportedCharacters(model);
  if (missing.length) return { ok: false, reason: 'unsupported-characters', characters: missing };
  return new Writer(model).run();
}

class Writer {
  private readonly model: PdfModel;
  private readonly objects = new Map<number, PdfValue>();
  private next = 1;

  private readonly pages: Page[] = [];
  private page: Page;
  /** The baseline the next line will sit on, working down the page. */
  private y = TOP;

  private readonly root: StructElement;
  private readonly imageObjects = new Map<EmbeddedImage, number>();
  /**
   * Parent-tree rows. A page's row is the elements owning its marked content,
   * in mcid order; an annotation's row is the single element it belongs to.
   */
  private readonly parentRows: Array<StructElement[] | StructElement> = [];
  private structRootNum = 0;

  constructor(model: PdfModel) {
    this.model = model;
    this.root = { tag: 'Document', num: this.alloc(), kids: [] };
    this.page = this.openPage();
  }

  private alloc(): number {
    const num = this.next;
    this.next += 1;
    return num;
  }

  private openPage(): Page {
    const page: Page = { num: this.alloc(), ops: [], annots: [], images: new Map(), parents: this.parentRows.length };
    this.parentRows.push([]);
    this.pages.push(page);
    this.page = page;
    this.y = TOP;
    return page;
  }

  /** 1-based, as a reader counts pages. */
  private get pageNumber(): number {
    return this.pages.length;
  }

  /** A vertical gap, or a new page when the gap would run off this one. */
  private gap(height: number): void {
    if (this.y - height >= BOTTOM) this.y -= height;
    else this.openPage();
  }

  private fits(height: number): boolean {
    return this.y - height >= BOTTOM;
  }

  private element(tag: string, parent: StructElement, extra: Partial<StructElement> = {}): StructElement {
    const el: StructElement = { tag, num: this.alloc(), parent, kids: [], ...extra };
    parent.kids.push(el);
    return el;
  }

  /** Open marked content owned by `el` on the current page. */
  private mark(el: StructElement, tag = el.tag): void {
    const row = this.parentRows[this.page.parents];
    const owners = Array.isArray(row) ? row : [];
    const mcid = owners.length;
    owners.push(el);
    el.kids.push({ page: this.pageNumber, mcid });
    el.page ??= this.pageNumber;
    this.page.ops.push(`/${tag} <</MCID ${mcid}>> BDC`);
  }

  private endMark(): void {
    this.page.ops.push('EMC');
  }

  /* ── Painting text ──────────────────────────────────────────────── */

  /**
   * One line of pieces, starting at `left`, on the current baseline.
   *
   * Pieces are grouped by who owns them: the element itself, or one of the
   * links inside it. Each group is its own marked content, which is what puts a
   * link's text *under* the `Link` element in the tag tree rather than merely
   * near it — and what lets the reading order run straight through both.
   */
  private paintLine(line: Line, left: number, element: StructElement, links: readonly OpenLink[]): void {
    let x = left;
    let index = 0;
    while (index < line.pieces.length) {
      const first = line.pieces[index]!;
      let end = index;
      while (end < line.pieces.length && line.pieces[end]!.link === first.link) end += 1;
      const group = line.pieces.slice(index, end);
      const link = first.link === undefined ? undefined : links[first.link];

      if (link) link.element ??= this.element('Link', link.owner);
      this.mark(link?.element ?? element, link ? 'Link' : element.tag);
      const start = x;
      for (const piece of group) {
        if (piece.text.trim() !== '') {
          this.page.ops.push(
            `BT /${FONT_KEY[piece.face]} ${fmt(piece.size)} Tf ${fmt(x)} ${fmt(this.y)} Td ${literal(piece.text)} Tj ET`,
          );
        }
        if (link) this.grow(link, x, this.y, piece.width, piece.size);
        x += piece.width;
      }
      if (link) {
        // Underlined, because colour alone is exactly the cue 1.4.1 refuses.
        const size = Math.max(...group.map((p) => p.size));
        this.page.ops.push(`${fmt(start)} ${fmt(this.y - size * 0.12)} ${fmt(x - start)} 0.6 re f`);
      }
      this.endMark();
      index = end;
    }
  }

  private grow(link: OpenLink, x: number, baseline: number, width: number, size: number): void {
    const page = this.pageNumber;
    const box = link.boxes.get(page);
    const top = baseline + size * 0.85;
    const bottom = baseline - size * 0.25;
    if (!box) {
      link.boxes.set(page, { left: x, right: x + width, top, bottom });
      return;
    }
    box.left = Math.min(box.left, x);
    box.right = Math.max(box.right, x + width);
    box.top = Math.max(box.top, top);
    box.bottom = Math.min(box.bottom, bottom);
  }

  /**
   * Lines under one element, opening pages as they run out.
   *
   * The element exists before the lines are placed and the lines may cross a
   * page, which is the case that makes `/Pg` and the parent tree earn their
   * keep: one paragraph, marked content on two pages, one element owning both.
   */
  private paintLines(lines: readonly Line[], element: StructElement, links: readonly OpenLink[], left: number): void {
    for (const line of lines) {
      if (!this.fits(line.height)) this.openPage();
      this.y -= line.height;
      this.paintLine(line, left, element, links);
    }
    this.closeLinks(links);
  }

  /** Every link's annotations, once its text has been placed and measured. */
  private closeLinks(links: readonly OpenLink[]): void {
    for (const link of links) {
      const element = link.element;
      if (!element) continue; // a link whose text never reached a page is not a link
      for (const [page, box] of link.boxes) {
        const annotNum = this.alloc();
        this.objects.set(
          annotNum,
          new Map<string, PdfValue>([
            ['Type', new PdfName('Annot')],
            ['Subtype', new PdfName('Link')],
            ['Rect', [round(box.left - 1), round(box.bottom - 1), round(box.right + 1), round(box.top + 1)]],
            ['Border', [0, 0, 0]],
            // 2.4.4 lives here: a reader announces `/Contents`, and the
            // detector reads it back. The link's own words are what it says.
            ['Contents', pdfString(link.text)],
            [
              'A',
              new Map<string, PdfValue>([
                ['Type', new PdfName('Action')],
                ['S', new PdfName('URI')],
                ['URI', pdfString(link.href)],
              ]),
            ],
            ['StructParent', this.parentRows.length],
          ]),
        );
        this.parentRows.push(element);
        this.pages[page - 1]?.annots.push(annotNum);
        element.kids.push({ objr: annotNum, page });
      }
    }
  }

  /** Links for one block, waiting to become elements when their text is placed. */
  private linksFor(specs: readonly LinkSpec[], owner: StructElement): OpenLink[] {
    return specs.map((spec) => ({ owner, href: spec.href, text: spec.text, boxes: new Map() }));
  }

  /* ── Blocks ─────────────────────────────────────────────────────── */

  private heading(block: Extract<Block, { kind: 'heading' }>): void {
    const level = Math.min(6, Math.max(1, Math.round(block.level)));
    this.gap(HEADING_BEFORE[level]!);
    const element = this.element(`H${level}`, this.root, block.lang ? { lang: block.lang } : {});
    const { tokens, links } = tokenise(block.spans, HEADING_SIZE[level]!);
    const lines = wrap(tokens, CONTENT_WIDTH);

    // A heading alone at the foot of a page is a heading for nothing: the
    // section it names starts overleaf, and a reader paging through sees a
    // title with no text under it. So the heading claims room for itself and
    // for a line of what follows, or it goes over with it.
    const needed = lines.reduce((h, line) => h + line.height, 0) + HEADING_AFTER[level]! + BODY_SIZE * LINE_HEIGHT;
    if (!this.fits(needed)) this.openPage();

    this.paintLines(lines, element, this.linksFor(links, element), MARGIN);
    this.gap(HEADING_AFTER[level]!);
  }

  private paragraph(block: Extract<Block, { kind: 'paragraph' }>): void {
    const element = this.element('P', this.root, block.lang ? { lang: block.lang } : {});
    const { tokens, links } = tokenise(block.spans, BODY_SIZE);
    this.paintLines(wrap(tokens, CONTENT_WIDTH), element, this.linksFor(links, element), MARGIN);
    this.gap(PARAGRAPH_GAP);
  }

  /**
   * A list item, as `LI` → (`Lbl`, `LBody`) inside an `L`.
   *
   * The marker sits on the first line's baseline, so that line is reserved
   * before the label is painted and the body text goes down beside it. Nesting
   * is by indent rather than by tree: a run of items at one level is one list,
   * which is what Word's own numbering restarts on, and what a reader
   * announces correctly without inventing structure the .docx never had.
   */
  private listItem(block: Extract<Block, { kind: 'listItem' }>, list: StructElement): void {
    const level = Math.max(0, Math.min(6, Math.round(block.level)));
    const left = MARGIN + level * INDENT;
    const item = this.element('LI', list);
    const label = this.element('Lbl', item);
    const body = this.element('LBody', item, block.lang ? { lang: block.lang } : {});
    const { tokens, links } = tokenise(block.spans, BODY_SIZE);
    const open = this.linksFor(links, body);

    const marker = foldToWinAnsi(block.marker);
    const markerWidth = Math.max(widthOf(marker, 'Helvetica', BODY_SIZE) + 6, 14);
    const lines = wrap(tokens, CONTENT_WIDTH - (left - MARGIN) - markerWidth);
    const first = lines[0]!;

    if (!this.fits(first.height)) this.openPage();
    this.y -= first.height;
    this.mark(label);
    this.page.ops.push(`BT /F1 ${fmt(BODY_SIZE)} Tf ${fmt(left)} ${fmt(this.y)} Td ${literal(marker)} Tj ET`);
    this.endMark();
    this.paintLine(first, left + markerWidth, body, open);

    for (const line of lines.slice(1)) {
      if (!this.fits(line.height)) this.openPage();
      this.y -= line.height;
      this.paintLine(line, left + markerWidth, body, open);
    }
    this.closeLinks(open);
    this.gap(2);
  }

  /**
   * A figure, scaled to the page, with its description on the element.
   *
   * A decorative picture is an `/Artifact`: no element claims it, so no reader
   * announces it, which is the same answer the .docx path gives with
   * `adec:decorative`. A picture with neither a description nor that mark is
   * still tagged `Figure` — the detector then reports it, which is the finding
   * the customer already has on their Word file, carried faithfully rather
   * than papered over by the export.
   */
  private figure(block: Extract<Block, { kind: 'figure' }>): void {
    const { image } = block;
    // Word stores a drawing's size in EMU and the caller converts; without one,
    // assume the picture was authored at 96dpi, which is what Word assumes.
    const naturalWidth = sizeOr(block.widthPt ?? (image.width * 72) / 96, CONTENT_WIDTH);
    const naturalHeight = sizeOr(block.heightPt ?? (image.height * 72) / 96, CONTENT_WIDTH);
    let width = Math.min(naturalWidth, CONTENT_WIDTH);
    let height = (naturalHeight * width) / naturalWidth;
    const maxHeight = TOP - BOTTOM - 24;
    if (height > maxHeight) {
      width = (width * maxHeight) / height;
      height = maxHeight;
    }

    if (!this.fits(height + 6)) this.openPage();
    this.y -= height + 6;

    const objectNum = this.imageFor(image);
    const alias = `Im${objectNum}`;
    this.page.images.set(alias, objectNum);

    const decorative = block.decorative === true;
    if (decorative) this.page.ops.push('/Artifact <</Type /Layout>> BDC');
    else this.mark(this.element('Figure', this.root, block.alt ? { alt: block.alt } : {}));
    this.page.ops.push(`q ${fmt(width)} 0 0 ${fmt(height)} ${fmt(MARGIN)} ${fmt(this.y)} cm /${alias} Do Q`);
    this.endMark();
    this.gap(PARAGRAPH_GAP);
  }

  private imageFor(image: EmbeddedImage): number {
    const existing = this.imageObjects.get(image);
    if (existing !== undefined) return existing;
    const objectNum = this.alloc();
    const dict: PdfDict = new Map<string, PdfValue>([
      ['Type', new PdfName('XObject')],
      ['Subtype', new PdfName('Image')],
      ['Width', image.width],
      ['Height', image.height],
      ['ColorSpace', new PdfName(image.colourSpace)],
      ['BitsPerComponent', 8],
    ]);
    if (image.filter) dict.set('Filter', new PdfName(image.filter));
    if (image.smask) {
      const maskNum = this.alloc();
      const maskDict: PdfDict = new Map<string, PdfValue>([
        ['Type', new PdfName('XObject')],
        ['Subtype', new PdfName('Image')],
        ['Width', image.width],
        ['Height', image.height],
        ['ColorSpace', new PdfName('DeviceGray')],
        ['BitsPerComponent', 8],
      ]);
      if (image.smask.filter) maskDict.set('Filter', new PdfName(image.smask.filter));
      this.objects.set(maskNum, new PdfStream(maskDict, image.smask.data));
      dict.set('SMask', new PdfRef(maskNum, 0));
    }
    this.objects.set(objectNum, new PdfStream(dict, image.data));
    this.imageObjects.set(image, objectNum);
    return objectNum;
  }

  /**
   * A table, row by row, sliced wherever the page runs out.
   *
   * Cells are measured before anything is painted so a row knows its own
   * height, and a row taller than the space left is *cut* rather than allowed
   * to overflow: each cell keeps its remaining lines and carries on below. A
   * `TD` whose text lands on two pages is one element with marked content on
   * both, which is the case the parent tree exists for.
   */
  private table(block: Extract<Block, { kind: 'table' }>): void {
    const columns = Math.max(1, ...block.rows.map((r) => r.cells.reduce((n, c) => n + Math.max(1, c.colSpan ?? 1), 0)));
    const widths = normaliseWidths(block.widths, columns).map((w) => w * CONTENT_WIDTH);
    const table = this.element('Table', this.root);
    this.gap(2);

    for (const row of block.rows) {
      const tr = this.element('TR', table);
      let column = 0;
      const cells = row.cells.map((cell) => {
        const span = Math.max(1, Math.min(cell.colSpan ?? 1, columns - column));
        const at = column;
        column += span;
        const element = this.element(cell.header ? 'TH' : 'TD', tr, span > 1 ? { colSpan: span } : {});
        let width = 0;
        for (let i = at; i < at + span; i += 1) width += widths[i] ?? CONTENT_WIDTH / columns;
        const links: OpenLink[] = [];
        const lines: Line[] = [];
        cell.paragraphs.forEach((paragraph, index) => {
          const spans = cell.header ? paragraph.map((sp) => ({ ...sp, bold: true })) : paragraph;
          const parsed = tokenise(spans, BODY_SIZE);
          // Each paragraph numbers its own links from zero, and the cell keeps
          // one list of them, so the second paragraph's indices are shifted
          // past the first's. Without this a link in a cell's second paragraph
          // paints the first paragraph's address.
          const offset = links.length;
          links.push(...this.linksFor(parsed.links, element));
          const wrapped = wrap(parsed.tokens, Math.max(width - 2 * CELL_PAD, BODY_SIZE)).map((line) => ({
            ...line,
            pieces: line.pieces.map((piece) =>
              piece.link === undefined ? piece : { ...piece, link: piece.link + offset },
            ),
          }));
          // A second paragraph in a cell has to look like one.
          if (index > 0 && wrapped[0]) wrapped[0] = { ...wrapped[0], height: wrapped[0].height + 4 };
          lines.push(...wrapped);
        });
        return { cell, element, lines, links, width };
      });

      const cursors = cells.map(() => 0);
      let slices = 0;
      for (;;) {
        slices += 1;
        if (slices > 512) break; // a row needing five hundred slices is a broken document
        if (!cells.some((entry, i) => cursors[i]! < entry.lines.length)) break;

        const room = this.y - BOTTOM - 2 * CELL_PAD;
        const slice = cells.map((entry, i) => {
          let height = 0;
          let count = 0;
          for (let l = cursors[i]!; l < entry.lines.length; l += 1) {
            const next = height + entry.lines[l]!.height;
            if (next > room && count > 0) break;
            height = next;
            count += 1;
          }
          return { count, height };
        });
        const height = Math.max(...slice.map((s) => s.height), BODY_SIZE * LINE_HEIGHT);
        if (height + 2 * CELL_PAD > this.y - BOTTOM) {
          this.openPage();
          continue;
        }

        const top = this.y;
        const bottom = top - height - 2 * CELL_PAD;
        // The ground first, then the rules, then the text on top of both.
        let x = MARGIN;
        for (const entry of cells) {
          if (entry.cell.header) {
            this.page.ops.push(
              `q ${HEADER_GREY} g ${fmt(x)} ${fmt(bottom)} ${fmt(entry.width)} ${fmt(top - bottom)} re f Q`,
            );
          }
          this.page.ops.push(
            `q 0.4 G ${RULE} w ${fmt(x)} ${fmt(bottom)} ${fmt(entry.width)} ${fmt(top - bottom)} re S Q`,
          );
          x += entry.width;
        }

        x = MARGIN;
        cells.forEach((entry, i) => {
          this.y = top - CELL_PAD;
          const until = cursors[i]! + slice[i]!.count;
          for (let l = cursors[i]!; l < until; l += 1) {
            const line = entry.lines[l]!;
            this.y -= line.height;
            this.paintLine(line, x + CELL_PAD, entry.element, entry.links);
          }
          cursors[i] = until;
          x += entry.width;
        });
        this.y = bottom;
      }
      for (const entry of cells) this.closeLinks(entry.links);
    }
    this.gap(PARAGRAPH_GAP);
  }

  /* ── Assembly ───────────────────────────────────────────────────── */

  run(): BuildResult {
    let list: StructElement | undefined;
    let listLevel = -1;
    for (const block of this.model.blocks) {
      if (block.kind === 'listItem') {
        if (!list || Math.round(block.level) !== listLevel) {
          list = this.element('L', this.root);
          listLevel = Math.round(block.level);
        }
        this.listItem(block, list);
        continue;
      }
      list = undefined;
      listLevel = -1;
      if (block.kind === 'heading') this.heading(block);
      else if (block.kind === 'paragraph') this.paragraph(block);
      else if (block.kind === 'figure') this.figure(block);
      else this.table(block);
    }

    this.footers();
    return { ok: true, bytes: this.serialiseFile(), pages: this.pages.length };
  }

  /**
   * "Page 2 of 7", once the count is known.
   *
   * It is an `/Artifact`, which is the tagged-PDF word for ink that belongs to
   * the page rather than to the document: a reader skips it instead of reading
   * a page number into the middle of a sentence. It is also why every page of
   * this file paints some text, which keeps the detector's "this page is a
   * picture" check honestly quiet on a page that holds only a figure.
   */
  private footers(): void {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const label = `Page ${index + 1} of ${total}`;
      const text = foldToWinAnsi(this.model.producer ? `${label} · ${this.model.producer}` : label);
      const width = widthOf(text, 'Helvetica', FOOTER_SIZE);
      page.ops.push('/Artifact <</Type /Pagination /Subtype /Footer>> BDC');
      page.ops.push(
        `BT 0.35 g /F1 ${fmt(FOOTER_SIZE)} Tf ${fmt(PAGE_WIDTH - MARGIN - width)} ${fmt(FOOTER_BASELINE)} Td ${literal(
          text,
        )} Tj ET`,
      );
      page.ops.push('EMC');
    });
  }

  /** Every structure element as an object, depth first — the tree a reader walks. */
  private structObjects(): void {
    const write = (el: StructElement) => {
      const dict: PdfDict = new Map<string, PdfValue>([
        ['Type', new PdfName('StructElem')],
        ['S', new PdfName(el.tag)],
        ['P', new PdfRef(el.parent ? el.parent.num : this.structRootNum, 0)],
      ]);
      if (el.page) dict.set('Pg', new PdfRef(this.pages[el.page - 1]!.num, 0));
      if (el.alt) dict.set('Alt', pdfString(el.alt));
      if (el.lang) dict.set('Lang', pdfString(el.lang));
      if (el.colSpan && el.colSpan > 1) {
        dict.set(
          'A',
          new Map<string, PdfValue>([
            ['O', new PdfName('Table')],
            ['ColSpan', el.colSpan],
          ]),
        );
      }

      const kids: PdfValue[] = [];
      for (const kid of el.kids) {
        if (isElement(kid)) {
          kids.push(new PdfRef(kid.num, 0));
          write(kid);
        } else if ('objr' in kid) {
          kids.push(
            new Map<string, PdfValue>([
              ['Type', new PdfName('OBJR')],
              ['Obj', new PdfRef(kid.objr, 0)],
              ['Pg', new PdfRef(this.pages[kid.page - 1]!.num, 0)],
            ]),
          );
        } else {
          kids.push(
            new Map<string, PdfValue>([
              ['Type', new PdfName('MCR')],
              ['Pg', new PdfRef(this.pages[kid.page - 1]!.num, 0)],
              ['MCID', kid.mcid],
            ]),
          );
        }
      }
      if (kids.length === 1) dict.set('K', kids[0]!);
      else if (kids.length > 1) dict.set('K', kids);
      this.objects.set(el.num, dict);
    };
    write(this.root);
  }

  private serialiseFile(): Uint8Array {
    const catalogNum = this.alloc();
    const pagesNum = this.alloc();
    const parentTreeNum = this.alloc();
    const infoNum = this.alloc();
    this.structRootNum = this.alloc();

    const fonts = new Map<string, PdfValue>();
    for (const [face, key] of Object.entries(FONT_KEY) as Array<[Face, string]>) {
      const fontNum = this.alloc();
      this.objects.set(
        fontNum,
        new Map<string, PdfValue>([
          ['Type', new PdfName('Font')],
          ['Subtype', new PdfName('Type1')],
          ['BaseFont', new PdfName(face)],
          ['Encoding', new PdfName('WinAnsiEncoding')],
        ]),
      );
      fonts.set(key, new PdfRef(fontNum, 0));
    }

    this.structObjects();

    for (const page of this.pages) {
      const contentNum = this.alloc();
      this.objects.set(contentNum, new PdfStream(new Map(), latin1Bytes(page.ops.join('\n'))));

      const resources: PdfDict = new Map<string, PdfValue>([['Font', fonts]]);
      if (page.images.size) {
        const xobjects = new Map<string, PdfValue>();
        for (const [alias, objectNum] of page.images) xobjects.set(alias, new PdfRef(objectNum, 0));
        resources.set('XObject', xobjects);
      }

      const dict: PdfDict = new Map<string, PdfValue>([
        ['Type', new PdfName('Page')],
        ['Parent', new PdfRef(pagesNum, 0)],
        ['MediaBox', [0, 0, PAGE_WIDTH, PAGE_HEIGHT]],
        ['Resources', resources],
        ['Contents', new PdfRef(contentNum, 0)],
        ['StructParents', page.parents],
      ]);
      if (page.annots.length) dict.set('Annots', page.annots.map((n) => new PdfRef(n, 0)));
      this.objects.set(page.num, dict);
    }

    const nums: PdfValue[] = [];
    this.parentRows.forEach((row, index) => {
      nums.push(index);
      nums.push(Array.isArray(row) ? row.map((el) => new PdfRef(el.num, 0)) : new PdfRef(row.num, 0));
    });
    this.objects.set(parentTreeNum, new Map<string, PdfValue>([['Nums', nums]]));

    this.objects.set(
      this.structRootNum,
      new Map<string, PdfValue>([
        ['Type', new PdfName('StructTreeRoot')],
        ['K', new PdfRef(this.root.num, 0)],
        ['ParentTree', new PdfRef(parentTreeNum, 0)],
        ['ParentTreeNextKey', this.parentRows.length],
      ]),
    );

    this.objects.set(
      pagesNum,
      new Map<string, PdfValue>([
        ['Type', new PdfName('Pages')],
        ['Kids', this.pages.map((p) => new PdfRef(p.num, 0))],
        ['Count', this.pages.length],
      ]),
    );

    this.objects.set(
      catalogNum,
      new Map<string, PdfValue>([
        ['Type', new PdfName('Catalog')],
        ['Pages', new PdfRef(pagesNum, 0)],
        ['Lang', pdfString(this.model.language)],
        ['MarkInfo', new Map<string, PdfValue>([['Marked', true]])],
        ['StructTreeRoot', new PdfRef(this.structRootNum, 0)],
        // 2.4.2 is not met by having a title; a reader has to be told to show it.
        ['ViewerPreferences', new Map<string, PdfValue>([['DisplayDocTitle', true]])],
      ]),
    );

    this.objects.set(
      infoNum,
      new Map<string, PdfValue>([
        ['Title', pdfString(this.model.title)],
        ['Producer', pdfString(this.model.producer ?? '508This')],
        ['CreationDate', pdfString(pdfDate(this.model.now))],
        ['ModDate', pdfString(pdfDate(this.model.now))],
      ]),
    );

    return assemble(this.objects, this.next, catalogNum, infoNum);
  }
}

/** A usable measurement, or the fallback. Zero and NaN both reach `fmt` otherwise. */
function sizeOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Relative column widths, normalised to sum to one, with a sane default. */
function normaliseWidths(widths: readonly number[] | undefined, columns: number): number[] {
  if (!widths || widths.length === 0) return new Array<number>(columns).fill(1 / columns);
  const taken = widths.slice(0, columns).map((w) => (Number.isFinite(w) && w > 0 ? w : 1));
  while (taken.length < columns) taken.push(1);
  const total = taken.reduce((a, b) => a + b, 0);
  return taken.map((w) => w / total);
}

/* ── Bytes ───────────────────────────────────────────────────────────── */

/**
 * A PDF number: two decimals at most, and never in exponent notation.
 *
 * The guard is not decoration. One `NaN` reaches the content stream as the
 * letters "NaN", and a reader meets an operator it cannot parse — a corrupt
 * file, which is the one outcome a remediation service can never hand over.
 * Anything that is not a number is a bug upstream, and falling back to zero
 * leaves a visible misplacement rather than an unopenable document.
 */
function fmt(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 100) / 100);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A PDF string literal, as latin-1 text for splicing into a content stream. */
function literal(text: string): string {
  return latin1Of(serialize(encodeWinAnsi(text).bytes));
}

function latin1Of(data: Uint8Array): string {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return s;
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** `D:20260928143000Z`, which is the only date form a PDF has. */
function pdfDate(iso: string): string {
  const at = new Date(iso);
  const when = Number.isNaN(at.getTime()) ? new Date(0) : at;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `D:${when.getUTCFullYear()}${pad(when.getUTCMonth() + 1)}${pad(when.getUTCDate())}${pad(
    when.getUTCHours(),
  )}${pad(when.getUTCMinutes())}${pad(when.getUTCSeconds())}Z`;
}

/**
 * Objects, then a classic cross reference table.
 *
 * A table rather than a cross reference stream, for one reason: a table needs
 * no compression, so this whole file stays free of `node:zlib` and the tests
 * can read back what it writes with nothing installed. Every reader since 1993
 * understands one.
 */
function assemble(objects: ReadonlyMap<number, PdfValue>, size: number, root: number, info: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let at = 0;
  const push = (data: Uint8Array) => {
    parts.push(data);
    at += data.length;
  };

  push(latin1Bytes('%PDF-1.7\n'));
  // A comment of high bytes, which is how a file tells anything that might
  // transfer it as text that it must not.
  push(Uint8Array.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const offsets = new Map<number, number>();
  for (const num of [...objects.keys()].sort((a, b) => a - b)) {
    offsets.set(num, at);
    push(latin1Bytes(`${num} 0 obj\n`));
    push(serialize(objects.get(num)!));
    push(latin1Bytes('\nendobj\n'));
  }

  const startxref = at;
  const id = digest(parts);
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let num = 1; num < size; num += 1) {
    const offset = offsets.get(num);
    table += offset === undefined ? '0000000000 65535 f \n' : `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  table += `trailer\n<< /Size ${size} /Root ${root} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${startxref}\n%%EOF\n`;
  push(latin1Bytes(table));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/**
 * The file identifier, derived from the bytes rather than from a clock.
 *
 * A PDF is supposed to carry one and every generator reaches for a random
 * number. That would make two builds of the same document differ, which this
 * project deliberately does not allow: the delivered file is a pure function of
 * the original and the record, and a random byte in it makes that unprovable.
 */
function digest(parts: readonly Uint8Array[]): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const part of parts) {
    for (const byte of part) {
      a = ((a ^ byte) * 0x01000193) >>> 0;
      b = ((b + byte) * 0x85ebca6b) >>> 0;
    }
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0').toUpperCase();
  return `${hex(a)}${hex(b)}${hex(a ^ b)}${hex((a + b) >>> 0)}`;
}
