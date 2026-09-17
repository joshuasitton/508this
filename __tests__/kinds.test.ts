import { test } from 'node:test';
import assert from 'node:assert/strict';

import { criterion } from '../src/domain/criteria';
import { detectDocx } from '../src/domain/docx';
import { ALL_KINDS, KINDS } from '../src/domain/kinds';

test('every kind maps to a criterion in the catalogue and has its three sentences', () => {
  // The report groups by kind and the ACR scores by criterion. A kind whose
  // criterion is not in the catalogue would show a customer a problem the
  // report could never score, and a kind missing a sentence would show a
  // heading with nothing under it.
  for (const kind of ALL_KINDS) {
    const info = KINDS[kind];
    assert.ok(criterion(info.criterion), `${kind} → ${info.criterion} is not in the catalogue`);
    assert.ok(info.title.length > 5, `${kind} has no title`);
    assert.ok(info.why.length > 40, `${kind} has no "why"`);
    assert.ok(info.fix.length > 20, `${kind} has no "fix"`);
    assert.match(info.fix, /^We /, `${kind}: the fix is what we do, in those words`);
  }
});

test('every finding the detector produces carries a kind whose criterion matches', () => {
  // A document with everything wrong at once. If a check ever sets a
  // criterion by hand instead of through its kind, the two can disagree and
  // the report would group a finding under one heading and score it under
  // another.
  const W = 'xmlns:w="w" xmlns:wp="wp" xmlns:r="r"';
  const p = (t: string, pPr = '', rPr = '') =>
    `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t>${t}</w:t></w:r></w:p>`;
  const body =
    p('One', '<w:pStyle w:val="Heading1"/>') +
    p('Three', '<w:pStyle w:val="Heading3"/>') +
    '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="x"/></wp:inline></w:drawing></w:r></w:p>' +
    `<w:tbl><w:tr><w:tc>${p('a')}</w:tc></w:tr></w:tbl>` +
    `<w:p><w:hyperlink r:id="rId1"><w:r><w:t>here</w:t></w:r></w:hyperlink></w:p>` +
    p('grey', '', '<w:color w:val="999999"/>');
  const findings = detectDocx({ document: `<w:document ${W}><w:body>${body}</w:body></w:document>` });
  const seen = new Set(findings.map((f) => f.kind));
  for (const f of findings) {
    assert.ok(f.kind in KINDS, `unknown kind ${f.kind}`);
    assert.equal(f.criterion, KINDS[f.kind].criterion, `${f.kind} scored under ${f.criterion}`);
  }
  for (const kind of ['no-title', 'no-language', 'image-alt', 'table-header', 'heading-skip', 'link-text', 'contrast']) {
    assert.ok(seen.has(kind as never), `expected the sample to produce ${kind}`);
  }
});
