import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALT_INSTRUCTION,
  MAX_ALT,
  describeNoImage,
  isRefusal,
  isSendable,
  normaliseDraft,
  type NoImage,
} from '../src/domain/alt';

test('the opener that describes the medium is stripped', () => {
  // A screen reader has already said "image". "Image of a bar chart" is
  // announced as "image, image of a bar chart", and it is the single most
  // common fault in alternative text - which makes it the one a model is
  // most likely to hand back.
  for (const opener of [
    'Image of a bar chart showing enrolment rising.',
    'A picture of a bar chart showing enrolment rising.',
    'This graphic shows a bar chart showing enrolment rising.',
    'Screenshot depicting a bar chart showing enrolment rising.',
  ]) {
    assert.equal(normaliseDraft(opener).text, 'A bar chart showing enrolment rising.', opener);
  }
});

test('a description that does not begin with the medium is left alone', () => {
  const text = 'Enrolment at the Philadelphia site rose from 1,200 in 2019 to 3,400 in 2025.';
  assert.deepEqual(normaliseDraft(text), { text, refused: false });
});

test('a word that names what the thing IS survives, because that is content', () => {
  // "Chart", "diagram", "map" and "logo" are not the medium. A reader is
  // better served by "Bar chart of enrolment by year" than by "Enrolment by
  // year": the shape of the data is part of the information. Stripping
  // these was the first version of this function and it made good
  // descriptions worse.
  for (const text of [
    'A chart of enrolment over time.',
    'Bar chart showing enrolment by year.',
    'Diagram of the referral pathway.',
    'The logo of the Philadelphia CHERP centre.',
  ]) {
    assert.equal(normaliseDraft(text).text, text, text);
  }
});

test('quotation marks a model wraps its answer in are not part of the description', () => {
  // They would be read out, and a reviewer pasting them into a document
  // would not notice until somebody heard it.
  assert.equal(normaliseDraft('"Enrolment rose steadily."').text, 'Enrolment rose steadily.');
  assert.equal(normaliseDraft('“Enrolment rose steadily.”').text, 'Enrolment rose steadily.');
});

test('a refusal is reported as one rather than shown as a description', () => {
  assert.equal(isRefusal('CANNOT DESCRIBE'), true);
  assert.equal(isRefusal(' cannot describe '), true);
  assert.equal(isRefusal('A chart of enrolment.'), false);
  for (const shrug of ["I can't tell what this shows.", 'Sorry, the image is unclear.', 'As an AI, I cannot see.']) {
    assert.deepEqual(normaliseDraft(shrug), { text: '', refused: true }, shrug);
  }
  assert.deepEqual(normaliseDraft('   '), { text: '', refused: true });
});

test('a long draft is cut at a sentence rather than mid-clause', () => {
  const long = `${'Enrolment rose steadily across every site in the region. '.repeat(6)}`;
  const draft = normaliseDraft(long);
  assert.ok(draft.text.length <= MAX_ALT);
  assert.ok(draft.text.endsWith('.'), `cut mid-clause: ${JSON.stringify(draft.text.slice(-40))}`);
  assert.equal(draft.refused, false);
});

test('a long draft with no sentence end is still cut on a word boundary', () => {
  const draft = normaliseDraft('word '.repeat(120));
  assert.ok(draft.text.length <= MAX_ALT);
  assert.ok(!draft.text.endsWith('wor'), 'cut mid-word');
});

test('control characters and runs of whitespace do not survive', () => {
  const messy = `A chart\u0007 of\n\n  enrolment\tover time.`;
  assert.equal(normaliseDraft(messy).text, 'A chart of enrolment over time.');
});

test('the instruction tells the model what not to do, and how to decline', () => {
  // The refusal sentinel and the instruction have to agree, or a decline
  // arrives as a confident description of nothing.
  assert.ok(ALT_INSTRUCTION.includes('CANNOT DESCRIBE'));
  assert.equal(isRefusal('CANNOT DESCRIBE'), true);
  assert.match(ALT_INSTRUCTION, /Do not begin with "Image of"/);
  assert.ok(ALT_INSTRUCTION.includes(String(MAX_ALT)));
});

test('only media types a vision model accepts are sendable', () => {
  for (const good of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) assert.equal(isSendable(good), true, good);
  // Word embeds these happily and neither can be sent.
  for (const bad of ['image/x-emf', 'image/tiff', 'application/pdf', '']) assert.equal(isSendable(bad), false, bad);
});

test('every reason a figure has no image has a sentence that tells the reviewer what to do', () => {
  const reasons: NoImage[] = ['vector', 'not-found', 'unsupported-filter', 'unsupported-colour', 'too-large', 'no-anchor'];
  for (const reason of reasons) {
    const sentence = describeNoImage(reason);
    assert.ok(sentence.length > 30, reason);
    assert.match(sentence, /Describe it yourself\.$/, reason);
  }
  // The commonest one names the cause, because it is the one that will not
  // be fixed by trying again.
  assert.match(describeNoImage('vector'), /vector artwork/);
});
