import { test } from 'node:test';
import assert from 'node:assert/strict';

import { colourOnlyFindings, proseFindings } from '../src/domain/pdfSignals';
import type { PaintedRun, TextBlock } from '../src/domain/pdfPainted';

const block = (text: string, page = 2): TextBlock => ({ page, text });

test('an instruction that names a position is flagged, with the sentence and the phrase', () => {
  const [found, ...rest] = proseFindings([block('Complete the form. Use the button on the right to continue.')]);
  assert.equal(rest.length, 0);
  assert.equal(found?.criterion, '1.3.3');
  assert.equal(found?.location, 'page 2');
  assert.match(found!.description, /on the right/);
  assert.match(found!.description, /a position on the page/);
  assert.match(found!.description, /cannot see the page/);
});

test('an instruction that names a colour is flagged against 1.4.1', () => {
  const [found] = proseFindings([block('Sign the form. Fields marked in red are required.')]);
  assert.equal(found?.criterion, '1.4.1');
  assert.match(found!.description, /screen reader does not announce/);
});

/**
 * The line `phrases.ts` draws, and the reason this is not noise: a
 * description of the world is not an instruction to the reader.
 */
test('describing a colour is not the same as instructing by it', () => {
  assert.deepEqual(proseFindings([block('The building has a green roof and two red doors.')]), []);
  assert.deepEqual(proseFindings([block('Our logo is blue.')]), []);
});

test('the same sentence on the same page is reported once', () => {
  const twice = 'Press the button on the left. Press the button on the left.';
  assert.equal(proseFindings([block(twice)]).length, 1);
  // A different page is a different place to look.
  assert.equal(proseFindings([block(twice, 1), block(twice, 4)]).length, 2);
});

// ── 1.4.1, colour used as emphasis inside a line ───────────────────────

const run = (over: Partial<PaintedRun> = {}): PaintedRun => ({
  page: 1,
  text: 'ordinary words',
  points: 11,
  bold: false,
  foreground: [0, 0, 0],
  background: [255, 255, 255],
  backgroundShare: 0.9,
  top: 100,
  bottom: 120,
  left: 100,
  right: 300,
  ...over,
});

const RED = [0xcc, 0x00, 0x00] as const;

/** Runs sharing a line: same vertical span, different columns of it. */
const line = (...runs: Array<Partial<PaintedRun>>): PaintedRun[] =>
  runs.map((over, i) => run({ left: 100 + i * 200, right: 290 + i * 200, ...over }));

test('a word coloured differently from its own line, at the same size, is flagged', () => {
  const [found, ...rest] = colourOnlyFindings(line({}, { text: 'required', foreground: RED }, {}));
  assert.equal(rest.length, 0);
  assert.equal(found?.criterion, '1.4.1');
  assert.equal(found?.location, 'page 1');
  assert.match(found!.description, /required/);
  assert.match(found!.description, /colour alone/);
});

/**
 * Everything below must NOT fire. A designed PDF is full of brand colour,
 * and flagging all of it would bury the reviewer — which is the failure
 * this file is written to avoid, not an edge case of it.
 */
test('a coloured heading is not emphasis: it is set apart by being a heading', () => {
  assert.deepEqual(colourOnlyFindings(line({ text: 'A Heading', foreground: RED, points: 24 }, {})), []);
});

test('colour with bold to carry it is not colour alone', () => {
  assert.deepEqual(colourOnlyFindings(line({}, { text: 'required', foreground: RED, bold: true }, {})), []);
});

test('a line set entirely in one colour is just a line', () => {
  assert.deepEqual(colourOnlyFindings(line({ foreground: RED }, { foreground: RED }, { foreground: RED })), []);
});

test('two colours that are nearly the same ink are the same ink', () => {
  const almost = [4, 4, 4] as const;
  assert.deepEqual(colourOnlyFindings(line({}, { text: 'not really coloured', foreground: almost }, {})), []);
});

test('a coloured run on its own line is not emphasis within a line', () => {
  const alone = [run({ text: 'A callout', foreground: RED, top: 400, bottom: 420 })];
  assert.deepEqual(colourOnlyFindings([...line({}, {}), ...alone]), []);
});

test('one finding per page per colour, however many words carry it', () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    run({ text: `red${i}`, foreground: RED, top: 100 + i * 30, bottom: 120 + i * 30, left: 300, right: 400 }),
  );
  const plain = Array.from({ length: 20 }, (_, i) =>
    run({ text: `plain${i}`, top: 100 + i * 30, bottom: 120 + i * 30, left: 100, right: 290 }),
  );
  assert.equal(colourOnlyFindings([...plain, ...many]).length, 1);

  // A second colour is a second habit, and its own row.
  const blue = run({ text: 'blue word', foreground: [0, 0, 0xcc], top: 100, bottom: 120, left: 420, right: 500 });
  assert.equal(colourOnlyFindings([...plain, ...many, blue]).length, 2);
});

test('punctuation and fragments are not words', () => {
  assert.deepEqual(colourOnlyFindings(line({}, { text: '—', foreground: RED }, {})), []);
});
