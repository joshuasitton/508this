/**
 * Detection for Word documents: the parts of a .docx in, findings out.
 *
 * The input is the XML text of the parts, not the file. Unzipping is a
 * server concern (`src/server/docx.ts`); keeping it out of here is what lets
 * these checks run under `npm test` with nothing installed, on XML strings
 * written inline in the test. That is also why the checks are deterministic:
 * every finding here can be reproduced from the document alone, with no
 * model in the loop. Alternative text a model *drafts* is a proposed fix, not
 * a finding, and lives elsewhere.
 *
 * Locations are paragraph numbers, counted through the body in document
 * order, tables included, because a .docx has no pages until it is laid out.
 * Each carries a short quotation so a reviewer can find the place by eye.
 * The quotation is the customer's own text going into the customer's own
 * report; it must never go anywhere else (see the invariant in CLAUDE.md).
 */

import { contrastRatio, formatRatio, isLargeText, minimumRatio, parseHex, type Rgb } from './contrast';
import type { Finding, Severity } from './findings';
import { KINDS, type Kind } from './kinds';
import { attr, child, children, find, findAll, parseXml, textOf, type XmlElement } from './xml';

export interface DocxParts {
  /** word/document.xml – required. */
  document: string;
  /** word/styles.xml */
  styles?: string;
  /** word/settings.xml */
  settings?: string;
  /** docProps/core.xml */
  core?: string;
}

const WHITE: Rgb = [255, 255, 255];
const DEFAULT_POINTS = 11;
const SNIPPET = 48;
const MIN_PARAGRAPHS_FOR_HEADINGS = 20;
const GENERIC_LINK_TEXT = /^(click here|here|click|read more|more|link|this link|this|learn more|download|see more)[.!]?$/i;
const BARE_URL = /^(https?:\/\/|www\.)\S+$/i;

function finding(kind: Kind, location: string, description: string, severity: Severity): Finding {
  return { kind, criterion: KINDS[kind].criterion, location, description, severity, remediated: false };
}

function snippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > SNIPPET ? `${t.slice(0, SNIPPET - 1)}…` : t;
}

/** Text of the `w:t` runs beneath an element – the words a reader sees. */
function runText(el: XmlElement): string {
  return findAll(el, 't')
    .map((t) => textOf(t))
    .join('');
}

function isOn(el: XmlElement | undefined): boolean {
  if (!el) return false;
  const v = attr(el, 'val');
  return v === undefined || v === '1' || v === 'true' || v === 'on';
}

interface Paragraph {
  el: XmlElement;
  /** 1-based, in document order. */
  number: number;
  text: string;
}

function where(p: Paragraph): string {
  const s = snippet(p.text);
  return s ? `paragraph ${p.number} (“${s}”)` : `paragraph ${p.number}`;
}

interface StyleInfo {
  /** styleId → heading level (1–9), for paragraph styles that are headings. */
  headingLevel: Map<string, number>;
  /** Document default font size in points, if declared. */
  defaultPoints: number;
  /** Whether the document declares a default language anywhere. */
  hasLanguage: boolean;
}

function readStyles(styles: string | undefined, settings: string | undefined): StyleInfo {
  const info: StyleInfo = { headingLevel: new Map(), defaultPoints: DEFAULT_POINTS, hasLanguage: false };
  if (styles) {
    const root = parseXml(styles);
    for (const style of children(root, 'style')) {
      if (attr(style, 'type') !== 'paragraph') continue;
      const id = attr(style, 'styleId');
      if (!id) continue;
      const outline = find(style, 'outlineLvl');
      const lvl = outline ? Number(attr(outline, 'val')) : NaN;
      if (Number.isInteger(lvl) && lvl >= 0 && lvl <= 8) {
        info.headingLevel.set(id, lvl + 1);
        continue;
      }
      // Word's built-in heading styles carry the level in the name even when
      // a template has stripped the outline level.
      const name = attr(child(style, 'name') ?? style, 'val') ?? '';
      const m = /^heading (\d)$/i.exec(name) ?? /^Heading(\d)$/.exec(id);
      if (m) info.headingLevel.set(id, Number(m[1]));
    }
    const defaults = child(root, 'docDefaults');
    const rPr = defaults ? find(defaults, 'rPr') : undefined;
    if (rPr) {
      const sz = child(rPr, 'sz');
      const half = sz ? Number(attr(sz, 'val')) : NaN;
      if (Number.isFinite(half) && half > 0) info.defaultPoints = half / 2;
      const lang = child(rPr, 'lang');
      if (lang && (attr(lang, 'val') || attr(lang, 'eastAsia') || attr(lang, 'bidi'))) info.hasLanguage = true;
    }
  }
  if (settings && !info.hasLanguage) {
    const root = parseXml(settings);
    const theme = child(root, 'themeFontLang');
    if (theme && (attr(theme, 'val') || attr(theme, 'eastAsia') || attr(theme, 'bidi'))) info.hasLanguage = true;
  }
  return info;
}

function headingLevelOf(p: XmlElement, styles: StyleInfo): number | undefined {
  const pPr = child(p, 'pPr');
  if (!pPr) return undefined;
  const styleId = attr(child(pPr, 'pStyle') ?? pPr, 'val');
  if (styleId) {
    const known = styles.headingLevel.get(styleId);
    if (known) return known;
    const m = /^Heading(\d)$/.exec(styleId);
    if (m) return Number(m[1]);
  }
  // A direct outline level on the paragraph counts too; Word writes it when
  // someone sets "Outline level" without applying a heading style.
  const outline = child(pPr, 'outlineLvl');
  if (outline) {
    const lvl = Number(attr(outline, 'val'));
    if (Number.isInteger(lvl) && lvl >= 0 && lvl <= 8) return lvl + 1;
  }
  return undefined;
}

export function detectDocx(parts: DocxParts): Finding[] {
  const out: Finding[] = [];
  const doc = parseXml(parts.document);
  const body = find(doc, 'body') ?? doc;
  const styles = readStyles(parts.styles, parts.settings);

  const paragraphs: Paragraph[] = findAll(body, 'p').map((el, i) => ({ el, number: i + 1, text: runText(el) }));
  const enclosing = (el: XmlElement): Paragraph | undefined => {
    // Paragraph list is in document order; the enclosing one is the last that
    // contains this element. Linear, and documents are not that long.
    let best: Paragraph | undefined;
    for (const p of paragraphs) if (contains(p.el, el)) best = p;
    return best;
  };

  // 2.4.2 Page Titled – for a document, its title property.
  const titleEl = parts.core ? find(parseXml(parts.core), 'title') : undefined;
  if (!titleEl || textOf(titleEl).trim() === '') {
    out.push(
      finding(
        'no-title',
        'document properties',
        'The document has no title. Screen readers announce the filename instead.',
        'blocking',
      ),
    );
  }

  // 3.1.1 Language of Page – a default language somewhere in the document.
  if (!styles.hasLanguage) {
    out.push(
      finding(
        'no-language',
        'document defaults',
        'No document language is set, so a screen reader has to guess how to pronounce the text.',
        'blocking',
      ),
    );
  }

  // 1.1.1 Non-text Content – every picture needs alternative text or a
  // decorative mark.
  let imageNumber = 0;
  for (const drawing of findAll(body, 'drawing')) {
    imageNumber += 1;
    const docPr = find(drawing, 'docPr');
    const descr = docPr ? (attr(docPr, 'descr') ?? '').trim() : '';
    const decorative = docPr ? isOn(find(docPr, 'decorative')) : false;
    if (descr || decorative) continue;
    const p = enclosing(drawing);
    const name = docPr ? attr(docPr, 'name') : undefined;
    out.push(
      finding(
        'image-alt',
        `image ${imageNumber}${name ? ` (${name})` : ''}${p ? `, ${where(p)}` : ''}`,
        'The image has no alternative text and is not marked decorative.',
        'partial',
      ),
    );
  }

  // 1.3.1 Info and Relationships – tables need a header row; headings must
  // not skip levels; a long document needs headings at all.
  let tableNumber = 0;
  for (const tbl of findAll(body, 'tbl')) {
    tableNumber += 1;
    const firstRow = children(tbl, 'tr')[0];
    const trPr = firstRow ? child(firstRow, 'trPr') : undefined;
    if (firstRow && trPr && child(trPr, 'tblHeader')) continue;
    const p = enclosing(tbl);
    const first = firstRow ? snippet(children(firstRow, 'tc').map(runText).join(' · ')) : '';
    out.push(
      finding(
        'table-header',
        `table ${tableNumber}${first ? ` (“${first}”)` : ''}${p ? `, after ${where(p)}` : ''}`,
        'The table has no row marked as a header row, so cells are read without their column names.',
        'partial',
      ),
    );
  }

  let previousLevel = 0;
  let headings = 0;
  for (const p of paragraphs) {
    const level = headingLevelOf(p.el, styles);
    if (level === undefined) continue;
    headings += 1;
    if (previousLevel > 0 && level > previousLevel + 1) {
      out.push(
        finding(
          'heading-skip',
          where(p),
          `Heading level ${level} follows heading level ${previousLevel}, skipping ${level - previousLevel - 1}. Screen reader users navigate by heading level and will think a section is missing.`,
          'partial',
        ),
      );
    }
    previousLevel = level;
  }
  const textParagraphs = paragraphs.filter((p) => p.text.trim() !== '').length;
  if (headings === 0 && textParagraphs >= MIN_PARAGRAPHS_FOR_HEADINGS) {
    out.push(
      finding(
        'no-headings',
        'whole document',
        `The document has ${textParagraphs} paragraphs and no heading styles. Any visual headings are bold text, which assistive technology cannot navigate by.`,
        'partial',
      ),
    );
  }

  // 2.4.4 Link Purpose (In Context) – link text should say where it goes.
  for (const link of findAll(body, 'hyperlink')) {
    const text = runText(link).trim();
    const p = enclosing(link);
    const at = p ? where(p) : 'document body';
    if (text === '') {
      out.push(finding('link-text', at, 'A link has no text at all, so it is announced as just “link”.', 'partial'));
    } else if (GENERIC_LINK_TEXT.test(text)) {
      out.push(
        finding(
          'link-text',
          at,
          `The link text is “${text}”, which does not say where the link goes when read on its own.`,
          'partial',
        ),
      );
    } else if (BARE_URL.test(text)) {
      out.push(
        finding(
          'link-text',
          at,
          `The link text is the bare address “${snippet(text)}”, which a screen reader spells out character by character.`,
          'partial',
        ),
      );
    }
  }

  // 1.4.3 Contrast (Minimum) – coloured runs against their background.
  const reported = new Set<string>();
  for (const p of paragraphs) {
    const pPr = child(p.el, 'pPr');
    const paragraphFill = pPr ? fillOf(child(pPr, 'shd')) : undefined;
    for (const r of findAll(p.el, 'r')) {
      const rPr = child(r, 'rPr');
      if (!rPr) continue;
      const colorEl = child(rPr, 'color');
      const fg = colorEl ? parseColour(attr(colorEl, 'val')) : null;
      if (!fg) continue;
      const text = runText(r).trim();
      if (!text) continue;
      const bg = fillOf(child(rPr, 'shd')) ?? paragraphFill ?? WHITE;
      const sz = child(rPr, 'sz');
      const half = sz ? Number(attr(sz, 'val')) : NaN;
      const points = Number.isFinite(half) && half > 0 ? half / 2 : styles.defaultPoints;
      const bold = isOn(child(rPr, 'b'));
      const ratio = contrastRatio(fg, bg);
      const minimum = minimumRatio(isLargeText(points, bold));
      if (ratio >= minimum) continue;
      const key = `${p.number}:${hex(fg)}:${hex(bg)}`;
      if (reported.has(key)) continue;
      reported.add(key);
      out.push(
        finding(
          'contrast',
          where(p),
          `Text “${snippet(text)}” is #${hex(fg)} on #${hex(bg)}, a contrast of ${formatRatio(ratio)}; it needs ${minimum}:1.`,
          'partial',
        ),
      );
    }
  }

  return out;
}

function contains(ancestor: XmlElement, target: XmlElement): boolean {
  if (ancestor === target) return true;
  for (const c of ancestor.children) {
    if (c.type === 'element' && contains(c, target)) return true;
  }
  return false;
}

/** Word's "auto" means the theme default, which for body text is black on white. */
function parseColour(val: string | undefined): Rgb | null {
  if (!val || val.toLowerCase() === 'auto') return null;
  return parseHex(val);
}

function fillOf(shd: XmlElement | undefined): Rgb | undefined {
  if (!shd) return undefined;
  const fill = attr(shd, 'fill');
  if (!fill || fill.toLowerCase() === 'auto') return undefined;
  return parseHex(fill) ?? undefined;
}

function hex([r, g, b]: Rgb): string {
  return [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}
