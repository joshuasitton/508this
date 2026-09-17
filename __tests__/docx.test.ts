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
