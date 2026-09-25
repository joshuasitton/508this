import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COLUMN_BLOCKS, GUTTER, countColumns, sequenceFindings, type PlacedBlock, type PageSequence } from '../src/domain/pdfSequence';

const WIDTH = 1000;

/** A block of text at a given place in the reading order and on the page. */
const at = (order: number, top: number, text = `Block ${order}`, left = 100, right = 900): PlacedBlock => ({
  order,
  text,
  top,
  bottom: top + 20,
  left,
  right,
});

const page = (blocks: PlacedBlock[], number = 1): PageSequence => ({ page: number, width: WIDTH, blocks });

const lines = (tops: number[]): PlacedBlock[] => tops.map((top, i) => at(i, top));

test('a document read down the page in order says nothing', () => {
  assert.deepEqual(sequenceFindings([page(lines([100, 200, 300, 400, 500]))], true), []);
});

/**
 * The failure the criterion is about: what a screen reader announces is
 * not what somebody reading the page follows.
 */
test('a block read later but sitting above an earlier one is a finding', () => {
  const blocks = [at(0, 500, 'The conclusion'), at(1, 100, 'The introduction'), at(2, 600)];
  const [found, ...rest] = sequenceFindings([page(blocks)], true);
  assert.equal(rest.length, 0);
  assert.equal(found?.criterion, '1.3.2');
  assert.equal(found?.location, 'page 1');
  assert.match(found!.description, /The conclusion/);
  assert.match(found!.description, /The introduction/);
  assert.match(found!.description, /sits above/);
});

test('one finding per page, and the page is named', () => {
  const bad = [at(0, 500), at(1, 100), at(2, 50), at(3, 20)];
  const found = sequenceFindings([page(bad, 3), page(bad, 7)], true);
  assert.deepEqual(
    found.map((f) => f.location),
    ['page 3', 'page 7'],
  );
});

/**
 * Everything below is a case that must NOT fire. A check that cries wolf
 * on a correct document is worse than no check: the reviewer learns to
 * click past it, and then misses the real one.
 */
test('blocks sharing a line are not an inversion, whatever order they are read in', () => {
  // Two cells of a row, tagged right-to-left. Same line, so no claim.
  const row = [at(0, 300, 'Second cell', 500, 900), at(1, 300, 'First cell', 100, 400)];
  assert.deepEqual(sequenceFindings([page(row)], true), []);
});

test('a superscript slightly above its own line is not an inversion', () => {
  const body = at(0, 300, 'A sentence with a footnote marker');
  const marker: PlacedBlock = { order: 1, text: '12', top: 294, bottom: 304, left: 400, right: 410 };
  assert.deepEqual(sequenceFindings([page([body, marker, at(2, 340)])], true), []);
});

test('a page with a single block has nothing to be out of order with', () => {
  assert.deepEqual(sequenceFindings([page([at(0, 100)])], true), []);
  // And a page of bullets alongside a page that does have text: the page
  // with nothing readable is skipped, the document is still judged.
  assert.deepEqual(sequenceFindings([page([at(0, 500, '•')], 1), page(lines([100, 200, 300]), 2)], true), []);
});

/**
 * The case the naive version gets wrong. A correct two-column page reads
 * left column top to bottom, then right column — which looks like a pile
 * of inversions to anything sorting by vertical position.
 */
test('a two-column page is handed to a person rather than failed', () => {
  const left = [0, 1, 2, 3].map((i) => at(i, 100 + i * 50, `Left ${i}`, 60, 440));
  const right = [4, 5, 6, 7].map((i) => at(i, 100 + (i - 4) * 50, `Right ${i}`, 560, 940));
  const [found, ...rest] = sequenceFindings([page([...left, ...right])], true);
  assert.equal(rest.length, 0);
  assert.match(found!.description, /laid out in 2 columns/);
  assert.match(found!.description, /judgement about the/);
  assert.match(found!.description, /by a person/);
});

test('a narrow gap is a ragged margin, not a gutter', () => {
  const narrow = GUTTER * WIDTH - 1;
  const blocks = [
    ...[0, 1, 2].map((i) => at(i, 100 + i * 50, `A${i}`, 100, 400)),
    ...[3, 4, 5].map((i) => at(i, 100 + (i - 3) * 50, `B${i}`, 400 + narrow, 900)),
  ];
  assert.equal(countColumns(blocks, WIDTH), 1);
});

test('a pull quote beside a paragraph is not a column', () => {
  const body = [0, 1, 2, 3, 4].map((i) => at(i, 100 + i * 50, `Body ${i}`, 60, 400));
  const quote = [at(5, 200, 'A pull quote', 600, 940)];
  assert.equal(quote.length < COLUMN_BLOCKS, true, 'fewer blocks than a column needs');
  assert.equal(countColumns([...body, ...quote], WIDTH), 1);
});

// ── The two ways this refuses to claim a pass ──────────────────────────

test('an untagged PDF has no reading order at all, and says so', () => {
  const [found, ...rest] = sequenceFindings([], false);
  assert.equal(rest.length, 0);
  assert.equal(found?.severity, 'blocking');
  assert.equal(found?.location, 'whole document');
  assert.match(found!.description, /not tagged/);
});

/**
 * The hole this closes: a tagged document whose tags could not be matched
 * to anything on the page would otherwise pass for want of evidence,
 * which is the one way this check could claim something it never tested.
 */
test('a tagged document with nothing to compare is escalated, not passed', () => {
  for (const pages of [[], [page([])], [page([at(0, 100, '.')])]]) {
    const [found] = sequenceFindings(pages, true);
    assert.ok(found, 'not a silent pass');
    assert.match(found!.description, /none of its tags could be matched/);
    assert.match(found!.description, /by a person/);
  }
});
