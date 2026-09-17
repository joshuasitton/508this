import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectDocx, type DocxParts } from '../src/domain/docx';
import { FIXABLE_KINDS, remediateDocx } from '../src/domain/remediate';
import { attr, child, children, find, findAll, parseXml, textOf } from '../src/domain/xml';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`;
const p = (t: string, pPr = '', rPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const heading = (level: number, t: string) => p(t, `<w:pStyle w:val="Heading${level}"/>`);
const STYLES = `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>
</w:styles>`;
const CORE_EMPTY = `<cp:coreProperties xmlns:cp="c" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title></dc:title><dc:creator>x</dc:creator></cp:coreProperties>`;
const row = (cells: string[], header = false) =>
  `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`;

const OPTS = { fallbackTitle: 'report' };

test('a document with nothing to fix comes back unchanged, with nothing applied', () => {
  const parts: DocxParts = {
    document: doc(heading(1, 'Intro') + p('Body')),
    styles: STYLES.replace('<w:sz w:val="22"/>', '<w:sz w:val="22"/><w:lang w:val="en-US"/>'),
    core: CORE_EMPTY.replace('<dc:title></dc:title>', '<dc:title>Intro</dc:title>'),
  };
  const r = remediateDocx(parts, OPTS);
  assert.deepEqual(r.applied, []);
  assert.equal(r.parts.core, parts.core);
  assert.equal(r.parts.styles, parts.styles);
});

test('the title comes from the first heading, or the filename when there is none', () => {
  const r = remediateDocx({ document: doc(heading(1, 'Annual  Report') + p('x')), core: CORE_EMPTY }, OPTS);
  assert.equal(textOf(find(parseXml(r.parts.core!), 'title')!), 'Annual Report');
  assert.match(r.applied[0]!.description, /from the first heading/);
  const r2 = remediateDocx({ document: doc(p('x')), core: CORE_EMPTY }, { fallbackTitle: 'grant-narrative' });
  assert.equal(textOf(find(parseXml(r2.parts.core!), 'title')!), 'grant-narrative');
  assert.match(r2.applied[0]!.description, /from the filename/);
});

test('a document with no core part gets one, registered in the content types and package relationships', () => {
  // python-docx and Word always write core.xml, but a document assembled by
  // a tool that did not would otherwise get a title nothing can find.
  const parts: DocxParts = {
    document: doc(heading(1, 'T') + p('x')),
    contentTypes: '<Types xmlns="ct"><Default Extension="xml" ContentType="application/xml"/></Types>',
    rels: '<Relationships xmlns="r"><Relationship Id="rId1" Type="officeDocument" Target="word/document.xml"/></Relationships>',
  };
  const r = remediateDocx(parts, OPTS);
  assert.equal(textOf(find(parseXml(r.parts.core!), 'title')!), 'T');
  const types = parseXml(r.parts.contentTypes!);
  assert.ok(children(types, 'Override').some((o) => attr(o, 'PartName') === '/docProps/core.xml'));
  const rels = parseXml(r.parts.rels!);
  const rel = children(rels, 'Relationship').find((x) => attr(x, 'Target') === 'docProps/core.xml');
  assert.equal(attr(rel!, 'Id'), 'rId2');
});

test('the language is set in the style defaults, creating the chain if needed', () => {
  const bare = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Normal"/></w:styles>`;
  const r = remediateDocx({ document: doc(p('x')), styles: bare }, OPTS);
  const styles = parseXml(r.parts.styles!);
  const lang = find(child(styles, 'docDefaults')!, 'lang')!;
  assert.equal(attr(lang, 'val'), 'en-US');
  assert.equal(children(styles, 'style').length, 1, 'existing styles are kept');
  assert.equal(styles.children[0]!.type === 'element' && styles.children[0]!.local, 'docDefaults', 'docDefaults is first, as the schema requires');
  const fr = remediateDocx({ document: doc(p('x')), styles: bare }, { ...OPTS, language: 'fr-CA' });
  assert.equal(attr(find(parseXml(fr.parts.styles!), 'lang')!, 'val'), 'fr-CA');
});

test('the first row of each table without one becomes a header row, in schema order', () => {
  const withEx = `<w:tbl><w:tr><w:tblPrEx/><w:tc>${p('a')}</w:tc></w:tr></w:tbl>`;
  const withPr = `<w:tbl><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc>${p('b')}</w:tc></w:tr></w:tbl>`;
  const already = `<w:tbl>${row(['c'], true)}</w:tbl>`;
  const r = remediateDocx({ document: doc(heading(1, 'x') + withEx + withPr + already) }, OPTS);
  const tables = findAll(parseXml(r.parts.document), 'tbl');
  for (const t of tables) {
    const first = children(t, 'tr')[0]!;
    const kids = first.children.filter((c) => c.type === 'element').map((c) => (c as { local: string }).local);
    assert.ok(kids.indexOf('trPr') < kids.indexOf('tc'), `trPr before cells in ${kids.join(',')}`);
    if (kids.includes('tblPrEx')) assert.ok(kids.indexOf('tblPrEx') < kids.indexOf('trPr'));
    assert.ok(find(child(first, 'trPr')!, 'tblHeader'));
  }
  assert.equal(r.applied.filter((a) => a.kind === 'table-header').length, 2);
  assert.ok(find(children(tables[1]!, 'tr')[0]!, 'cantSplit'), 'existing row properties are kept');
});

test('a skipped heading level is pulled up, and the style it needs is created if missing', () => {
  // H1 → H3 → H3 → H5. The first H3 becomes H2; the next H3 is then only
  // one deeper and stays; H5 after H3 becomes H4. Heading2 and Heading4 do
  // not exist in the styles part and are added.
  const body = heading(1, 'One') + heading(3, 'Three') + heading(3, 'Three again') + heading(5, 'Five');
  const r = remediateDocx({ document: doc(body), styles: STYLES }, OPTS);
  const levels = findAll(parseXml(r.parts.document), 'pStyle').map((s) => attr(s, 'val'));
  assert.deepEqual(levels, ['Heading1', 'Heading2', 'Heading3', 'Heading4']);
  const ids = children(parseXml(r.parts.styles!), 'style').map((s) => attr(s, 'styleId'));
  assert.ok(ids.includes('Heading2') && ids.includes('Heading4'));
  assert.equal(r.applied.filter((a) => a.kind === 'heading-skip').length, 2);
  assert.match(r.applied.find((a) => a.kind === 'heading-skip')!.description, /level 3 to level 2/);
});

test('a failing colour is moved to the nearest passing one; passing and large text are left alone', () => {
  const grey = p('faint', '', '<w:color w:val="999999"/>');
  const fine = p('fine', '', '<w:color w:val="595959"/>');
  const large = p('big', '', '<w:color w:val="8C8C8C"/><w:sz w:val="36"/>');
  const themed = p('themed', '', '<w:color w:val="999999" w:themeColor="text1" w:themeTint="99"/>');
  const r = remediateDocx({ document: doc(heading(1, 'x') + grey + fine + large + themed), styles: STYLES }, OPTS);
  const colours = findAll(parseXml(r.parts.document), 'color');
  assert.notEqual(attr(colours[0]!, 'val'), '999999');
  assert.equal(attr(colours[1]!, 'val'), '595959');
  assert.equal(attr(colours[2]!, 'val'), '8C8C8C');
  assert.equal(attr(colours[3]!, 'themeColor'), undefined, 'a theme colour would override the literal');
  assert.match(r.applied.find((a) => a.kind === 'contrast')!.description, /from #999999 to #7[0-9A-F]{5} on #FFFFFF, which meets 4\.5:1/);
});

test('after remediation, re-detection finds nothing that remediation claims to fix', () => {
  // The contract: every kind remediation applies must be absent from the
  // output. What is left is exactly what needs a person.
  const drawing = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="p"><wp:docPr id="1" name="Pic"/></wp:inline></w:drawing></w:r></w:p>`;
  const link = `<w:p><w:hyperlink r:id="rId1" xmlns:r="r"><w:r><w:t>here</w:t></w:r></w:hyperlink></w:p>`;
  const body =
    heading(1, 'Report') +
    heading(3, 'Deep') +
    drawing +
    `<w:tbl>${row(['h1', 'h2'])}${row(['a', 'b'])}</w:tbl>` +
    p('grey', '', '<w:color w:val="999999"/>') +
    link;
  const before: DocxParts = { document: doc(body), styles: STYLES, core: CORE_EMPTY };
  const beforeKinds = new Set(detectDocx(before).map((f) => f.kind));
  assert.deepEqual([...beforeKinds].sort(), ['contrast', 'heading-skip', 'image-alt', 'link-text', 'no-language', 'no-title', 'table-header']);
  const r = remediateDocx(before, OPTS);
  const after = detectDocx(r.parts);
  assert.deepEqual([...new Set(after.map((f) => f.kind))].sort(), ['image-alt', 'link-text']);
  const appliedKinds = new Set(r.applied.map((a) => a.kind));
  for (const k of appliedKinds) assert.ok(!after.some((f) => f.kind === k), `${k} still found after remediation`);
});

const SPANISH =
  'Esta guía explica los beneficios disponibles para los veteranos y sus familias. Para solicitar los servicios, complete el formulario en línea o visite una oficina regional. Si tiene preguntas sobre su elegibilidad, comuníquese con nosotros por teléfono.';

test('a passage in another language gets its language on every run with text, and nothing else changes', () => {
  const twoRuns = `<w:p><w:r><w:t xml:space="preserve">${SPANISH.slice(0, 80)}</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${SPANISH.slice(80)}</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>`;
  const styles = STYLES.replace('<w:sz w:val="22"/>', '<w:sz w:val="22"/><w:lang w:val="en-US"/>');
  const r = remediateDocx({ document: doc(heading(1, 'T') + twoRuns), styles, core: CORE_EMPTY.replace('<dc:title></dc:title>', '<dc:title>T</dc:title>') }, OPTS);
  assert.deepEqual(r.applied.map((a) => a.kind), ['language-parts']);
  assert.match(r.applied[0]!.description, /Marked the paragraph as Spanish \(es-US\)/);
  const runs = findAll(parseXml(r.parts.document), 'r').filter((x) => findAll(x, 't').length > 0);
  const langs = runs.map((x) => (find(x, 'lang') ? attr(find(x, 'lang')!, 'val') : undefined));
  assert.deepEqual(langs, [undefined, 'es-US', 'es-US', undefined], 'heading untouched; both text runs marked; the whitespace run left alone');
  assert.ok(find(runs[2]!, 'b'), 'existing run properties are kept');
  assert.deepEqual(detectDocx(r.parts).map((f) => f.kind), [], 'and re-detection agrees');
});

test('FIXABLE_KINDS is exactly the set remediation applies', () => {
  // The job page uses it to count what the button will fix. A kind listed
  // here that remediation never applies would promise a fix that does not
  // come; one missing would hide a fix that does.
  const body =
    heading(1, 'Report') +
    heading(3, 'Deep') +
    `<w:tbl>${row(['h1', 'h2'])}${row(['a', 'b'])}</w:tbl>` +
    p('grey', '', '<w:color w:val="999999"/>') +
    p(SPANISH);
  const r = remediateDocx({ document: doc(body), styles: STYLES, core: CORE_EMPTY }, OPTS);
  assert.deepEqual([...new Set(r.applied.map((a) => a.kind))].sort(), [...FIXABLE_KINDS].sort());
});

import { applyDecisions } from '../src/domain/remediate';

const decision = (action: 'apply' | 'decorative' | 'dismiss', value?: string) => ({
  action,
  value,
  by: 'Josh',
  at: '2026-09-18T10:00:00.000Z',
});

test('a reviewer’s alternative text, decorative mark and link wording are written into the document by anchor', () => {
  const drawing = (id: string) =>
    `<w:p><w:r><w:drawing><wp:inline xmlns:wp="p"><wp:docPr id="${id}" name="Pic ${id}"/></wp:inline></w:drawing></w:r></w:p>`;
  const link = (t: string) =>
    `<w:p><w:hyperlink r:id="rId1" xmlns:r="r"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>${t}</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r></w:hyperlink></w:p>`;
  const parts: DocxParts = { document: doc(heading(1, 'T') + drawing('7') + drawing('8') + link('here') + link('click')), styles: STYLES };
  const found = detectDocx(parts);
  const alt = found.find((f) => f.anchor === 'docPr:7')!;
  const deco = found.find((f) => f.anchor === 'docPr:8')!;
  const link1 = found.find((f) => f.anchor === 'hyperlink:0')!;
  const link2 = found.find((f) => f.anchor === 'hyperlink:1')!;
  alt.decision = decision('apply', '  Bar chart of spend by quarter  ');
  deco.decision = decision('decorative');
  link1.decision = decision('apply', 'the GSA Section 508 page');
  link2.decision = decision('dismiss');

  const r = applyDecisions(parts, found);
  assert.deepEqual(
    r.applied.map((a) => a.kind),
    ['image-alt', 'image-alt', 'link-text'],
  );
  const after = parseXml(r.parts.document);
  const docPrs = findAll(after, 'docPr');
  assert.equal(attr(docPrs[0]!, 'descr'), 'Bar chart of spend by quarter');
  assert.equal(attr(find(docPrs[1]!, 'decorative')!, 'val'), '1');
  const links = findAll(after, 'hyperlink');
  assert.equal(findAll(links[0]!, 'r').length, 1, 'two runs became one');
  assert.equal(textOf(links[0]!), 'the GSA Section 508 page');
  assert.ok(find(links[0]!, 'rStyle'), 'the first run’s formatting is kept');
  assert.equal(textOf(links[1]!), 'click ', 'a dismissed finding changes nothing');

  // Re-detection: the two images and the first link are clean; the
  // dismissed link is still found, as it should be – dismissal is a
  // judgement in the record, not a change to the document.
  const again = detectDocx(r.parts);
  assert.deepEqual(again.filter((f) => f.anchor).map((f) => f.anchor), ['hyperlink:1']);
});

test('decisions are idempotent and survive automatic remediation running first', () => {
  const drawing = `<w:p><w:r><w:drawing><wp:inline xmlns:wp="p"><wp:docPr id="7" name="Pic"/></wp:inline></w:drawing></w:r></w:p>`;
  const parts: DocxParts = { document: doc(heading(1, 'T') + heading(3, 'skip') + drawing), styles: STYLES, core: CORE_EMPTY };
  const found = detectDocx(parts);
  found.find((f) => f.kind === 'image-alt')!.decision = decision('apply', 'A picture');
  const once = applyDecisions(remediateDocx(parts, OPTS).parts, found);
  const twice = applyDecisions(once.parts, found);
  assert.equal(twice.parts.document, once.parts.document);
  assert.equal(attr(find(parseXml(twice.parts.document), 'docPr')!, 'descr'), 'A picture');
});
