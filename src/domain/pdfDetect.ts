/**
 * Detection for PDFs: a parsed document in, findings out.
 *
 * The same contract as `docx.ts` – deterministic, reproducible from the file
 * alone, no model in the loop – against a format that keeps its structure
 * somewhere else entirely. A Word document *is* its structure; a PDF is a
 * set of painting instructions with a parallel tree of tags that says what
 * those instructions mean. Everything Section 508 asks about a PDF is in
 * that tree, which is why an untagged PDF fails at the first hurdle and why
 * that finding is worth more than all the others put together.
 *
 * Locations are page numbers, because a PDF does have pages, which makes a
 * reviewer's job easier here than in Word.
 */

import type { Finding, Severity } from './findings';
import { KINDS, type Kind } from './kinds';
import { PdfName, PdfStream, latin1, pdfText, type PdfDict, type PdfDocument, type PdfValue } from './pdf';

const MIN_PARAGRAPHS_FOR_HEADINGS = 6;
const GENERIC_LINK_TEXT = /^(click here|here|click|read more|more|link|this link|this|learn more|download|see more)[.!]?$/i;
const BARE_URL = /^(https?:\/\/|www\.)\S+$/i;

function finding(kind: Kind, location: string, description: string, severity: Severity, anchor?: string): Finding {
  const f: Finding = { kind, criterion: KINDS[kind].criterion, location, description, severity, remediated: false };
  if (anchor) f.anchor = anchor;
  return f;
}

export interface StructElement {
  /** The tag after the role map has been applied: P, H1, Figure, Table… */
  role: string;
  /** The tag as written, which may be a designer's own style name. */
  tag: string;
  dict: PdfDict;
  /** Object number, when the element was reached by reference. */
  num?: number;
  page?: number;
  kids: StructElement[];
}

export interface PdfFacts {
  tagged: boolean;
  language: string;
  title: string;
  displayDocTitle: boolean;
  pages: number;
  /** Pages that paint no text at all. */
  pagesWithoutText: number[];
  /** Pages that paint something other than text. */
  pagesWithGraphics: number[];
  /**
   * How many raster images the file actually contains – image XObjects
   * anywhere in it, plus inline images painted into a page.
   *
   * This is the number that says whether a figure can be *described* by a
   * model. A model needs pixels, and a PDF figure is only sometimes made of
   * them: artwork out of Illustrator or InDesign is vector, drawn with path
   * operators, and there is no image in the file to send. A document with
   * four figures and no raster images has nothing a vision pass could look
   * at without rendering the page first, which is a different product.
   */
  rasterImages: number;
  elements: StructElement[];
}

function name(v: PdfValue): string {
  return v instanceof PdfName ? v.name : '';
}

/** Reads the facts once, so the checks below agree with each other. */
export function readPdfFacts(doc: PdfDocument): PdfFacts {
  const cat = doc.catalog;
  const info = doc.resolve(doc.trailer.get('Info'));
  const marked = doc.at(cat, 'MarkInfo', 'Marked') === true;
  const structRoot = doc.at(cat, 'StructTreeRoot');
  const tagged = marked && structRoot instanceof Map;

  const roleMap = doc.at(cat, 'StructTreeRoot', 'RoleMap');
  const roleOf = (tag: string): string => {
    let out = tag;
    for (let i = 0; i < 8 && roleMap instanceof Map; i++) {
      const mapped = name(doc.resolve(roleMap.get(out)));
      if (!mapped || mapped === out) break;
      out = mapped;
    }
    return out;
  };

  const pageIndex = new Map<PdfDict, number>();
  doc.pages.forEach((p, i) => pageIndex.set(p, i + 1));

  const elements: StructElement[] = [];
  const seen = new Set<PdfDict>();
  const walk = (node: PdfValue, into: StructElement[], depth: number, inheritedPage?: number) => {
    if (depth > 64) return;
    const num = node && typeof node === 'object' && 'num' in node ? (node as { num: number }).num : undefined;
    const value = doc.resolve(node);
    if (Array.isArray(value)) {
      for (const kid of value) walk(kid, into, depth, inheritedPage);
      return;
    }
    if (!(value instanceof Map) || seen.has(value)) return;
    const tag = name(doc.resolve(value.get('S')));
    if (!tag) return;
    seen.add(value);
    const pg = doc.resolve(value.get('Pg'));
    const page = pg instanceof Map ? pageIndex.get(pg) : undefined;
    const el: StructElement = {
      role: roleOf(tag),
      tag,
      dict: value,
      num,
      page: page ?? inheritedPage,
      kids: [],
    };
    into.push(el);
    if (value.has('K')) walk(value.get('K')!, el.kids, depth + 1, el.page);
  };
  if (tagged) walk(doc.at(cat, 'StructTreeRoot', 'K'), elements, 0);

  const pagesWithoutText: number[] = [];
  const pagesWithGraphics: number[] = [];
  let inlineImages = 0;
  doc.pages.forEach((page, i) => {
    const content = contentOf(doc, page);
    if (!/(?:^|[\s\]>)])(Tj|TJ|'|")(?=[\s(\[<]|$)/m.test(content)) pagesWithoutText.push(i + 1);
    if (/(?:^|[\s\]>)])(f\*?|S|s|B\*?|b\*?|Do|sh)(?=[\s(\[<]|$)/m.test(content)) pagesWithGraphics.push(i + 1);
    inlineImages += (content.match(/(?:^|\s)BI(?=\s)/g) ?? []).length;
  });

  return {
    tagged,
    language: pdfText(doc.at(cat, 'Lang')).trim(),
    title: pdfText(doc.at(info, 'Title')).trim(),
    displayDocTitle: doc.at(cat, 'ViewerPreferences', 'DisplayDocTitle') === true,
    pages: doc.pages.length,
    pagesWithoutText,
    pagesWithGraphics,
    rasterImages: countRasterImages(doc) + inlineImages,
    elements,
  };
}

/** A page's content streams, decoded, as text for operator matching. */
/**
 * Image XObjects anywhere in the file. Every object is resolved rather than
 * only the ones a page's resources name, because resources are inheritable
 * and an image can be reached through a form XObject, an annotation
 * appearance or a pattern – and the question being asked is "does this file
 * contain pixels at all", not "which page draws them".
 */
function countRasterImages(doc: PdfDocument): number {
  let n = 0;
  for (let num = 1; num < doc.size; num++) {
    let value: PdfValue;
    try {
      value = doc.get(num);
    } catch {
      continue; // A broken object says nothing about images.
    }
    if (!(value instanceof PdfStream)) continue;
    const subtype = value.dict.get('Subtype');
    if (subtype instanceof PdfName && subtype.name === 'Image') n += 1;
  }
  return n;
}

function contentOf(doc: PdfDocument, page: PdfDict): string {
  const contents = doc.resolve(page.get('Contents'));
  const streams = Array.isArray(contents) ? contents.map((c) => doc.resolve(c)) : [contents];
  let out = '';
  for (const s of streams) {
    if (!(s instanceof PdfStream)) continue;
    try {
      out += latin1(doc.decode(s));
    } catch {
      // An undecodable stream tells us nothing; the other checks still run.
    }
  }
  return out;
}

function flatten(elements: StructElement[]): StructElement[] {
  const out: StructElement[] = [];
  const walk = (list: StructElement[]) => {
    for (const el of list) {
      out.push(el);
      walk(el.kids);
    }
  };
  walk(elements);
  return out;
}

function at(page: number | undefined): string {
  return page ? `page ${page}` : 'the document';
}

export function detectPdf(doc: PdfDocument): Finding[] {
  const out: Finding[] = [];
  const facts = readPdfFacts(doc);
  const all = flatten(facts.elements);

  // 2.4.2 – a title, and a reader told to show it.
  if (!facts.title) {
    out.push(
      finding('no-title', 'document properties', 'The PDF has no title. A reader announces the filename instead.', 'blocking'),
    );
  } else if (!facts.displayDocTitle) {
    out.push(
      finding(
        'pdf-title-not-shown',
        'document properties',
        `The title is “${facts.title}”, but the PDF is not set to display it, so readers show the filename.`,
        'partial',
      ),
    );
  }

  // 3.1.1 – a language.
  if (!facts.language) {
    out.push(
      finding('no-language', 'document catalogue', 'No document language is set, so a screen reader has to guess how to pronounce the text.', 'blocking'),
    );
  }

  // 1.1.1 – a text layer at all.
  if (facts.pagesWithoutText.length > 0 && facts.pagesWithGraphics.length > 0) {
    const pages = facts.pagesWithoutText;
    const where =
      pages.length === facts.pages ? `all ${facts.pages} ${facts.pages === 1 ? 'page' : 'pages'}` : `pages ${pages.join(', ')}`;
    out.push(
      finding(
        'pdf-no-text',
        where,
        `Nothing on ${pages.length === 1 ? 'this page' : 'these pages'} is text. Whatever it says is painted as a picture, so there is nothing for a screen reader to read or for anyone to search.`,
        'blocking',
      ),
    );
  }

  // 1.3.1 – tags, which everything else depends on.
  if (!facts.tagged) {
    out.push(
      finding(
        'pdf-untagged',
        'whole document',
        `The PDF has no tag tree${facts.pages > 1 ? ` across its ${facts.pages} pages` : ''}. Nothing in it has a heading, a paragraph, a reading order, or anywhere to put alternative text.`,
        'blocking',
      ),
    );
    // And say plainly that the artwork cannot be described until it is.
    if (facts.pagesWithGraphics.length > 0 && facts.pagesWithoutText.length === 0) {
      out.push(
        finding(
          'image-alt',
          'whole document',
          'The pages contain artwork, and an untagged PDF has nowhere to record what that artwork shows.',
          'blocking',
        ),
      );
    }
    return out;
  }

  // 1.1.1 – every figure needs a description.
  let figure = 0;
  for (const el of all) {
    if (el.role !== 'Figure' && el.role !== 'Formula') continue;
    figure += 1;
    const alt = pdfText(doc.resolve(el.dict.get('Alt'))).trim();
    const actual = pdfText(doc.resolve(el.dict.get('ActualText'))).trim();
    if (alt || actual) continue;
    out.push(
      finding(
        'image-alt',
        `figure ${figure}, ${at(el.page)}`,
        'The figure has no alternative text, so a screen reader announces nothing where it sits.',
        'partial',
        el.num !== undefined ? `struct:${el.num}` : undefined,
      ),
    );
  }

  // 1.3.1 – headings.
  const headings = all.filter((el) => /^H[1-6]?$/.test(el.role));
  const paragraphs = all.filter((el) => el.role === 'P');
  if (headings.length === 0 && paragraphs.length >= MIN_PARAGRAPHS_FOR_HEADINGS) {
    out.push(
      finding(
        'no-headings',
        'whole document',
        `The PDF is tagged but has ${paragraphs.length} paragraphs and no headings. Anything that looks like a heading is tagged as ordinary text, which assistive technology cannot navigate by.`,
        'partial',
      ),
    );
  }
  let previous = 0;
  for (const h of headings) {
    const level = h.role === 'H' ? previous || 1 : Number(h.role.slice(1));
    if (previous > 0 && level > previous + 1) {
      out.push(
        finding(
          'heading-skip',
          at(h.page),
          `Heading level ${level} follows heading level ${previous}, skipping ${level - previous - 1}. Screen reader users navigate by heading level and will think a section is missing.`,
          'partial',
        ),
      );
    }
    previous = level;
  }

  // 1.3.1 – tables need header cells.
  let table = 0;
  for (const el of all) {
    if (el.role !== 'Table') continue;
    table += 1;
    const cells = flatten(el.kids);
    const hasHeader = cells.some((c) => c.role === 'TH');
    const hasData = cells.some((c) => c.role === 'TD');
    if (hasHeader || !hasData) continue;
    out.push(
      finding(
        'table-header',
        `table ${table}, ${at(el.page)}`,
        'Every cell in the table is tagged as data. With no header cells, a screen reader reads the values without their column names.',
        'partial',
      ),
    );
  }

  // 2.4.4 – links. A link annotation must say where it goes.
  let link = 0;
  doc.pages.forEach((page, index) => {
    const annots = doc.resolve(page.get('Annots'));
    if (!Array.isArray(annots)) return;
    for (const ref of annots) {
      const a = doc.resolve(ref);
      if (!(a instanceof Map) || name(doc.resolve(a.get('Subtype'))) !== 'Link') continue;
      link += 1;
      const contents = pdfText(doc.resolve(a.get('Contents'))).trim();
      if (contents && !GENERIC_LINK_TEXT.test(contents) && !BARE_URL.test(contents)) continue;
      const uri = pdfText(doc.at(a, 'A', 'URI')).trim();
      out.push(
        finding(
          'link-text',
          `link ${link}, page ${index + 1}`,
          contents
            ? `The link's description is “${contents}”, which does not say where it goes.`
            : `The link${uri ? ` to ${uri}` : ''} has no description, so a screen reader announces only that a link is there.`,
          'partial',
        ),
      );
    }
  });

  // 1.2.1 and 3.3.2 – anything interactive takes the document out of the
  // "static" class those criteria are otherwise met on.
  doc.pages.forEach((page, index) => {
    const annots = doc.resolve(page.get('Annots'));
    if (!Array.isArray(annots)) return;
    for (const ref of annots) {
      const a = doc.resolve(ref);
      if (!(a instanceof Map)) continue;
      const subtype = name(doc.resolve(a.get('Subtype')));
      if (subtype === 'Screen' || subtype === 'Movie') {
        out.push(
          finding(
            'media',
            `page ${index + 1}`,
            'The page embeds a recording. A reviewer confirms it has captions and an audio description.',
            'partial',
          ),
        );
      }
    }
  });
  const fields = doc.at(doc.catalog, 'AcroForm', 'Fields');
  if (Array.isArray(fields) && fields.length > 0) {
    out.push(
      finding(
        'forms',
        `${fields.length} ${fields.length === 1 ? 'field' : 'fields'}`,
        'The PDF is a form. A reviewer confirms every field has a label and instructions.',
        'partial',
      ),
    );
  }

  return out;
}
