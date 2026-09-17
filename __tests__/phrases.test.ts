import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findColourWords, findSensory, sentences } from '../src/domain/phrases';

test('an instruction that depends on position, shape, size or sound is found, with the phrase', () => {
  const hits = findSensory(
    'To continue, click the button on the left. Select the round icon in the upper right corner. Press the large button to start. Wait until you hear the tone, then speak.',
  );
  assert.deepEqual(
    hits.map((h) => [h.kind, h.phrase]),
    [
      ['position', 'on the left'],
      ['position', 'in the upper right corner'],
      ['shape', 'round icon'],
      ['size', 'the large button'],
      ['sound', 'until you hear the'],
    ],
  );
});

test('description is not instruction, and "above" and "below" are reading order, not position', () => {
  // WCAG's own guidance: "see the section below" refers to the sequence of
  // the content and is acceptable. Nearly every long document says it.
  assert.deepEqual(findSensory('The chapel stands on the left of the plaza, facing the river.'), []);
  assert.deepEqual(findSensory('See the table below for the full list, and refer to the notes above it.'), []);
  assert.deepEqual(findSensory('The left column of Table 3 shows the prior year.'), [], 'a column of a table is named, not located');
});

test('colour as the signal is found with or without an instruction verb', () => {
  const hits = findColourWords(
    'Required fields are marked in red. Figures shown in green are final. The blue links open in a new window. Status is indicated by colour. Green, amber or red indicates the risk level. Status is shown as green, amber or red in the tracker.',
  );
  assert.deepEqual(
    hits.map((h) => h.phrase),
    ['marked in red', 'shown in green', 'The blue links', 'indicated by colour', 'Green, amber or red', 'shown as green'],
  );
});

test('a colour word that is not a signal stays quiet', () => {
  assert.deepEqual(findColourWords('The Red Cross and the Green Party attended. Paint the fence white.'), []);
  assert.deepEqual(findColourWords('Blackwater and Greenville reported on time.'), []);
  assert.deepEqual(findColourWords('The flag is red, white and blue.'), [], 'a list of colours with nothing they mean');
});

test('sentences split on terminal punctuation followed by a capital', () => {
  assert.deepEqual(sentences('One. Two! Three? four. “Five.”'), ['One.', 'Two!', 'Three? four.', '“Five.”']);
  assert.deepEqual(sentences('Version 2.1 is out. Use it.'), ['Version 2.1 is out.', 'Use it.']);
});
