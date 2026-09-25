import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOLID_ENOUGH, contrastFindings, languageFindings, type PaintedRun, type TextBlock } from '../src/domain/pdfPainted';

const run = (over: Partial<PaintedRun> = {}): PaintedRun => ({
  page: 1,
  text: 'The quick brown fox jumps over the lazy dog.',
  points: 11,
  bold: false,
  foreground: [0, 0, 0],
  background: [255, 255, 255],
  backgroundShare: 0.9,
  top: 100,
  bottom: 120,
  left: 100,
  right: 500,
  ...over,
});

test('black on white passes and says nothing', () => {
  assert.deepEqual(contrastFindings([run()]), []);
});

test('grey on white fails, and the finding carries both colours and the ratio', () => {
  // #999999 on white is 2.84:1. Worth stating the number: #767171, which
  // looks like the same problem, is 4.80:1 and passes — the eye is a poor
  // judge of this and the arithmetic is the point.
  const [found, ...rest] = contrastFindings([run({ foreground: [0x99, 0x99, 0x99] })]);
  assert.equal(rest.length, 0);
  assert.equal(found?.criterion, '1.4.3');
  assert.equal(found?.location, 'page 1');
  assert.match(found!.description, /#999999/);
  assert.match(found!.description, /#FFFFFF/i);
  assert.match(found!.description, /2\.84:1/);
  assert.match(found!.description, /needs 4\.5:1/);
});

/** The negative control: a grey that is close to the line and clears it. */
test('a grey that passes is not reported', () => {
  assert.deepEqual(contrastFindings([run({ foreground: [0x76, 0x71, 0x71] })]), []);
});

/**
 * The large-text threshold is 3:1 rather than 4.5:1, and it is the one
 * place a wrong reading of the font would change a verdict. `contrast.ts`
 * owns the rule; this only checks the run's size reaches it.
 */
test('the same colour can pass at heading size and fail at body size', () => {
  const grey: Partial<PaintedRun> = { foreground: [0x80, 0x80, 0x80] };
  assert.equal(contrastFindings([run({ ...grey, points: 11 })]).length, 1);
  assert.equal(contrastFindings([run({ ...grey, points: 24 })]).length, 0);
});

/**
 * The invariant the whole file exists for: uncertainty is a finding, never
 * a silent pass. A statement that says Supports on a guess launders the
 * guess into a claim the customer sells onward.
 */
test('text that is not on one solid colour is reported rather than passed', () => {
  const overPhoto = run({ backgroundShare: SOLID_ENOUGH - 0.01 });
  const [found] = contrastFindings([overPhoto]);
  assert.ok(found, 'not silently passed');
  assert.match(found!.description, /could not be measured/);
  assert.match(found!.description, /judged by a person/);

  // Same for ink that could not be told from the paper at all.
  assert.equal(contrastFindings([run({ foreground: null })]).length, 1);
  assert.equal(contrastFindings([run({ background: null })]).length, 1);
});

/**
 * A document set in grey has one contrast problem, not four hundred. A
 * queue of four hundred identical rows is a queue nobody reads, and the
 * reviewer decides the colour once.
 */
test('one finding per page per colour pair, however many runs there are', () => {
  const grey = { foreground: [0x99, 0x99, 0x99] as const };
  const many = Array.from({ length: 50 }, (_, i) => run({ ...grey, text: `Paragraph ${i}` }));
  assert.equal(contrastFindings(many).length, 1);

  // A different page is a different place to look, so it is its own row.
  assert.equal(contrastFindings([...many, run({ ...grey, page: 4 })]).length, 2);

  // And a different colour pair on the same page is a different problem.
  assert.equal(contrastFindings([...many, run({ foreground: [0xcc, 0xcc, 0xcc] })]).length, 2);
});

/**
 * Both of these were found by running the thing on a real infographic
 * rather than by reasoning about it, and both would have made the feature
 * worse than not having it.
 */
test('punctuation and fragments are not text, and are not judged', () => {
  const faint = { foreground: [200, 200, 200] as const };
  for (const text of ['   ', '.', '•', '—', '·', '“', '1']) {
    assert.deepEqual(contrastFindings([run({ ...faint, text })]), [], `should ignore: ${JSON.stringify(text)}`);
  }
  // Two real characters is text, and is judged.
  assert.equal(contrastFindings([run({ ...faint, text: 'Hi' })]).length, 1);
  assert.equal(contrastFindings([run({ ...faint, text: '12' })]).length, 1);
});

// ── 3.1.2 ──────────────────────────────────────────────────────────────

const SPANISH =
  'La accesibilidad de los documentos es una obligación legal para las agencias federales de los Estados Unidos, ' +
  'y por eso cada documento publicado debe cumplir con las normas establecidas en la sección correspondiente.';

const block = (text: string, page = 2): TextBlock => ({ page, text });

test('a passage in another language the document never marks is a finding', () => {
  const [found, ...rest] = languageFindings([block(SPANISH)], 'en', []);
  assert.equal(rest.length, 0);
  assert.equal(found?.criterion, '3.1.2');
  assert.equal(found?.location, 'page 2');
  assert.match(found!.description, /Spanish/);
  assert.match(found!.description, /nothing in the document is marked/);
});

/**
 * If the document marks the language somewhere, a PDF does not say which
 * passage carries the mark without joining marked-content ids to the tag
 * tree. Saying so is worth more than guessing either way.
 */
test('when the document does mark that language, the finding says a person must attribute it', () => {
  const [found] = languageFindings([block(SPANISH)], 'en', ['es-ES']);
  assert.ok(found);
  assert.match(found!.description, /does not say which passage/);
  assert.match(found!.description, /a person has to confirm/);
});

/**
 * A catalogue's /Lang is usually a locale, and the detector answers in
 * primary subtags. Comparing them raw made every English paragraph in an
 * en-US document look foreign — which is what it did, on the first real
 * file it saw.
 */
test('the document’s language is compared as a language, not as a locale', () => {
  const english =
    'Accessibility of documents is a legal obligation for federal agencies of the United States, and every ' +
    'document published has to meet the standards set out in the relevant section of the law.';
  for (const tag of ['en', 'en-US', 'EN-gb', 'en_AU']) {
    assert.deepEqual(languageFindings([block(english)], tag, []), [], `${tag} is English`);
  }
  // And the passage in another language is still found, whatever the locale.
  assert.equal(languageFindings([block(SPANISH)], 'en-US', []).length, 1);
});

test('the document’s own language is not a foreign passage', () => {
  const english =
    'Accessibility of documents is a legal obligation for federal agencies of the United States, and every ' +
    'document published has to meet the standards set out in the relevant section of the law.';
  assert.deepEqual(languageFindings([block(english)], 'en', []), []);
});

test('a locale is the same language as its bare subtag', () => {
  assert.match(languageFindings([block(SPANISH)], 'en', ['es'])[0]!.description, /does not say which passage/);
  assert.match(languageFindings([block(SPANISH)], 'en', ['ES-mx'])[0]!.description, /does not say which passage/);
});

test('one finding per page per language, not one per paragraph', () => {
  const blocks = [block(SPANISH), block(SPANISH), block(SPANISH)];
  assert.equal(languageFindings(blocks, 'en', []).length, 1);
  assert.equal(languageFindings([...blocks, block(SPANISH, 9)], 'en', []).length, 2);
});

/**
 * A handful of loan words is not a passage in another language. The Word
 * path holds the same bar, in the same function.
 */
test('too little text to be sure produces nothing', () => {
  assert.deepEqual(languageFindings([block('Vive la différence')], 'en', []), []);
});
