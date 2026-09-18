/**
 * The conformance report as WordprocessingML.
 *
 * A Word file rather than a PDF because the customer's next move is to paste
 * it into a proposal, a contract file or their own VPAT, and a PDF is where
 * text goes to stop being editable. It is built from parts rather than from
 * a template file so that `npm test` still runs with nothing installed and
 * nothing binary is checked in: every byte of the output is written here.
 *
 * The document is built to pass `detectDocx`, and a test asserts exactly
 * that. A remediation service that shipped an inaccessible conformance
 * report would be making its own case against itself, and the constraint is
 * not decorative — it is what forced the decisions below:
 *
 * - Headings are real heading styles with outline levels, and run 1, 2, 2, 2
 *   with no skips, because that is what the product demands of a customer.
 * - Every table names its header row with `w:tblHeader`, so the conformance
 *   of a criterion is read with its column name and repeats across a page
 *   break.
 * - **Nothing in the report is marked by colour.** A row still waiting on a
 *   reviewer would be the obvious thing to tint, and tinting it would be a
 *   1.4.1 failure of exactly the kind the report flags in other people's
 *   documents. The status word carries the signal instead, and the remarks
 *   say it again in a sentence.
 * - The document declares its language and carries a title, which are the
 *   two findings the detector raises against nearly every file that arrives.
 */

import { escapeAttr, escapeText } from './xml';
import { COLUMNS, type Acr } from './acr';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const LANGUAGE = 'en-US';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Word rejects control characters outright; a customer's filename is not trusted to lack them. */
function plain(s: string): string {
  return escapeText(s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''));
}

interface RunOptions {
  bold?: boolean;
  size?: number;
}

function run(text: string, o: RunOptions = {}): string {
  const props: string[] = [];
  if (o.bold) props.push('<w:b/>');
  if (o.size) props.push(`<w:sz w:val="${o.size * 2}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${plain(text)}</w:t></w:r>`;
}

function para(text: string, o: RunOptions & { style?: string } = {}): string {
  const pPr = o.style ? `<w:pPr><w:pStyle w:val="${escapeAttr(o.style)}"/></w:pPr>` : '';
  return `<w:p>${pPr}${text === '' ? '' : run(text, o)}</w:p>`;
}

function cell(width: number, body: string): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${body}</w:tc>`;
}

function row(cells: string, header = false): string {
  const trPr = header ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '';
  return `<w:tr>${trPr}${cells}</w:tr>`;
}

const BORDERS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="595959"/>`)
  .join('');

/**
 * `caption` becomes the table's description, which Word surfaces in Table
 * Properties and a screen reader announces before the first cell. A table of
 * numbers with no name is the second most common complaint in a document
 * audit, after images with no alternative text.
 */
function table(caption: string, widths: number[], header: string[], body: string[][]): string {
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const head = row(
    header.map((h, i) => cell(widths[i]!, para(h, { bold: true }))).join(''),
    true,
  );
  const rows = body.map((cells) => row(cells.map((c, i) => cell(widths[i]!, para(c))).join('')));
  return [
    '<w:tbl>',
    '<w:tblPr>',
    '<w:tblStyle w:val="ReportTable"/>',
    `<w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>`,
    `<w:tblBorders>${BORDERS}</w:tblBorders>`,
    `<w:tblCaption w:val="${escapeAttr(caption)}"/>`,
    `<w:tblDescription w:val="${escapeAttr(caption)}"/>`,
    '<w:tblLayout w:type="fixed"/>',
    '</w:tblPr>',
    `<w:tblGrid>${grid}</w:tblGrid>`,
    head,
    ...rows,
    '</w:tbl>',
    // Word needs a paragraph after a table, or two tables run together into one.
    '<w:p/>',
  ].join('');
}

function documentXml(acr: Acr): string {
  const parts: string[] = [];
  parts.push(para('Accessibility Conformance Report', { style: 'Heading1' }));
  parts.push(para(acr.filename));
  if (!acr.complete) {
    parts.push(
      para(
        `Draft — not a deliverable. ${acr.pending} ${
          acr.pending === 1 ? 'criterion has' : 'criteria have'
        } not yet been confirmed by a reviewer, and are reported as Needs Review below.`,
        { bold: true },
      ),
    );
  }

  parts.push(para('About this report', { style: 'Heading2' }));
  parts.push(
    table(
      'About this report',
      [2160, 7200],
      ['Item', 'Detail'],
      acr.facts.map((f) => [f.label, f.value]),
    ),
  );

  parts.push(para('Conformance statement', { style: 'Heading2' }));
  parts.push(para(acr.verdict.headline, { bold: true }));
  parts.push(para(acr.verdict.detail));

  const widths = [2340, 720, 1800, 4500];
  for (const section of acr.sections) {
    parts.push(para(section.principle, { style: 'Heading2' }));
    parts.push(
      table(
        `${section.principle}: conformance by criterion`,
        widths,
        [...COLUMNS],
        section.rows.map((r) => [r.label, r.level, r.status, r.remarks]),
      ),
    );
  }

  parts.push(para('Notes', { style: 'Heading2' }));
  for (const note of acr.notes) parts.push(para(note));

  const sectPr =
    '<w:sectPr>' +
    '<w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
    '</w:sectPr>';

  return `${DECLARATION}<w:document xmlns:w="${W}"><w:body>${parts.join('')}${sectPr}</w:body></w:document>`;
}

function heading(id: string, name: string, level: number, points: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="${id}">` +
    `<w:name w:val="${name}"/>` +
    '<w:basedOn w:val="Normal"/>' +
    '<w:qFormat/>' +
    `<w:pPr><w:keepNext/><w:spacing w:before="${level === 1 ? 360 : 280}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${points * 2}"/></w:rPr>` +
    '</w:style>'
  );
}

function stylesXml(): string {
  return (
    `${DECLARATION}<w:styles xmlns:w="${W}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/>' +
    // 3.1.1 Language of Page, for this document: the one place a reader looks.
    `<w:lang w:val="${LANGUAGE}"/>` +
    '</w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading('Heading1', 'heading 1', 1, 18) +
    heading('Heading2', 'heading 2', 2, 14) +
    '<w:style w:type="table" w:styleId="ReportTable"><w:name w:val="Report Table"/>' +
    `<w:tblPr><w:tblBorders>${BORDERS}</w:tblBorders>` +
    '<w:tblCellMar><w:top w:w="72" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="72" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr></w:style>' +
    '</w:styles>'
  );
}

function coreXml(acr: Acr, now: string): string {
  return (
    `${DECLARATION}<cp:coreProperties ` +
    'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    // 2.4.2 Page Titled, for this document.
    `<dc:title>${plain(acr.title)}</dc:title>` +
    '<dc:creator>508This</dc:creator>' +
    '<cp:lastModifiedBy>508This</cp:lastModifiedBy>' +
    `<dc:language>${LANGUAGE}</dc:language>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${plain(now)}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${plain(now)}</dcterms:modified>` +
    '</cp:coreProperties>'
  );
}

function appXml(): string {
  return (
    `${DECLARATION}<Properties ` +
    'xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>508This</Application>' +
    '</Properties>'
  );
}

function rootRels(): string {
  return (
    `${DECLARATION}<Relationships xmlns="${PKG_REL}">` +
    `<Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${OFFICE_REL}/extended-properties" Target="docProps/app.xml"/>` +
    '</Relationships>'
  );
}

function documentRels(): string {
  return (
    `${DECLARATION}<Relationships xmlns="${PKG_REL}">` +
    `<Relationship Id="rId1" Type="${OFFICE_REL}/styles" Target="styles.xml"/>` +
    '</Relationships>'
  );
}

function contentTypes(): string {
  const main = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  return (
    `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/word/document.xml" ContentType="${main}.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="${main}.styles+xml"/>` +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>'
  );
}

/**
 * The parts of the .docx, in the order they are written into the archive.
 * `[Content_Types].xml` comes first because that is where every reader looks
 * first, and a streaming one expects to find it without seeking.
 *
 * `now` is passed in rather than read from the clock so the same report
 * produces the same bytes — a customer who downloads the statement twice
 * should not get two files that differ.
 */
export function acrParts(acr: Acr, now: string): Map<string, string> {
  return new Map([
    ['[Content_Types].xml', contentTypes()],
    ['_rels/.rels', rootRels()],
    ['word/document.xml', documentXml(acr)],
    ['word/_rels/document.xml.rels', documentRels()],
    ['word/styles.xml', stylesXml()],
    ['docProps/core.xml', coreXml(acr, now)],
    ['docProps/app.xml', appXml()],
  ]);
}

/** The filename the customer sees, derived from theirs. */
export function acrFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base} — accessibility conformance report.docx`;
}
