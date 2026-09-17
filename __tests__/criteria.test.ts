import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CRITERIA, DOCUMENT_COVERAGE, DOCUMENT_EXEMPT, appliesTo, criteriaFor, criterion, labelFor } from '../src/domain/criteria';
import { KINDS } from '../src/domain/kinds';

test('the catalogue is exactly WCAG 2.0 Level A and AA', () => {
  // Deliberate: the Revised 508 Standards incorporate WCAG 2.0 A and AA, which is
  // 25 A criteria and 13 AA. If this count changes, somebody has either added a
  // criterion the regulation does not require or dropped one it does. Either is
  // a report that misstates a customer's legal position.
  assert.equal(CRITERIA.length, 38);
  assert.equal(CRITERIA.filter((c) => c.level === 'A').length, 25);
  assert.equal(CRITERIA.filter((c) => c.level === 'AA').length, 13);
});

test('every criterion id is unique and in document order', () => {
  const ids = CRITERIA.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  const numeric = (id: string) => id.split('.').map(Number);
  for (let i = 1; i < ids.length; i++) {
    const [a, b] = [numeric(ids[i - 1]!), numeric(ids[i]!)];
    const before = a[0]! < b[0]! || (a[0] === b[0] && (a[1]! < b[1]! || (a[1] === b[1] && a[2]! < b[2]!)));
    assert.ok(before, `${ids[i - 1]} should come before ${ids[i]}`);
  }
});

test('a criterion belongs to the principle its number says it does', () => {
  const principleOf = { 1: 'Perceivable', 2: 'Operable', 3: 'Understandable', 4: 'Robust' } as const;
  for (const c of CRITERIA) {
    const first = Number(c.id.split('.')[0]) as 1 | 2 | 3 | 4;
    assert.equal(c.principle, principleOf[first], c.id);
  }
});

test('non-web documents are not held to the four set-of-pages criteria', () => {
  // E205.4 Exception, verbatim: 2.4.1, 2.4.5, 3.2.3 and 3.2.4 do not apply to
  // non-web documents. A remediation report that failed a PDF on Bypass Blocks
  // would make the customer pay for work the standard does not ask of them.
  assert.deepEqual([...DOCUMENT_EXEMPT].sort(), ['2.4.1', '2.4.5', '3.2.3', '3.2.4']);
  for (const id of DOCUMENT_EXEMPT) {
    assert.equal(appliesTo(id, 'document'), false, id);
    assert.equal(appliesTo(id, 'web'), true, id);
  }
  assert.equal(criteriaFor('document').length, 34);
  assert.equal(criteriaFor('web').length, 38);
});

test('an id outside the catalogue applies to nothing', () => {
  // WCAG 2.2 added 2.4.11 Focus Not Obscured; it is a fine idea and not part
  // of Section 508. Treating unknown ids as "applies" would let a later WCAG
  // criterion silently fail a customer.
  assert.equal(appliesTo('2.4.11', 'web'), false);
  assert.equal(criterion('2.4.11'), undefined);
});

test('a criterion is named to a person as number and name', () => {
  assert.equal(labelFor('1.1.1'), '1.1.1 Non-text Content');
  assert.equal(labelFor('9.9.9'), '9.9.9');
});

test('every criterion has a coverage class and a remark, and the checked ones are the ones with a detector kind', () => {
  // The report's honesty line. A criterion with no coverage entry would
  // default to Supports on nothing; a "checked" criterion with no kind
  // behind it would claim a check that does not exist.
  const detected = new Set(Object.values(KINDS).map((k) => k.criterion));
  for (const c of CRITERIA) {
    const info = DOCUMENT_COVERAGE[c.id];
    assert.ok(info, `${c.id} has no coverage`);
    assert.ok(info.remark.length > 10, `${c.id} has no remark`);
    if (info.coverage === 'checked' && c.id !== '4.1.1') {
      assert.ok(detected.has(c.id), `${c.id} is "checked" but no kind produces it`);
    }
  }
  assert.equal(Object.keys(DOCUMENT_COVERAGE).length, 38);
  assert.deepEqual(
    Object.entries(DOCUMENT_COVERAGE).filter(([, v]) => v.coverage === 'reviewer').map(([k]) => k),
    ['1.3.3', '1.4.1', '1.4.5', '2.4.6'],
  );
});
