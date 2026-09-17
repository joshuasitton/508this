/**
 * Remediation for Word documents: the parts in, the parts out, changed.
 *
 * Only what can be fixed *correctly* without a person is fixed here, and
 * "correctly" is the whole test. Marking a table's first row as a header
 * row, setting a language, closing a skipped heading level, darkening a
 * grey until it meets 4.5:1: each is a change with one right answer that
 * detection can verify afterwards. Alternative text, link wording and which
 * bold paragraphs are really headings have no single right answer, and a
 * confident wrong one is worse than a finding, so those go to a reviewer.
 *
 * The output is re-detected by the caller. A fix that does not make its
 * finding disappear is a bug here, and the re-detection is what catches it.
 */

import { adjustForContrast, isLargeText, minimumRatio, parseHex, toHex, type Rgb } from './contrast';
import type { DocxParts } from './docx';
import type { Finding } from './findings';
import type { Applied } from './job';
import type { Kind } from './kinds';
import { detectLanguage, primarySubtag } from './language';
import { attr, child, children, el, find, findAll, parseXml, serializeXml, text, textOf, type XmlElement } from './xml';

export interface RemediationOptions {
  /** Used for the title when the document has no heading to take one from. */
  fallbackTitle: string;
  /** BCP 47, e.g. "en-US". */
  language?: string;
}

export interface Remediation {
  parts: DocxParts;
  applied: Applied[];
}

/** The kinds this module fixes without a person. The job page reads it; a test pins it against what actually gets applied. */
export const FIXABLE_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  'no-title',
  'no-language',
  'table-header',
  'heading-skip',
  'contrast',
  'language-parts',
]);

const CORE_NS = {
  'xmlns:cp': 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  'xmlns:dc': 'http://purl.org/dc/elements/1.1/',
  'xmlns:dcterms': 'http://purl.org/dc/terms/',
  'xmlns:dcmitype': 'http://purl.org/dc/dcmitype/',
  'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
};
const CORE_CONTENT_TYPE = 'application/vnd.openxmlformats-package.core-properties+xml';
const CORE_REL_TYPE = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';

export function remediateDocx(parts: DocxParts, options: RemediationOptions): Remediation {
  const applied: Applied[] = [];
  const out: DocxParts = { ...parts };
  const document = parseXml(parts.document);
  const body = find(document, 'body') ?? document;
  const wPrefix = prefixOf(document, 'body') ?? 'w';
  const w = (local: string) => `${wPrefix}:${local}`;

  // Styles are read for heading levels and written for language and any
  // heading style a level change needs.
  const styles = parts.styles ? parseXml(parts.styles) : undefined;
  let stylesChanged = false;

  // 2.4.2 – title.
  const firstHeading = headingsOf(body, styles, w).find((h) => h.text.trim() !== '');
  const title = (firstHeading?.text ?? options.fallbackTitle).replace(/\s+/g, ' ').trim();
  const titled = setTitle(out, title);
  if (titled) {
    applied.push({
      kind: 'no-title',
      location: 'document properties',
      description: `Set the title to “${title}”${firstHeading ? ', from the first heading' : ', from the filename'}.`,
    });
  }

  // 3.1.1 – language.
  if (styles && !hasLanguage(styles, parts.settings)) {
    const lang = options.language ?? 'en-US';
    const defaults = ensureChild(styles, w('docDefaults'), 0);
    const rPrDefault = ensureChild(defaults, w('rPrDefault'), 0);
    const rPr = ensureChild(rPrDefault, w('rPr'), 0);
    const existing = child(rPr, 'lang');
    if (existing) existing.attrs[w('val')] = lang;
    else rPr.children.push(el(w('lang'), { [w('val')]: lang }));
    stylesChanged = true;
    applied.push({ kind: 'no-language', location: 'document defaults', description: `Set the document language to ${lang}.` });
  }

  // 1.3.1 – table header rows.
  let tableNumber = 0;
  for (const tbl of findAll(body, 'tbl')) {
    tableNumber += 1;
    const firstRow = children(tbl, 'tr')[0];
    if (!firstRow) continue;
    const existing = child(firstRow, 'trPr');
    if (existing && child(existing, 'tblHeader')) continue;
    if (existing) {
      existing.children.unshift(el(w('tblHeader')));
    } else {
      // Schema order inside w:tr: tblPrEx?, trPr?, then cells.
      const at = children(firstRow, 'tblPrEx').length;
      firstRow.children.splice(indexOfNthElement(firstRow, at), 0, el(w('trPr'), {}, [el(w('tblHeader'))]));
    }
    applied.push({
      kind: 'table-header',
      location: `table ${tableNumber}`,
      description: 'Marked the first row as the header row.',
    });
  }

  // 1.3.1 – heading levels. Walk in order; a level deeper than the previous
  // plus one is pulled up to previous plus one, which closes every skip
  // without flattening the outline.
  let previous = 0;
  for (const h of headingsOf(body, styles, w)) {
    let level = h.level;
    if (previous > 0 && level > previous + 1) {
      level = previous + 1;
      const styleId = `Heading${level}`;
      if (styles) stylesChanged = ensureHeadingStyle(styles, styleId, level, w) || stylesChanged;
      setStyle(h.p, styleId, w);
      applied.push({
        kind: 'heading-skip',
        location: `paragraph ${h.number} (“${snippet(h.text)}”)`,
        description: `Changed heading level ${h.level} to level ${level}, so the outline runs in order.`,
      });
    }
    previous = level;
  }

  // 1.4.3 – contrast. Darken (or lighten) each failing run's colour to the
  // nearest passing one.
  const defaultPoints = styles ? defaultPointsOf(styles) : 11;
  const paragraphs = findAll(body, 'p');
  paragraphs.forEach((p, i) => {
    const pPr = child(p, 'pPr');
    const paragraphFill = pPr ? fillOf(child(pPr, 'shd')) : undefined;
    const done = new Set<string>();
    for (const r of findAll(p, 'r')) {
      const rPr = child(r, 'rPr');
      const colorEl = rPr ? child(rPr, 'color') : undefined;
      const val = colorEl ? attr(colorEl, 'val') : undefined;
      if (!colorEl || !val || val.toLowerCase() === 'auto') continue;
      const fg = parseHex(val);
      if (!fg) continue;
      const runText = findAll(r, 't').map(textOf).join('').trim();
      if (!runText) continue;
      const bg = fillOf(child(rPr!, 'shd')) ?? paragraphFill ?? ([255, 255, 255] as Rgb);
      const sz = child(rPr!, 'sz');
      const half = sz ? Number(attr(sz, 'val')) : NaN;
      const points = Number.isFinite(half) && half > 0 ? half / 2 : defaultPoints;
      const bold = isOn(child(rPr!, 'b'));
      const minimum = minimumRatio(isLargeText(points, bold));
      const fixed = adjustForContrast(fg, bg, minimum);
      if (toHex(fixed) === toHex(fg)) continue;
      const key = Object.keys(colorEl.attrs).find((k) => k.endsWith('val')) ?? w('val');
      colorEl.attrs[key] = toHex(fixed);
      // Word's theme colour, if set, would override the literal; drop it.
      for (const k of Object.keys(colorEl.attrs)) if (/theme/i.test(k)) delete colorEl.attrs[k];
      const dedupe = `${toHex(fg)}:${toHex(bg)}`;
      if (done.has(dedupe)) continue;
      done.add(dedupe);
      applied.push({
        kind: 'contrast',
        location: `paragraph ${i + 1} (“${snippet(textOf(p))}”)`,
        description: `Changed the text colour from #${toHex(fg)} to #${toHex(fixed)} on #${toHex(bg)}, which meets ${minimum}:1.`,
      });
    }
  });

  // 3.1.2 – passages in another language get their language on every run.
  const documentLanguage = styles ? documentLanguageOf(styles, parts.settings) : 'en';
  paragraphs.forEach((p, i) => {
    const pText = findAll(p, 't').map(textOf).join('');
    const detected = detectLanguage(pText, documentLanguage);
    if (!detected) return;
    const already = findAll(p, 'lang').some((l) => {
      const v = attr(l, detected.slot) ?? attr(l, 'val');
      return v !== undefined && primarySubtag(v) === detected.language;
    });
    if (already) return;
    for (const r of findAll(p, 'r')) {
      if (!findAll(r, 't').some((t) => textOf(t).trim() !== '')) continue;
      const rPr = ensureChild(r, w('rPr'), 0);
      const lang = child(rPr, 'lang') ?? (() => {
        const made = el(w('lang'));
        rPr.children.push(made);
        return made;
      })();
      lang.attrs[w(detected.slot)] = detected.tag;
    }
    applied.push({
      kind: 'language-parts',
      location: `paragraph ${i + 1} (“${snippet(pText)}”)`,
      description: `Marked the paragraph as ${detected.name} (${detected.tag}).`,
    });
  });

  out.document = serializeXml(document);
  if (styles && stylesChanged) out.styles = serializeXml(styles);
  return { parts: out, applied };
}

function documentLanguageOf(styles: XmlElement, settings: string | undefined): string {
  const defaults = child(styles, 'docDefaults');
  const rPr = defaults ? find(defaults, 'rPr') : undefined;
  const lang = rPr ? child(rPr, 'lang') : undefined;
  const v = lang ? (attr(lang, 'val') ?? attr(lang, 'eastAsia') ?? attr(lang, 'bidi')) : undefined;
  if (v) return primarySubtag(v);
  if (settings) {
    const theme = child(parseXml(settings), 'themeFontLang');
    const t = theme ? (attr(theme, 'val') ?? attr(theme, 'eastAsia') ?? attr(theme, 'bidi')) : undefined;
    if (t) return primarySubtag(t);
  }
  return 'en';
}

// --- helpers ---------------------------------------------------------------

function prefixOf(root: XmlElement, local: string): string | undefined {
  const found = find(root, local);
  const name = found?.name ?? root.name;
  return name.includes(':') ? name.slice(0, name.indexOf(':')) : undefined;
}

function isOn(e: XmlElement | undefined): boolean {
  if (!e) return false;
  const v = attr(e, 'val');
  return v === undefined || v === '1' || v === 'true' || v === 'on';
}

function snippet(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

function fillOf(shd: XmlElement | undefined): Rgb | undefined {
  if (!shd) return undefined;
  const fill = attr(shd, 'fill');
  if (!fill || fill.toLowerCase() === 'auto') return undefined;
  return parseHex(fill) ?? undefined;
}

function defaultPointsOf(styles: XmlElement): number {
  const defaults = child(styles, 'docDefaults');
  const rPr = defaults ? find(defaults, 'rPr') : undefined;
  const sz = rPr ? child(rPr, 'sz') : undefined;
  const half = sz ? Number(attr(sz, 'val')) : NaN;
  return Number.isFinite(half) && half > 0 ? half / 2 : 11;
}

function hasLanguage(styles: XmlElement, settings: string | undefined): boolean {
  const defaults = child(styles, 'docDefaults');
  const rPr = defaults ? find(defaults, 'rPr') : undefined;
  const lang = rPr ? child(rPr, 'lang') : undefined;
  if (lang && (attr(lang, 'val') || attr(lang, 'eastAsia') || attr(lang, 'bidi'))) return true;
  if (settings) {
    const theme = child(parseXml(settings), 'themeFontLang');
    if (theme && (attr(theme, 'val') || attr(theme, 'eastAsia') || attr(theme, 'bidi'))) return true;
  }
  return false;
}

/** First direct child with this name, or a new one inserted at `index`. */
function ensureChild(parent: XmlElement, name: string, index: number): XmlElement {
  const local = name.slice(name.indexOf(':') + 1);
  const existing = child(parent, local);
  if (existing) return existing;
  const made = el(name);
  parent.children.splice(Math.min(index, parent.children.length), 0, made);
  return made;
}

/** The child-array index of the n-th element child. */
function indexOfNthElement(parent: XmlElement, n: number): number {
  let seen = 0;
  for (let i = 0; i < parent.children.length; i++) {
    if (parent.children[i]!.type !== 'element') continue;
    if (seen === n) return i;
    seen += 1;
  }
  return parent.children.length;
}

interface Heading {
  p: XmlElement;
  number: number;
  level: number;
  text: string;
}

function headingLevels(styles: XmlElement | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!styles) return map;
  for (const style of children(styles, 'style')) {
    if (attr(style, 'type') !== 'paragraph') continue;
    const id = attr(style, 'styleId');
    if (!id) continue;
    const outline = find(style, 'outlineLvl');
    const lvl = outline ? Number(attr(outline, 'val')) : NaN;
    if (Number.isInteger(lvl) && lvl >= 0 && lvl <= 8) {
      map.set(id, lvl + 1);
      continue;
    }
    const name = attr(child(style, 'name') ?? style, 'val') ?? '';
    const m = /^heading (\d)$/i.exec(name) ?? /^Heading(\d)$/.exec(id);
    if (m) map.set(id, Number(m[1]));
  }
  return map;
}

function headingsOf(body: XmlElement, styles: XmlElement | undefined, w: (l: string) => string): Heading[] {
  void w;
  const levels = headingLevels(styles);
  const out: Heading[] = [];
  findAll(body, 'p').forEach((p, i) => {
    const pPr = child(p, 'pPr');
    if (!pPr) return;
    const styleId = attr(child(pPr, 'pStyle') ?? pPr, 'val');
    let level: number | undefined;
    if (styleId) level = levels.get(styleId) ?? (/^Heading(\d)$/.exec(styleId) ? Number(styleId.slice(7)) : undefined);
    if (level === undefined) {
      const outline = child(pPr, 'outlineLvl');
      const lvl = outline ? Number(attr(outline, 'val')) : NaN;
      if (Number.isInteger(lvl) && lvl >= 0 && lvl <= 8) level = lvl + 1;
    }
    if (level === undefined) return;
    out.push({ p, number: i + 1, level, text: findAll(p, 't').map(textOf).join('') });
  });
  return out;
}

function setStyle(p: XmlElement, styleId: string, w: (l: string) => string) {
  const pPr = ensureChild(p, w('pPr'), 0);
  const pStyle = child(pPr, 'pStyle');
  if (pStyle) {
    const key = Object.keys(pStyle.attrs).find((k) => k.endsWith('val')) ?? w('val');
    pStyle.attrs[key] = styleId;
  } else {
    pPr.children.unshift(el(w('pStyle'), { [w('val')]: styleId }));
  }
  // A direct outline level would fight the style; remove it.
  pPr.children = pPr.children.filter((c) => c.type !== 'element' || c.local !== 'outlineLvl');
}

/** Adds a built-in-shaped heading style if the document lacks it. Returns whether it did. */
function ensureHeadingStyle(styles: XmlElement, styleId: string, level: number, w: (l: string) => string): boolean {
  if (children(styles, 'style').some((s) => attr(s, 'styleId') === styleId)) return false;
  const sizes = [32, 26, 24, 22, 22, 22, 22, 22, 22];
  styles.children.push(
    el(w('style'), { [w('type')]: 'paragraph', [w('styleId')]: styleId }, [
      el(w('name'), { [w('val')]: `heading ${level}` }),
      el(w('basedOn'), { [w('val')]: 'Normal' }),
      el(w('next'), { [w('val')]: 'Normal' }),
      el(w('uiPriority'), { [w('val')]: '9' }),
      el(w('qFormat')),
      el(w('pPr'), {}, [el(w('keepNext')), el(w('keepLines')), el(w('outlineLvl'), { [w('val')]: String(level - 1) })]),
      el(w('rPr'), {}, [el(w('b')), el(w('sz'), { [w('val')]: String(sizes[level - 1] ?? 22) })]),
    ]),
  );
  return true;
}

/**
 * Sets dc:title in docProps/core.xml, creating the part – and its content
 * type and package relationship – when the document has none. Returns
 * whether anything changed.
 */
function setTitle(parts: DocxParts, title: string): boolean {
  if (parts.core) {
    const core = parseXml(parts.core);
    const existing = find(core, 'title');
    if (existing && textOf(existing).trim() !== '') return false;
    if (existing) {
      existing.children = [text(title)];
    } else {
      const dcPrefix = Object.entries(core.attrs).find(([, v]) => v === CORE_NS['xmlns:dc'])?.[0]?.replace('xmlns:', '') ?? 'dc';
      if (!(`xmlns:${dcPrefix}` in core.attrs)) core.attrs[`xmlns:${dcPrefix}`] = CORE_NS['xmlns:dc'];
      core.children.unshift(el(`${dcPrefix}:title`, {}, [text(title)]));
    }
    parts.core = serializeXml(core);
    return true;
  }
  // No core part at all. Make one, and register it.
  parts.core = serializeXml(el('cp:coreProperties', CORE_NS, [el('dc:title', {}, [text(title)])]));
  if (parts.contentTypes) {
    const types = parseXml(parts.contentTypes);
    if (!children(types, 'Override').some((o) => attr(o, 'PartName') === '/docProps/core.xml')) {
      types.children.push(el('Override', { PartName: '/docProps/core.xml', ContentType: CORE_CONTENT_TYPE }));
      parts.contentTypes = serializeXml(types);
    }
  }
  if (parts.rels) {
    const rels = parseXml(parts.rels);
    if (!children(rels, 'Relationship').some((r) => attr(r, 'Type') === CORE_REL_TYPE)) {
      const ids = new Set(children(rels, 'Relationship').map((r) => attr(r, 'Id')));
      let n = 1;
      while (ids.has(`rId${n}`)) n += 1;
      rels.children.push(el('Relationship', { Id: `rId${n}`, Type: CORE_REL_TYPE, Target: 'docProps/core.xml' }));
      parts.rels = serializeXml(rels);
    }
  }
  return true;
}

const DECORATIVE_URI = '{C183D7F6-B498-43B3-948B-1728B52AA6E4}';
const DECORATIVE_NS = 'http://schemas.microsoft.com/office/drawing/2017/decorative';

/**
 * Fixes a reviewer supplied, written into the document. Alternative text
 * goes on the image's `docPr` as `descr`; "decorative" sets the flag Word
 * itself sets, which tells a screen reader to skip the image; new link
 * wording replaces the link's runs with one run in the first run's
 * formatting. Each finding is found again by its anchor, never by its
 * paragraph number, because automatic remediation may have run first and
 * the anchor is the one thing it does not move.
 *
 * Applied after `remediateDocx` on every rebuild, from the original, so the
 * result is a pure function of the original and the decisions.
 */
export function applyDecisions(parts: DocxParts, findings: readonly Finding[]): Remediation {
  const applied: Applied[] = [];
  const document = parseXml(parts.document);
  const body = find(document, 'body') ?? document;
  const wPrefix = prefixOf(document, 'body') ?? 'w';
  const w = (local: string) => `${wPrefix}:${local}`;
  let changed = false;

  const invisible = new Set<XmlElement>();
  for (const root of findAll(body, 'Fallback')) for (const d of allDescendants(root)) invisible.add(d);
  const links = findAll(body, 'hyperlink').filter((h) => !invisible.has(h));
  const docPrs = findAll(body, 'docPr').filter((d) => !invisible.has(d));

  for (const f of findings) {
    const d = f.decision;
    if (!d || d.action === 'dismiss' || !f.anchor) continue;

    if (f.kind === 'image-alt') {
      const id = f.anchor.replace(/^docPr:/, '');
      const docPr = docPrs.find((x) => attr(x, 'id') === id);
      if (!docPr) continue;
      if (d.action === 'decorative') {
        const aPrefix = prefixOf(docPr, 'extLst') ?? 'a';
        let extLst = child(docPr, 'extLst');
        if (!extLst) {
          extLst = el(`${aPrefix}:extLst`);
          docPr.children.push(extLst);
        }
        if (!find(extLst, 'decorative')) {
          extLst.children.push(
            el(`${aPrefix}:ext`, { uri: DECORATIVE_URI }, [el('adec:decorative', { 'xmlns:adec': DECORATIVE_NS, val: '1' })]),
          );
        }
        docPr.attrs['descr'] = '';
        applied.push({ kind: f.kind, location: f.location, description: `Marked the image decorative, on ${d.by}\u2019s decision.` });
        changed = true;
      } else if (d.action === 'apply' && d.value?.trim()) {
        docPr.attrs['descr'] = d.value.trim();
        applied.push({
          kind: f.kind,
          location: f.location,
          description: `Set the alternative text to \u201c${d.value.trim()}\u201d, as written by ${d.by}.`,
        });
        changed = true;
      }
    } else if (f.kind === 'link-text' && d.action === 'apply' && d.value?.trim()) {
      const index = Number(f.anchor.replace(/^hyperlink:/, ''));
      const link = links[index];
      if (!link) continue;
      const runs = findAll(link, 'r');
      const first = runs[0];
      const rPr = first ? child(first, 'rPr') : undefined;
      const run = el(w('r'), {}, [
        ...(rPr ? [rPr] : []),
        el(w('t'), { 'xml:space': 'preserve' }, [text(d.value.trim())]),
      ]);
      link.children = link.children.filter((c) => c.type !== 'element' || c.local !== 'r');
      link.children.push(run);
      applied.push({
        kind: f.kind,
        location: f.location,
        description: `Changed the link text to \u201c${d.value.trim()}\u201d, as written by ${d.by}.`,
      });
      changed = true;
    }
  }

  return { parts: changed ? { ...parts, document: serializeXml(document) } : parts, applied };
}

function allDescendants(root: XmlElement): XmlElement[] {
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
