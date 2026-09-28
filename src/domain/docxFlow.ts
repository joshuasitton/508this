/**
 * A Word document, read as a flow of blocks the PDF writer can set.
 *
 * `docx.ts` reads a .docx to *judge* it; this reads the same XML to *re-set*
 * it. They are different questions and the answers live apart, but the two
 * must agree about the document's structure or the service would report one
 * document and deliver another — so what counts as a heading is imported from
 * the detector rather than decided again here.
 *
 * ## Four things Word leaves for the reader to work out
 *
 * **What a list marker says.** A .docx does not store "1." or "•". It stores a
 * numbering reference, and Word draws the marker from `numbering.xml` — the
 * format, the starting number, the pattern — counting as it goes. An export
 * that writes its own text has to do that counting itself, which is `markers`
 * below. Getting it wrong is visible on the first page of most real documents.
 *
 * **Where a picture sits.** A drawing is inside a run, in the middle of a
 * paragraph's text, so the text before it and the text after it are two
 * paragraphs in the flow with a figure between them. Emitting the figures first
 * and the text afterwards, which is easier, reorders the document.
 *
 * **Text in a floating box is text.** Word hides it inside the drawing that
 * floats it, and `docx.ts` reports that as a reading-order finding precisely
 * because it is read out of order or not at all. The export puts it in the
 * flow where the box sits, which is the one place it is certainly readable —
 * so the exported PDF does not inherit the original's 1.3.2 problem.
 *
 * **Every text box is stored twice.** `mc:Fallback` holds a copy for readers
 * too old to understand the modern form, and anything that walks the XML
 * naïvely sets all that text twice. The detector already had this trap and this
 * takes the same precaution.
 */

import { headingLevelOf, readStyles, type DocxParts, type StyleInfo } from './docx';
import { targetOfIn } from './docxImages';
import { primarySubtag } from './language';
import type { Block, Cell, Span } from './pdfBuild';
import { attr, child, children, elements, find, findAll, parseXml, textOf, type XmlElement } from './xml';

/** A figure in the flow, before the server has found its bytes. */
export interface FlowFigure {
  kind: 'figure';
  /** The archive path of the picture, absent when the drawing has none (a shape). */
  part?: string;
  alt?: string;
  decorative?: boolean;
  /** The size Word stored, in points, from the drawing's EMU extent. */
  widthPt?: number;
  heightPt?: number;
  /** For the message when the picture cannot be embedded. */
  name?: string;
}

/**
 * Every block the writer takes, with the figure swapped for one that names a
 * part instead of carrying bytes. Reusing the writer's own types rather than
 * restating them is deliberate: a cell described twice is two descriptions to
 * keep in step, and the only real difference between what this reads and what
 * the writer sets is where a picture's bytes come from.
 */
export type FlowBlock = Exclude<Block, { kind: 'figure' }> | FlowFigure;

export interface Flow {
  title: string;
  /** A BCP 47 tag: the document's declared default, or `en` when it has none. */
  language: string;
  blocks: FlowBlock[];
}

const EMU_PER_POINT = 12700;

export function flowOfDocx(parts: DocxParts, options: { fallbackTitle: string }): Flow {
  const doc = parseXml(parts.document);
  const body = find(doc, 'body') ?? doc;
  const styles = readStyles(parts.styles, parts.settings);
  const reader = new Reader(parts, styles, body);

  const titleEl = parts.core ? find(parseXml(parts.core), 'title') : undefined;
  const title = titleEl ? textOf(titleEl).trim() : '';

  // The body first, because reading it is what discovers which notes it uses.
  const blocks = reader.blocksOf(body);
  return {
    title: title || options.fallbackTitle,
    language: styles.hasLanguage ? styles.languageTag : 'en',
    blocks: [...blocks, ...reader.notesSection()],
  };
}

class Reader {
  private readonly parts: DocxParts;
  private readonly styles: StyleInfo;
  /** Everything under an `mc:Fallback`, which is a second copy of real content. */
  private readonly invisible = new Set<XmlElement>();
  private readonly counters = new Map<string, number>();
  private readonly numbering: Numbering;
  /** Note id to its paragraphs, from `footnotes.xml` and `endnotes.xml`. */
  private readonly notes = new Map<string, XmlElement[]>();
  /** The ids the body referred to, in the order it referred to them. */
  private readonly referenced: string[] = [];

  /**
   * `body` is the tree the caller will walk, not a fresh parse of the same
   * bytes. The fallback copies are recognised by element identity, and a second
   * parse produces a second set of objects that match none of them — which is
   * exactly the bug that put every text box in the document twice.
   */
  constructor(parts: DocxParts, styles: StyleInfo, body: XmlElement) {
    this.parts = parts;
    this.styles = styles;
    this.numbering = readNumbering(parts.numbering);
    for (const root of findAll(body, 'Fallback')) for (const el of descendants(root)) this.invisible.add(el);
    for (const [part, local] of [
      [parts.footnotes, 'footnote'],
      [parts.endnotes, 'endnote'],
    ] as const) {
      if (!part) continue;
      for (const note of findAll(parseXml(part), local)) {
        // Word keeps the separator rules in this part too, as notes with a
        // `w:type`. They are furniture, and setting them would put a line of
        // nothing at the end of the document.
        if (attr(note, 'type')) continue;
        const id = attr(note, 'id');
        if (id !== undefined) this.notes.set(`${local}:${id}`, children(note, 'p'));
      }
    }
  }

  blocksOf(container: XmlElement): FlowBlock[] {
    const out: FlowBlock[] = [];
    for (const el of elements(container)) {
      if (this.invisible.has(el)) continue;
      if (el.local === 'p') out.push(...this.paragraph(el));
      else if (el.local === 'tbl') out.push(this.table(el));
    }
    return out;
  }

  /**
   * One Word paragraph, which can be several blocks: the text around each
   * picture it contains, the pictures themselves, and anything in a floating
   * box that hangs off it.
   */
  private paragraph(p: XmlElement): FlowBlock[] {
    const out: FlowBlock[] = [];
    const lang = this.langOf(p);
    const level = headingLevelOf(p, this.styles);
    const marker = this.markerOf(p);

    let spans: Span[] = [];
    const flush = () => {
      const merged = mergeSpans(spans);
      spans = [];
      if (merged.length === 0) return;
      if (level !== undefined) out.push({ kind: 'heading', level, spans: merged, ...(lang ? { lang } : {}) });
      else if (marker !== null)
        out.push({ kind: 'listItem', level: marker.level, marker: marker.text, spans: merged, ...(lang ? { lang } : {}) });
      else out.push({ kind: 'paragraph', spans: merged, ...(lang ? { lang } : {}) });
    };

    for (const node of this.runsOf(p)) {
      if (node.kind === 'spans') {
        spans.push(...node.spans);
        continue;
      }
      // A picture, or a floating box, ends the run of text before it.
      flush();
      out.push(...node.blocks);
    }
    flush();
    return out;
  }

  /**
   * A paragraph's contents in document order: spans of text, and the drawings
   * between them. Hyperlinks are descended into so their runs carry the href;
   * everything else is walked for its `w:t`, `w:tab` and `w:br`.
   */
  private runsOf(p: XmlElement): Array<{ kind: 'spans'; spans: Span[] } | { kind: 'blocks'; blocks: FlowBlock[] }> {
    const out: Array<{ kind: 'spans'; spans: Span[] } | { kind: 'blocks'; blocks: FlowBlock[] }> = [];

    const walk = (el: XmlElement, href: string | undefined, bold: boolean, italic: boolean): void => {
      for (const node of elements(el)) {
        if (this.invisible.has(node)) continue;
        switch (node.local) {
          case 'drawing':
          case 'pict':
          case 'object': {
            const blocks = this.drawing(node);
            if (blocks.length) out.push({ kind: 'blocks', blocks });
            break;
          }
          case 'hyperlink': {
            walk(node, this.hrefOf(node) ?? href, bold, italic);
            break;
          }
          case 'r': {
            const rPr = child(node, 'rPr');
            walk(node, href, bold || isOn(rPr && child(rPr, 'b')), italic || isOn(rPr && child(rPr, 'i')));
            break;
          }
          case 't': {
            const text = textOf(node);
            if (text !== '') out.push({ kind: 'spans', spans: [span(text, bold, italic, href)] });
            break;
          }
          case 'tab':
            out.push({ kind: 'spans', spans: [span('\t', bold, italic, href)] });
            break;
          case 'br':
          case 'cr':
            // A line break inside a paragraph is a space: the export breaks
            // its own lines, and honouring a break Word put at a different
            // measure would leave a gap in the middle of a sentence.
            out.push({ kind: 'spans', spans: [span(' ', bold, italic, href)] });
            break;
          case 'footnoteReference':
          case 'endnoteReference': {
            const marker = this.noteMarker(node.local === 'footnoteReference' ? 'footnote' : 'endnote', attr(node, 'id'));
            if (marker) out.push({ kind: 'spans', spans: [span(marker, bold, italic, href)] });
            break;
          }
          case 'pPr':
          case 'rPr':
          case 'del':
          case 'instrText':
            break;
          default:
            walk(node, href, bold, italic);
        }
      }
    };

    walk(p, undefined, false, false);
    return out;
  }

  /**
   * A drawing: the figure it displays, the text of any box inside it, or both.
   *
   * A shape with neither — a line, an arrow, a decorative swoosh — produces no
   * block at all. There is nothing to embed and nothing to read, and the
   * document's own findings already say what a reviewer owes it.
   */
  private drawing(drawing: XmlElement): FlowBlock[] {
    const boxes = findAll(drawing, 'txbxContent').filter((box) => !this.invisible.has(box));
    const out: FlowBlock[] = [];

    const docPr = find(drawing, 'docPr');
    const blip = findAll(drawing, 'blip').find((b) => attr(b, 'embed'));
    if (blip) {
      const embed = attr(blip, 'embed')!;
      const target = this.parts.documentRels ? targetOfIn(this.parts.documentRels, embed) : null;
      const extent = find(drawing, 'extent');
      const cx = extent ? Number(attr(extent, 'cx')) : NaN;
      const cy = extent ? Number(attr(extent, 'cy')) : NaN;
      const figure: FlowFigure = { kind: 'figure' };
      if (target) figure.part = target.part;
      const descr = docPr ? (attr(docPr, 'descr') ?? '').trim() : '';
      if (descr) figure.alt = descr;
      if (docPr && isOn(find(docPr, 'decorative'))) figure.decorative = true;
      if (Number.isFinite(cx) && cx > 0) figure.widthPt = cx / EMU_PER_POINT;
      if (Number.isFinite(cy) && cy > 0) figure.heightPt = cy / EMU_PER_POINT;
      const name = docPr ? attr(docPr, 'name') : undefined;
      if (name) figure.name = name;
      out.push(figure);
    }

    for (const box of boxes) out.push(...this.blocksOf(box));
    return out;
  }

  private hrefOf(link: XmlElement): string | undefined {
    const id = attr(link, 'id');
    if (!id || !this.parts.documentRels) return undefined;
    const root = parseXml(this.parts.documentRels);
    for (const rel of findAll(root, 'Relationship')) {
      if (attr(rel, 'Id') !== id) continue;
      const target = attr(rel, 'Target');
      // Only an address a reader can follow becomes a link. An internal
      // bookmark has no URL, and a link to nowhere announced as a link is
      // exactly the 2.4.4 problem this product reports.
      if (target && /^(https?:|mailto:|tel:|ftp:)/i.test(target)) return target;
      return undefined;
    }
    return undefined;
  }

  /** A table, with its column widths as Word's grid states them. */
  private table(tbl: XmlElement): Extract<FlowBlock, { kind: 'table' }> {
    const grid = child(tbl, 'tblGrid');
    const widths = grid
      ? children(grid, 'gridCol')
          .map((col) => Number(attr(col, 'w')))
          .filter((w) => Number.isFinite(w) && w > 0)
      : [];

    const rows = children(tbl, 'tr')
      .filter((tr) => !this.invisible.has(tr))
      .map((tr) => {
        const trPr = child(tr, 'trPr');
        const header = trPr !== undefined && child(trPr, 'tblHeader') !== undefined;
        const cells: Cell[] = children(tr, 'tc').map((tc) => {
          const tcPr = child(tc, 'tcPr');
          const span = tcPr ? Number(attr(child(tcPr, 'gridSpan') ?? tcPr, 'val')) : NaN;
          const paragraphs = children(tc, 'p')
            .filter((p) => !this.invisible.has(p))
            .map((p) => mergeSpans(this.spansOf(p)))
            .filter((spans) => spans.length > 0);
          const cell: Cell = { paragraphs };
          if (header) cell.header = true;
          if (Number.isInteger(span) && span > 1) cell.colSpan = span;
          return cell;
        });
        return { cells };
      });

    return widths.length ? { kind: 'table', rows, widths } : { kind: 'table', rows };
  }

  /** A cell's text, flattened: a picture inside a table cell is not carried. */
  private spansOf(p: XmlElement): Span[] {
    const out: Span[] = [];
    for (const node of this.runsOf(p)) if (node.kind === 'spans') out.push(...node.spans);
    return out;
  }

  /**
   * The marker Word would have drawn for a numbered paragraph, and the level it
   * sits at — or null when the paragraph is not in a list.
   *
   * The counter is per list and per level, and a number at one level restarts
   * the levels under it, which is what makes "2.1, 2.2, 3.1" come out right.
   */
  private markerOf(p: XmlElement): { level: number; text: string } | null {
    const pPr = child(p, 'pPr');
    const numPr = pPr ? child(pPr, 'numPr') : undefined;
    if (!numPr) return null;
    const numId = attr(child(numPr, 'numId') ?? numPr, 'val');
    if (numId === undefined || numId === '0') return null;
    const ilvl = Number(attr(child(numPr, 'ilvl') ?? numPr, 'val') ?? 0);
    const level = Number.isFinite(ilvl) ? Math.max(0, Math.min(8, ilvl)) : 0;

    const definition = this.numbering.levelOf(numId, level);
    if (definition?.format === 'none') return { level, text: '' };
    if (!definition || definition.format === 'bullet') return { level, text: '•' };

    const key = `${numId}:${level}`;
    const next = (this.counters.get(key) ?? definition.start - 1) + 1;
    this.counters.set(key, next);
    for (let deeper = level + 1; deeper <= 8; deeper += 1) this.counters.delete(`${numId}:${deeper}`);

    const text = definition.text.replace(/%(\d)/g, (_whole, which: string) => {
      const at = Number(which) - 1;
      const counted = at === level ? next : (this.counters.get(`${numId}:${at}`) ?? 1);
      const format = at === level ? definition.format : (this.numbering.levelOf(numId, at)?.format ?? 'decimal');
      return formatNumber(counted, format);
    });
    return { level, text: text.trim() === '' ? formatNumber(next, definition.format) : text };
  }

  /**
   * The mark that stands in for a note, and a record that the body used it.
   *
   * Word sets a footnote as a superscript number at the foot of its page. The
   * export has neither superscripts nor a concept of "the foot of this page"
   * while it is still deciding where pages end, so a note becomes `[1]` here
   * and its text is set under a heading at the end. That is a relocation, and
   * it is visible; dropping the note, which is what reading only `document.xml`
   * would do, is a silent loss of the customer's words.
   */
  private noteMarker(kind: 'footnote' | 'endnote', id: string | undefined): string | null {
    if (id === undefined) return null;
    const key = `${kind}:${id}`;
    if (!this.notes.has(key)) return null;
    const at = this.referenced.indexOf(key);
    return `[${(at === -1 ? this.referenced.push(key) : at + 1)}]`;
  }

  /** The notes the body referred to, in reference order, under one heading. */
  notesSection(): FlowBlock[] {
    if (this.referenced.length === 0) return [];
    const out: FlowBlock[] = [{ kind: 'heading', level: 2, spans: [{ text: 'Notes' }] }];
    this.referenced.forEach((key, index) => {
      const paragraphs = this.notes.get(key) ?? [];
      paragraphs.forEach((p, at) => {
        const spans = mergeSpans(this.spansOf(p));
        if (spans.length === 0) return;
        out.push({
          kind: 'paragraph',
          spans: at === 0 ? [{ text: `[${index + 1}] ` }, ...spans] : spans,
        });
      });
    });
    return out;
  }

  /**
   * A paragraph in another language, when every run in it says the same thing.
   *
   * 3.1.2 is about a passage in another language being marked as such, and the
   * export can only carry a mark it can see. A paragraph with two languages in
   * it is left to the document's default rather than guessed at.
   */
  private langOf(p: XmlElement): string | undefined {
    const tags = new Set<string>();
    for (const r of findAll(p, 'r')) {
      const rPr = child(r, 'rPr');
      const lang = rPr ? child(rPr, 'lang') : undefined;
      const value = lang ? (attr(lang, 'val') ?? attr(lang, 'eastAsia') ?? attr(lang, 'bidi')) : undefined;
      if (textOf(r).trim() === '') continue;
      tags.add(value ?? '');
    }
    if (tags.size !== 1) return undefined;
    const only = [...tags][0]!;
    if (only === '' || primarySubtag(only) === primarySubtag(this.styles.language)) return undefined;
    return only;
  }
}

/* ── Numbering ───────────────────────────────────────────────────────── */

type Format = 'bullet' | 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman' | 'none';

interface Level {
  format: Format;
  /** The pattern, e.g. `%1.` or `%1.%2`. */
  text: string;
  start: number;
}

interface Numbering {
  levelOf(numId: string, level: number): Level | undefined;
}

const FORMATS: Format[] = ['bullet', 'decimal', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman', 'none'];

/**
 * `numbering.xml`, far enough to know what a marker says.
 *
 * `w:num` maps a list to an abstract definition, and the definition holds one
 * `w:lvl` per level. An override on the `w:num` can restart the numbering; that
 * is read too, because a document with "1. 2. 3." twice is a document where
 * ignoring overrides produces "1. 2. 3. 4. 5. 6.".
 */
function readNumbering(source: string | undefined): Numbering {
  const abstracts = new Map<string, Map<number, Level>>();
  const numToAbstract = new Map<string, string>();
  const overrides = new Map<string, Map<number, Level>>();

  if (source) {
    const root = parseXml(source);
    for (const abstract of findAll(root, 'abstractNum')) {
      const id = attr(abstract, 'abstractNumId');
      if (id === undefined) continue;
      abstracts.set(id, levelsOf(abstract));
    }
    for (const num of findAll(root, 'num')) {
      const id = attr(num, 'numId');
      const abstractId = attr(child(num, 'abstractNumId') ?? num, 'val');
      if (id === undefined || abstractId === undefined) continue;
      numToAbstract.set(id, abstractId);
      const own = new Map<number, Level>();
      for (const override of children(num, 'lvlOverride')) {
        const at = Number(attr(override, 'ilvl'));
        const lvl = child(override, 'lvl');
        const startOverride = child(override, 'startOverride');
        if (lvl) {
          const parsed = levelOf(lvl);
          if (parsed && Number.isFinite(at)) own.set(at, parsed);
        }
        if (startOverride && Number.isFinite(at)) {
          const start = Number(attr(startOverride, 'val'));
          const base = own.get(at) ?? abstracts.get(abstractId)?.get(at);
          if (base && Number.isFinite(start)) own.set(at, { ...base, start });
        }
      }
      if (own.size) overrides.set(id, own);
    }
  }

  return {
    levelOf(numId: string, level: number): Level | undefined {
      const override = overrides.get(numId)?.get(level);
      if (override) return override;
      const abstractId = numToAbstract.get(numId);
      if (abstractId === undefined) return undefined;
      return abstracts.get(abstractId)?.get(level);
    },
  };
}

function levelsOf(abstract: XmlElement): Map<number, Level> {
  const out = new Map<number, Level>();
  for (const lvl of children(abstract, 'lvl')) {
    const at = Number(attr(lvl, 'ilvl'));
    const parsed = levelOf(lvl);
    if (parsed && Number.isFinite(at)) out.set(at, parsed);
  }
  return out;
}

function levelOf(lvl: XmlElement): Level | undefined {
  const format = attr(child(lvl, 'numFmt') ?? lvl, 'val') ?? 'decimal';
  const text = attr(child(lvl, 'lvlText') ?? lvl, 'val') ?? '%1.';
  const start = Number(attr(child(lvl, 'start') ?? lvl, 'val') ?? 1);
  return {
    format: (FORMATS as string[]).includes(format) ? (format as Format) : 'decimal',
    text,
    start: Number.isFinite(start) && start > 0 ? start : 1,
  };
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ROMAN: Array<[number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

export function formatNumber(value: number, format: Format): string {
  switch (format) {
    case 'lowerLetter':
      return letters(value);
    case 'upperLetter':
      return letters(value).toUpperCase();
    case 'lowerRoman':
      return roman(value);
    case 'upperRoman':
      return roman(value).toUpperCase();
    case 'bullet':
      return '•';
    case 'none':
      return '';
    default:
      return String(value);
  }
}

/** a, b … z, aa, ab — Word's spreadsheet-style overflow, not "a1". */
function letters(value: number): string {
  let n = Math.max(1, Math.trunc(value));
  let out = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = `${LETTERS[remainder]}${out}`;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function roman(value: number): string {
  let n = Math.max(1, Math.trunc(value));
  let out = '';
  for (const [amount, numeral] of ROMAN) {
    while (n >= amount) {
      out += numeral;
      n -= amount;
    }
  }
  return out;
}

/* ── Spans ───────────────────────────────────────────────────────────── */

function span(text: string, bold: boolean, italic: boolean, href: string | undefined): Span {
  const out: Span = { text };
  if (bold) out.bold = true;
  if (italic) out.italic = true;
  if (href) out.href = href;
  return out;
}

/**
 * Adjacent spans with the same formatting, joined.
 *
 * Word splits a sentence into runs for reasons that have nothing to do with how
 * it reads — a spell-check boundary, a tracked revision, a field. Joining them
 * matters for links in particular: one hyperlink arriving as four runs would
 * otherwise become four link annotations over four fragments of its text, each
 * announced separately.
 */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && last.bold === span.bold && last.italic === span.italic && last.href === span.href) {
      last.text += span.text;
      continue;
    }
    out.push({ ...span });
  }
  // A paragraph of nothing but whitespace is spacing, not content.
  return out.every((s) => s.text.trim() === '') ? [] : out;
}

function descendants(root: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement) => {
    for (const c of elements(node)) {
      out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

function isOn(el: XmlElement | undefined | false): boolean {
  if (!el) return false;
  const v = attr(el, 'val');
  return v === undefined || v === '1' || v === 'true' || v === 'on';
}
