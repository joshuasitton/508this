import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectDocx, type DocxParts } from '../src/domain/docx';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function doc(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
}
function p(text: string, pPr = '', rPr = ''): string {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}
const heading = (level: number, text: string) => p(text, `<w:pStyle w:val="Heading${level}"/>`);

const STYLES = `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="BigTitle"><w:name w:val="Big Title"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
</w:styles>`;
const CORE = `<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Annual Report</dc:title></cp:coreProperties>`;

/** A document with nothing wrong, to prove the checks do not fire on their own. */
function clean(body: string, extra: Partial<DocxParts> = {}): DocxParts {
  return { document: doc(body), styles: STYLES, core: CORE, ...extra };
}

const byCriterion = (parts: DocxParts, id: string) => detectDocx(parts).filter((f) => f.criterion === id);

test('a clean document produces no findings', () => {
  assert.deepEqual(detectDocx(clean(heading(1, 'Intro') + p('Some text.'))), []);
});

test('a missing title is a blocking 2.4.2 finding, whether the part is absent or empty', () => {
  assert.equal(byCriterion(clean(p('x'), { core: undefined }), '2.4.2')[0]?.severity, 'blocking');
  const empty = CORE.replace('Annual Report', '  ');
  assert.equal(byCriterion(clean(p('x'), { core: empty }), '2.4.2').length, 1);
  assert.equal(byCriterion(clean(p('x')), '2.4.2').length, 0);
});

test('a document language can come from styles or settings; neither is a blocking 3.1.1', () => {
  const noLang = STYLES.replace('<w:lang w:val="en-US"/>', '');
  assert.equal(byCriterion(clean(p('x'), { styles: noLang }), '3.1.1')[0]?.severity, 'blocking');
  const settings = `<w:settings ${W}><w:themeFontLang w:val="en-US"/></w:settings>`;
  assert.equal(byCriterion(clean(p('x'), { styles: noLang, settings }), '3.1.1').length, 0);
  assert.equal(byCriterion(clean(p('x')), '3.1.1').length, 0);
});

test('an image without alternative text is a 1.1.1 finding; described or decorative images are not', () => {
  const drawing = (docPr: string) =>
    `<w:p><w:r><w:drawing><wp:inline xmlns:wp="p"><wp:docPr id="1" name="Picture 1" ${docPr}</wp:inline></w:drawing></w:r></w:p>`;
  const none = drawing('/>');
  const described = drawing('descr="Bar chart of spend by quarter"/>');
  const blankDescr = drawing('descr="  "/>');
  const decorative = drawing(
    '><a:extLst xmlns:a="a"><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="d" val="1"/></a:ext></a:extLst></wp:docPr>',
  );
  const findings = byCriterion(clean(p('Intro') + none + described + blankDescr + decorative), '1.1.1');
  assert.equal(findings.length, 2);
  assert.equal(findings[0]?.location, 'image 1 (Picture 1), paragraph 2');
  assert.equal(findings[1]?.location, 'image 3 (Picture 1), paragraph 4');
  assert.equal(findings[0]?.severity, 'partial');
});

test('a table whose first row is not a header row is a 1.3.1 finding', () => {
  const row = (cells: string[], header = false) =>
    `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`;
  const bad = `<w:tbl>${row(['Item', 'Cost'])}${row(['Desk', '$400'])}</w:tbl>`;
  const good = `<w:tbl>${row(['Item', 'Cost'], true)}${row(['Desk', '$400'])}</w:tbl>`;
  const findings = byCriterion(clean(p('Costs') + bad + good), '1.3.1');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.location, /^table 1 \(“Item · Cost”\)/);
  assert.match(findings[0]!.description, /header row/);
});

test('a skipped heading level is a 1.3.1 finding; a custom style with an outline level counts as a heading', () => {
  // Heading 1 → Heading 3 skips 2. BigTitle has outlineLvl 0, so it is a
  // level-1 heading even though its name says nothing of the kind; the
  // outline level is what assistive technology reads.
  const body = p('Title', '<w:pStyle w:val="BigTitle"/>') + heading(3, 'Deep') + heading(2, 'Fine') + heading(3, 'Fine too');
  const findings = byCriterion(clean(body), '1.3.1');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.location, 'paragraph 2 (“Deep”)');
  assert.match(findings[0]!.description, /level 3 follows heading level 1/);
});

test('a long document with no headings at all is a 1.3.1 finding; a short one is not', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => p(`Paragraph ${i + 1}.`)).join('');
  const nineteen = Array.from({ length: 19 }, (_, i) => p(`Paragraph ${i + 1}.`)).join('');
  assert.equal(byCriterion(clean(twenty), '1.3.1').length, 1);
  assert.equal(byCriterion(clean(twenty), '1.3.1')[0]?.location, 'whole document');
  assert.equal(byCriterion(clean(nineteen), '1.3.1').length, 0);
  assert.equal(byCriterion(clean(heading(1, 'A') + twenty), '1.3.1').length, 0);
});

test('generic and bare-URL link text are 2.4.4 findings; descriptive text is not', () => {
  const link = (text: string) => `<w:p><w:hyperlink r:id="rId1" xmlns:r="r"><w:r><w:t>${text}</w:t></w:r></w:hyperlink></w:p>`;
  const spaced = `<w:p><w:hyperlink r:id="rId1" xmlns:r="r"><w:r><w:t>click</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:t>here</w:t></w:r></w:hyperlink></w:p>`;
  const body = link('click here') + link('https://www.gsa.gov/508') + link('the GSA Section 508 page') + spaced + link('');
  const findings = byCriterion(clean(p('Intro') + body), '2.4.4');
  assert.equal(findings.length, 4);
  assert.match(findings[0]!.description, /“click here”/);
  assert.match(findings[1]!.description, /bare address/);
  assert.match(findings[2]!.description, /“click here”/);
  assert.match(findings[3]!.description, /no text at all/);
});

test('coloured text below 4.5:1 on its background is a 1.4.3 finding, once per paragraph and colour pair', () => {
  const grey = p('faint', '', '<w:color w:val="999999"/>') ; // 2.85:1 on white
  const ok = p('fine', '', '<w:color w:val="595959"/>'); // 7:1 on white
  const shaded = p('on yellow', '<w:shd w:val="clear" w:fill="FFFF00"/>', '<w:color w:val="FFFFFF"/>'); // 1.07:1
  const twice = `<w:p><w:r><w:rPr><w:color w:val="999999"/></w:rPr><w:t>a</w:t></w:r><w:r><w:rPr><w:color w:val="999999"/></w:rPr><w:t>b</w:t></w:r></w:p>`;
  const auto = p('auto', '', '<w:color w:val="auto"/>');
  const findings = byCriterion(clean(heading(1, 'x') + grey + ok + shaded + twice + auto), '1.4.3');
  assert.equal(findings.length, 3);
  assert.match(findings[0]!.description, /#999999 on #FFFFFF, a contrast of 2\.84:1; it needs 4\.5:1/);
  assert.match(findings[1]!.description, /#FFFFFF on #FFFF00/);
  assert.equal(findings[2]?.location, 'paragraph 5 (“ab”)');
});

test('large text gets the 3:1 minimum: 18pt, or 14pt bold', () => {
  // 999999 on white is 2.84:1, which fails even large text; 8C8C8C is 3.19:1,
  // which fails body text and passes large. Size is in half-points.
  const largeOk = p('big', '', '<w:color w:val="8C8C8C"/><w:sz w:val="36"/>');
  const boldOk = p('bold', '', '<w:color w:val="8C8C8C"/><w:sz w:val="28"/><w:b/>');
  const smallBad = p('small', '', '<w:color w:val="8C8C8C"/><w:sz w:val="28"/>');
  const largeBad = p('still bad', '', '<w:color w:val="999999"/><w:sz w:val="36"/>');
  const findings = byCriterion(clean(heading(1, 'x') + largeOk + boldOk + smallBad + largeBad), '1.4.3');
  assert.deepEqual(
    findings.map((f) => f.location),
    ['paragraph 4 (“small”)', 'paragraph 5 (“still bad”)'],
  );
  assert.match(findings[1]!.description, /needs 3:1/);
});

test('every finding starts unremediated with a criterion from the catalogue', () => {
  const findings = detectDocx({ document: doc(p('x')) });
  assert.ok(findings.length >= 2);
  for (const f of findings) {
    assert.equal(f.remediated, false);
    assert.match(f.criterion, /^\d\.\d\.\d$/);
  }
});

test('an embedded recording and a form field are findings for a reviewer', () => {
  const video = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="p"><wp:docPr id="1" name="Clip" descr="A clip"/><a:videoFile xmlns:a="a" r:link="rId9"/></wp:inline></w:drawing></w:r></w:p>`;
  const control = `<w:p><w:sdt><w:sdtContent><w:r><w:t>Name:</w:t></w:r></w:sdtContent></w:sdt></w:p>`;
  const legacy = `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r></w:p>`;
  const findings = detectDocx(clean(heading(1, 'x') + video + control + legacy));
  assert.deepEqual(
    findings.map((f) => [f.kind, f.criterion]),
    [
      ['media', '1.2.1'],
      ['forms', '3.3.2'],
      ['forms', '3.3.2'],
    ],
  );
  assert.equal(findings[0]?.location, 'recording 1, paragraph 2');
  assert.equal(findings[2]?.location, 'field 2, paragraph 4');
});

const SPANISH =
  'Esta guía explica los beneficios disponibles para los veteranos y sus familias. Para solicitar los servicios, complete el formulario en línea o visite una oficina regional. Si tiene preguntas sobre su elegibilidad, comuníquese con nosotros por teléfono.';

test('a Spanish paragraph in an English document is a 3.1.2 finding unless its runs are marked', () => {
  const unmarked = p(SPANISH);
  const marked = p(SPANISH, '', '<w:lang w:val="es-MX"/>');
  const english = p('This guide explains the benefits available to veterans and their families and how to apply for them online or at a regional office near you.');
  const findings = byCriterion(clean(heading(1, 'x') + unmarked + marked + english), '3.1.2');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'language-parts');
  assert.match(findings[0]!.location, /^paragraph 2 /);
  assert.match(findings[0]!.description, /appears to be in Spanish/);
});

test('in a Spanish document, the English paragraph is the one flagged', () => {
  const es = STYLES.replace('<w:lang w:val="en-US"/>', '<w:lang w:val="es-ES"/>');
  const english = p('This guide explains the benefits available to veterans and their families and how to apply for them online or at a regional office near you.');
  const findings = byCriterion(clean(heading(1, 'x') + p(SPANISH) + english, { styles: es }), '3.1.2');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.description, /appears to be in English/);
});

test('text in a floating box or a frame is a 1.3.2 finding, counted once per box, and box text stays out of the body', () => {
  // Word writes a text box twice: once as wps:txbx for modern readers and
  // once as a v:textbox fallback. That is one box to a person.
  const box = `<w:p><w:r><mc:AlternateContent xmlns:mc="m"><mc:Choice><w:drawing><wp:anchor xmlns:wp="p"><wps:txbx xmlns:wps="s"><w:txbxContent>${p('Key figure: 42%')}</w:txbxContent></wps:txbx></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape xmlns:v="v"><v:textbox><w:txbxContent>${p('Key figure: 42%')}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
  const framed = p('Sidebar text', '<w:framePr w:w="2000" w:hAnchor="page"/>');
  const emptyBox = `<w:p><w:r><w:drawing><wp:anchor xmlns:wp="p"><wps:txbx xmlns:wps="s"><w:txbxContent><w:p/></w:txbxContent></wps:txbx></wp:anchor></w:drawing></w:r></w:p>`;
  const findings = byCriterion(clean(heading(1, 'x') + box + framed + emptyBox), '1.3.2');
  assert.deepEqual(
    findings.map((f) => [f.kind, f.location]),
    [
      ['reading-order', 'text box 1 (“Key figure: 42%”), paragraph 2'],
      ['reading-order', 'paragraph 3 (“Sidebar text”)'],
    ],
  );
  // A link inside the box is found once, not once per copy of the box.
  const boxWithLink = box.replace(/Key figure: 42%<\/w:t><\/w:r><\/w:p>/g, 'Key figure: 42%</w:t></w:r><w:hyperlink r:id="rId1" xmlns:r="r"><w:r><w:t>here</w:t></w:r></w:hyperlink></w:p>');
  assert.equal(byCriterion(clean(heading(1, 'x') + boxWithLink), '2.4.4').length, 1);
});

test('a borderless multi-column table with paragraphs in its cells is a layout table; a data table is not', () => {
  const cell = (inner: string) => `<w:tc>${inner}</w:tc>`;
  const layout = `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders></w:tblPr><w:tr>${cell(p('Left column first paragraph.') + p('Left column second paragraph.'))}${cell(p('Right column.'))}</w:tr></w:tbl>`;
  const data = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(p('Item'))}${cell(p('Cost'))}</w:tr><w:tr>${cell(p('Desk'))}${cell(p('$400'))}</w:tr></w:tbl>`;
  const borderlessData = `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="nil"/></w:tblBorders></w:tblPr><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(p('Item'))}${cell(p('Cost'))}</w:tr><w:tr>${cell(p('Desk'))}${cell(p('$400'))}</w:tr></w:tbl>`;
  const findings = byCriterion(clean(heading(1, 'x') + layout + data + borderlessData), '1.3.2');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'layout-table');
  assert.match(findings[0]!.location, /^table 1/);
});

test('sensory and colour-word instructions are findings for a reviewer, once per sentence', () => {
  const body =
    heading(1, 'How to apply') +
    p('To continue, click the button on the left. Required fields are marked in red.') +
    p('See the table below for the full list. The Red Cross reviewed it.');
  const findings = detectDocx(clean(body)).filter((f) => f.kind === 'sensory' || f.kind === 'colour-words');
  assert.deepEqual(
    findings.map((f) => [f.kind, f.criterion]),
    [
      ['sensory', '1.3.3'],
      ['colour-words', '1.4.1'],
    ],
  );
  assert.match(findings[0]!.description, /relies on a position on the page \(“on the left”\)/);
  assert.match(findings[1]!.description, /uses colour as the signal \(“marked in red”\)/);
});

test('text set apart by colour alone is a 1.4.1 finding; with another cue, in a link, or as a whole paragraph it is not', () => {
  const run = (t: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
  const alone = `<w:p>${run('Deadline is ')}${run('30 June', '<w:color w:val="C00000"/>')}${run('.')}</w:p>`;
  const withBold = `<w:p>${run('Deadline is ')}${run('30 June', '<w:color w:val="C00000"/><w:b/>')}${run('.')}</w:p>`;
  const link = `<w:p>${run('See ')}<w:hyperlink r:id="rId1" xmlns:r="r">${run('the guidance page', '<w:rStyle w:val="Hyperlink"/><w:color w:val="0563C1"/>')}</w:hyperlink>${run('.')}</w:p>`;
  const whole = `<w:p>${run('All of this ', '<w:color w:val="C00000"/>')}${run('is red.', '<w:color w:val="C00000"/>')}</w:p>`;
  const themedText = `<w:p>${run('Plain ')}${run('also plain', '<w:color w:val="000000" w:themeColor="text1"/>')}</w:p>`;
  const findings = byCriterion(clean(heading(1, 'x') + alone + withBold + link + whole + themedText), '1.4.1');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'colour-only');
  assert.equal(findings[0]?.location, 'paragraph 2 (“Deadline is 30 June.”)');
  assert.match(findings[0]!.description, /“30 June” is set apart .* by colour alone \(#C00000\)/);
});

test('an embedded chart is a 1.4.1 finding for a reviewer', () => {
  const chart = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="p"><wp:docPr id="3" name="Chart 1" descr="Spend by quarter"/><a:graphic xmlns:a="a"><a:graphicData><c:chart xmlns:c="c" r:id="rId7" xmlns:r="r"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const findings = detectDocx(clean(heading(1, 'x') + chart)).filter((f) => f.kind === 'chart');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.location, 'chart 1, paragraph 2');
});
