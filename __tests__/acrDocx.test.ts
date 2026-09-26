import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAcr } from '../src/domain/acr';
import { acrFilename } from '../src/domain/acrDocx';
import { detectDocx } from '../src/domain/docx';
import { describeFinding, type Finding } from '../src/domain/findings';
import type { Job } from '../src/domain/job';
import { attr, child, children, find, findAll, parseXml, textOf } from '../src/domain/xml';
import { acrDocx } from '../src/server/acr';
import { readDocxParts } from '../src/server/docx';
import { unzip } from '../src/server/unzip';

const NOW = '2026-09-18T12:00:00Z';

const describeFindings = (fs: readonly Finding[]) => fs.map(describeFinding).join('\n');

function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    createdAt: '2026-09-18T10:00:00.000Z',
    filename: 'Veterans Handbook.docx',
    format: 'docx',
    status: 'detected',
    findings: [],
    ...over,
  };
}

const MESSY: Finding[] = [
  {
    kind: 'image-alt',
    criterion: '1.1.1',
    location: 'image 1 (Chart), paragraph 4 (“Outcomes by site”)',
    description: 'The image has no alternative text & is not marked <decorative>.',
    severity: 'partial',
    remediated: false,
  },
  {
    kind: 'pdf-untagged',
    criterion: '1.3.1',
    location: 'whole document',
    description: 'The document has no structure at all.',
    severity: 'blocking',
    remediated: false,
  },
];

/** The whole way round: model, XML, zip, unzip, parts, detector. */
function roundTrip(over: Partial<Job> = {}) {
  const acr = buildAcr(job(over));
  return readDocxParts(acrDocx(acr, NOW));
}

test('the conformance report passes 508This', () => {
  for (const over of [
    {},
    { format: 'pdf' as const, filename: 'Infographic.pdf' },
    { findings: MESSY },
    { findings: MESSY, remediatedAt: NOW, reviewer: 'A Reviewer' },
  ]) {
    const findings = detectDocx(roundTrip(over));
    assert.deepEqual(findings.map(describeFinding), [], JSON.stringify(over));
  }
});

test('the report declares its language and carries its title', () => {
  const parts = roundTrip();
  const lang = find(find(parseXml(parts.styles!), 'docDefaults')!, 'lang')!;
  assert.equal(attr(lang, 'val'), 'en-US');
  const title = find(parseXml(parts.core!), 'title')!;
  assert.equal(textOf(title), 'Accessibility Conformance Report — Veterans Handbook.docx');
});

test('every table names its header row, so a conformance level is read with its column', () => {
  const body = find(parseXml(roundTrip().document), 'body')!;
  const tables = findAll(body, 'tbl');
  assert.equal(tables.length, 5); // the facts, then one per principle
  for (const tbl of tables) {
    const first = children(tbl, 'tr')[0]!;
    assert.ok(child(child(first, 'trPr')!, 'tblHeader'), 'first row is a header row');
    assert.ok(attr(child(child(tbl, 'tblPr')!, 'tblDescription')!, 'val'), 'the table is named');
  }
});

test('headings are real headings and run without a skip', () => {
  const parts = roundTrip();
  const doc = parseXml(parts.document);
  const styles = parseXml(parts.styles!);
  const levels = new Map(
    children(styles, 'style')
      .filter((s) => find(s, 'outlineLvl'))
      .map((s) => [attr(s, 'styleId')!, Number(attr(find(s, 'outlineLvl')!, 'val')) + 1]),
  );
  const used = findAll(find(doc, 'body')!, 'p')
    .map((p) => {
      const pPr = child(p, 'pPr');
      const style = pPr ? child(pPr, 'pStyle') : undefined;
      return style ? levels.get(attr(style, 'val')!) : undefined;
    })
    .filter((n): n is number => n !== undefined);
  assert.deepEqual(used, [1, 2, 2, 2, 2, 2, 2, 2]);
});

test('nothing in the report is marked by colour', () => {
  const body = find(parseXml(roundTrip({ findings: MESSY }).document), 'body')!;
  assert.deepEqual(findAll(body, 'color'), []);
  assert.deepEqual(findAll(body, 'highlight'), []);
});

test('a draft says so, and a statement does not', () => {
  const draft = textOf(find(parseXml(roundTrip().document), 'body')!);
  assert.ok(draft.includes('Draft — not a deliverable'));
  const confirmed = textOf(
    find(
      parseXml(
        roundTrip({
          reviewer: 'A Reviewer',
          confirmations: Object.fromEntries(
            ['1.3.3', '1.4.1', '1.4.5', '2.4.6'].map((id) => [id, { by: 'A Reviewer', at: NOW }]),
          ),
        }).document,
      ),
      'body',
    )!,
  );
  assert.ok(!confirmed.includes('Draft'));
  assert.ok(confirmed.includes('Conforms to Section 508'));
});

test('a customer filename with XML in it does not break the report', () => {
  const parts = roundTrip({ filename: 'Q3 <Draft> "final" & more.docx' });
  assert.equal(
    textOf(find(parseXml(parts.core!), 'title')!),
    'Accessibility Conformance Report — Q3 <Draft> "final" & more.docx',
  );
  assert.ok(textOf(find(parseXml(parts.document), 'body')!).includes('Q3 <Draft> "final" & more.docx'));
  assert.deepEqual(detectDocx(parts), []);
});

test('control characters in a filename are stripped rather than written', () => {
  const parts = roundTrip({ filename: `Report${String.fromCharCode(7)}${String.fromCharCode(1)}.docx` });
  assert.equal(textOf(find(parseXml(parts.core!), 'title')!), 'Accessibility Conformance Report — Report.docx');
});

/*
 * Asserted against the finished archive rather than against `acrParts`,
 * because the package is no longer all text: the domain declares the mark and
 * the server supplies its bytes, so only the assembled .docx has both. Word
 * refuses to open a file that promises a part it does not carry, and that is
 * exactly the seam this now covers.
 */
test('every part the archive declares is a part the archive has', () => {
  const entries = unzip(acrDocx(buildAcr(job()), NOW));
  const text = (name: string) => new TextDecoder().decode(entries.get(name)!);

  const types = parseXml(text('[Content_Types].xml'));
  for (const o of children(types, 'Override')) {
    const name = attr(o, 'PartName')!.replace(/^\//, '');
    assert.ok(entries.has(name), name);
  }
  for (const rels of ['_rels/.rels', 'word/_rels/document.xml.rels']) {
    const base = rels === '_rels/.rels' ? '' : 'word/';
    for (const r of children(parseXml(text(rels)), 'Relationship')) {
      assert.ok(entries.has(base + attr(r, 'Target')!), attr(r, 'Target')!);
    }
  }
});

/*
 * The report passing 508This is only evidence if the detector can see the
 * mark at all. Strip the decorative flag out of the finished document and the
 * detector must complain — which proves both that it is looking, and that the
 * flag is what keeps this product's own report clean rather than luck.
 */
test('the mark passes only because it is marked decorative', () => {
  const entries = unzip(acrDocx(buildAcr(job()), NOW));
  const document = new TextDecoder().decode(entries.get('word/document.xml')!);
  assert.match(document, /adec:decorative/, 'the mark is not marked decorative');

  const stripped = document.replace(/<adec:decorative[^>]*\/>/, '');
  const found = detectDocx({ ...readDocxParts(acrDocx(buildAcr(job()), NOW)), document: stripped });
  const unlabelled = found.filter((f) => f.kind === 'image-alt');
  assert.equal(unlabelled.length, 1, describeFindings(found));
  assert.match(unlabelled[0]!.description, /no alternative text/);
});

test('the mark rides along as real bytes, declared as a PNG', () => {
  const entries = unzip(acrDocx(buildAcr(job()), NOW));
  const png = entries.get('word/media/mark.png');
  assert.ok(png, 'the statement carries no mark');
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'the mark is not a PNG');

  const types = new TextDecoder().decode(entries.get('[Content_Types].xml')!);
  assert.match(types, /Extension="png" ContentType="image\/png"/);
});

test('the same report twice is the same bytes', () => {
  const acr = buildAcr(job());
  assert.deepEqual(acrDocx(acr, NOW), acrDocx(acr, NOW));
});

test('the delivered name is the customer’s, not the job id', () => {
  assert.equal(acrFilename('Veterans Handbook.docx'), 'Veterans Handbook — accessibility conformance report.docx');
  assert.equal(acrFilename('Infographic.pdf'), 'Infographic — accessibility conformance report.docx');
  assert.equal(acrFilename('no-extension'), 'no-extension — accessibility conformance report.docx');
});
