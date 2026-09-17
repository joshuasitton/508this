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

import { contrastRatio, formatRatio, isLargeText, minimumRatio, parseHex, relativeLuminance, toHex, type Rgb } from './contrast';
import type { Finding, Severity } from './findings';
import { KINDS, type Kind } from './kinds';
import { detectLanguage, primarySubtag } from './language';
import { findColourWords, findSensory } from './phrases';
import { attr, child, children, elements, find, findAll, parseXml, textOf, type XmlElement } from './xml';

export interface DocxParts {
  /** word/document.xml – required. */
  document: string;
  /** word/styles.xml */
  styles?: string;
  /** word/settings.xml */
  settings?: string;
  /** docProps/core.xml */
  core?: string;
  /** [Content_Types].xml – only remediation needs it, to register a new part. */
  contentTypes?: string;
  /** _rels/.rels – likewise. */
  rels?: string;
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

/** A paragraph's own text: its runs, minus anything inside a text box floating in it. */
function ownText(el: XmlElement): string {
  const skip = new Set<XmlElement>();
  for (const box of findAll(el, 'txbxContent')) for (const t of findAll(box, 't')) skip.add(t);
  return findAll(el, 't')
    .filter((t) => !skip.has(t))
    .map((t) => textOf(t))
    .join('');
}

function descendants(root: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement) => {
    for (const c of node.children) {
      if (c.type !== 'element') continue;
      out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
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
  /** The declared default language's primary subtag, e.g. "en". */
  language: string;
}

function readStyles(styles: string | undefined, settings: string | undefined): StyleInfo {
  const info: StyleInfo = { headingLevel: new Map(), defaultPoints: DEFAULT_POINTS, hasLanguage: false, language: 'en' };
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
      if (lang && (attr(lang, 'val') || attr(lang, 'eastAsia') || attr(lang, 'bidi'))) {
        info.hasLanguage = true;
        info.language = primarySubtag(attr(lang, 'val') ?? attr(lang, 'eastAsia') ?? attr(lang, 'bidi') ?? 'en');
      }
    }
  }
  if (settings && !info.hasLanguage) {
    const root = parseXml(settings);
    const theme = child(root, 'themeFontLang');
    if (theme && (attr(theme, 'val') || attr(theme, 'eastAsia') || attr(theme, 'bidi'))) {
      info.hasLanguage = true;
      info.language = primarySubtag(attr(theme, 'val') ?? attr(theme, 'eastAsia') ?? attr(theme, 'bidi') ?? 'en');
    }
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

  // Word writes every text box twice – once in mc:Choice for modern readers
  // and once in mc:Fallback for old ones – and the fallback is the same
  // content. Everything under a Fallback is invisible to every check here,
  // or each box, link, image and run in it would be found twice. Paragraphs
  // inside text boxes are not body paragraphs either: they are located by
  // their box, and their text is not part of the paragraph the box floats in.
  const invisible = new Set<XmlElement>();
  for (const root of findAll(body, 'Fallback')) for (const d of descendants(root)) invisible.add(d);
  const visible = <T extends XmlElement>(list: T[]): T[] => list.filter((x) => !invisible.has(x));
  const boxed = new Set<XmlElement>();
  for (const box of findAll(body, 'txbxContent')) for (const d of descendants(box)) boxed.add(d);

  const paragraphs: Paragraph[] = visible(findAll(body, 'p'))
    .filter((el) => !boxed.has(el))
    .map((el, i) => ({ el, number: i + 1, text: ownText(el) }));
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
  for (const drawing of visible(findAll(body, 'drawing'))) {
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
  for (const tbl of visible(findAll(body, 'tbl'))) {
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
  for (const link of visible(findAll(body, 'hyperlink'))) {
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
      const key = `${p.number}:${toHex(fg)}:${toHex(bg)}`;
      if (reported.has(key)) continue;
      reported.add(key);
      out.push(
        finding(
          'contrast',
          where(p),
          `Text “${snippet(text)}” is #${toHex(fg)} on #${toHex(bg)}, a contrast of ${formatRatio(ratio)}; it needs ${minimum}:1.`,
          'partial',
        ),
      );
    }
  }

  // 1.2.x – embedded recordings, and 3.3.x – form fields, take the document
  // out of the "static" class for those criteria. Each is a finding for a
  // reviewer; nothing here can fix them.
  const MEDIA = ['videoFile', 'audioFile', 'audioCd', 'wavAudioFile', 'quickTimeFile'];
  let mediaNumber = 0;
  for (const local of MEDIA) {
    for (const m of visible(findAll(body, local))) {
      mediaNumber += 1;
      const p = enclosing(m);
      out.push(
        finding(
          'media',
          `recording ${mediaNumber}${p ? `, ${where(p)}` : ''}`,
          'The document embeds a recording. A reviewer confirms it has captions and an audio description.',
          'partial',
        ),
      );
    }
  }
  let fieldNumber = 0;
  const fieldAt = (el: XmlElement, what: string) => {
    fieldNumber += 1;
    const p = enclosing(el);
    out.push(
      finding(
        'forms',
        `field ${fieldNumber}${p ? `, ${where(p)}` : ''}`,
        `The document contains a ${what}. A reviewer confirms it has a label and instructions.`,
        'partial',
      ),
    );
  };
  for (const sdt of visible(findAll(body, 'sdt'))) fieldAt(sdt, 'content control');
  for (const instr of visible(findAll(body, 'instrText'))) {
    if (/^\s*FORM(TEXT|CHECKBOX|DROPDOWN)\b/.test(textOf(instr))) fieldAt(instr, 'legacy form field');
  }

  // 1.3.2 Meaningful Sequence – reading order is document order unless text
  // lives in a floating box or frame, or a table is being used for layout.
  let boxNumber = 0;
  for (const box of visible(findAll(body, 'txbxContent'))) {
    const inner = runText(box).trim();
    if (!inner) continue;
    boxNumber += 1;
    const p = enclosing(box);
    out.push(
      finding(
        'reading-order',
        `text box ${boxNumber} (“${snippet(inner)}”)${p ? `, ${where(p)}` : ''}`,
        'Text in a floating text box is read out of sequence or not at all.',
        'partial',
      ),
    );
  }
  for (const p of paragraphs) {
    const pPr = child(p.el, 'pPr');
    if (!pPr || !child(pPr, 'framePr') || !p.text.trim()) continue;
    out.push(
      finding('reading-order', where(p), 'The paragraph is positioned in a frame, which is read out of sequence.', 'partial'),
    );
  }
  tableNumber = 0;
  for (const tbl of visible(findAll(body, 'tbl'))) {
    tableNumber += 1;
    if (!looksLikeLayout(tbl)) continue;
    const p = enclosing(tbl);
    out.push(
      finding(
        'layout-table',
        `table ${tableNumber}${p ? `, after ${where(p)}` : ''}`,
        'A borderless table with paragraphs of text in its cells is being used for layout, and is read cell by cell.',
        'partial',
      ),
    );
  }

  // 1.3.3 Sensory Characteristics and 1.4.1 Use of Color, in the prose: the
  // sentences a reviewer has to judge, found for them.
  for (const p of paragraphs) {
    for (const hit of findSensory(p.text)) {
      out.push(
        finding(
          'sensory',
          where(p),
          `The instruction “${snippet(hit.sentence)}” relies on ${hit.kind === 'position' ? 'a position on the page' : hit.kind === 'sound' ? 'a sound' : `a ${hit.kind}`} (“${hit.phrase}”), which a person who cannot ${hit.kind === 'sound' ? 'hear it' : 'see the page'} has no way to follow.`,
          'partial',
        ),
      );
    }
    for (const hit of findColourWords(p.text)) {
      out.push(
        finding(
          'colour-words',
          where(p),
          `“${snippet(hit.sentence)}” uses colour as the signal (“${hit.phrase}”), which a screen reader does not announce and a colour-blind reader may not see.`,
          'partial',
        ),
      );
    }
  }

  // 1.4.1 – colour-only emphasis: a coloured run among plain ones, with no
  // other cue. Hyperlinks and styled runs are skipped; their colour comes
  // from a style that also underlines or otherwise marks them.
  for (const p of paragraphs) {
    const inLink = new Set<XmlElement>();
    for (const h of findAll(p.el, 'hyperlink')) for (const r of findAll(h, 'r')) inLink.add(r);
    const runs = findAll(p.el, 'r').filter((r) => !inLink.has(r) && findAll(r, 't').some((t) => textOf(t).trim() !== ''));
    if (runs.length < 2) continue;
    const plain: XmlElement[] = [];
    const colouredNoCue: XmlElement[] = [];
    let colouredWithCue = 0;
    for (const r of runs) {
      const rPr = child(r, 'rPr');
      if (rPr && child(rPr, 'rStyle')) continue;
      const colorEl = rPr ? child(rPr, 'color') : undefined;
      const rgb = colorEl ? parseColour(attr(colorEl, 'val')) : null;
      const theme = colorEl ? attr(colorEl, 'themeColor') : undefined;
      const isDefault = !rgb || /^(text1|tx1|dark1|dk1)$/i.test(theme ?? '') || relativeLuminanceOf(rgb) < 0.02;
      if (isDefault) {
        plain.push(r);
        continue;
      }
      const cue = ['b', 'i', 'u', 'strike', 'dstrike', 'highlight', 'shd', 'caps', 'smallCaps', 'vertAlign', 'em'].some((c) =>
        isOn(child(rPr!, c)),
      );
      if (cue) colouredWithCue += 1;
      else colouredNoCue.push(r);
    }
    void colouredWithCue;
    if (plain.length === 0 || colouredNoCue.length === 0) continue;
    const first = colouredNoCue[0]!;
    const colorEl = child(child(first, 'rPr')!, 'color')!;
    out.push(
      finding(
        'colour-only',
        where(p),
        `Text “${snippet(runText(first))}” is set apart from the surrounding text by colour alone (#${(attr(colorEl, 'val') ?? '').toUpperCase()}), with no bold, italic, underline or other cue.`,
        'partial',
      ),
    );
  }

  // 1.4.1 – charts. Every embedded chart goes to the reviewer.
  let chartNumber = 0;
  for (const c of visible(findAll(body, 'chart'))) {
    chartNumber += 1;
    const p = enclosing(c);
    out.push(
      finding(
        'chart',
        `chart ${chartNumber}${p ? `, ${where(p)}` : ''}`,
        'The document embeds a chart. A reviewer confirms its series are distinguishable without colour and its data is given as text.',
        'partial',
      ),
    );
  }

  // 3.1.2 Language of Parts – a passage in another language, not marked.
  for (const p of paragraphs) {
    const detected = detectLanguage(p.text, styles.language);
    if (!detected) continue;
    const marked = findAll(p.el, 'lang').some((l) => {
      const v = attr(l, detected.slot) ?? attr(l, 'val');
      return v !== undefined && primarySubtag(v) === detected.language;
    });
    if (marked) continue;
    out.push(
      finding(
        'language-parts',
        where(p),
        `The paragraph appears to be in ${detected.name} but is not marked as such, so it is read with the document's default voice.`,
        'partial',
      ),
    );
  }

  return out;
}

/**
 * A layout table: no visible borders, more than one column, and a cell with
 * more than one paragraph of text. Conservative on purpose; a data table
 * with borders switched off is rare, and a false flag costs a reviewer's
 * time on every document.
 */
function looksLikeLayout(tbl: XmlElement): boolean {
  const tblPr = child(tbl, 'tblPr');
  const borders = tblPr ? child(tblPr, 'tblBorders') : undefined;
  const style = tblPr ? attr(child(tblPr, 'tblStyle') ?? tblPr, 'val') : undefined;
  const borderless = borders
    ? elements(borders).every((b) => ['none', 'nil'].includes(attr(b, 'val') ?? ''))
    : !style || /^TableNormal$/i.test(style);
  if (!borderless) return false;
  const rows = children(tbl, 'tr');
  if (rows.length === 0 || rows.every((r) => children(r, 'tc').length < 2)) return false;
  return rows.some((r) =>
    children(r, 'tc').some((tc) => children(tc, 'p').filter((p) => runText(p).trim() !== '').length > 1),
  );
}

function relativeLuminanceOf(rgb: Rgb): number {
  return relativeLuminance(rgb);
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

