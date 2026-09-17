import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contrastRatio, formatRatio, isLargeText, minimumRatio, parseHex, relativeLuminance } from '../src/domain/contrast';

test('parses the hex forms Word and CSS write', () => {
  assert.deepEqual(parseHex('FF0000'), [255, 0, 0]);
  assert.deepEqual(parseHex('#ff0000'), [255, 0, 0]);
  assert.deepEqual(parseHex('f00'), [255, 0, 0]);
  assert.equal(parseHex('auto'), null);
  assert.equal(parseHex('#12345'), null);
});

test('the reference ratios from the WCAG definition', () => {
  // Black on white is the maximum, 21:1. #767676 on white is the well-known
  // grey that just passes 4.5:1, and #777777 the one that just fails. If
  // these move, the formula is wrong and every contrast finding with it.
  assert.equal(relativeLuminance([255, 255, 255]), 1);
  assert.equal(relativeLuminance([0, 0, 0]), 0);
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrastRatio([255, 255, 255], [0, 0, 0]), 21);
  assert.ok(contrastRatio(parseHex('767676')!, [255, 255, 255]) >= 4.5);
  assert.ok(contrastRatio(parseHex('777777')!, [255, 255, 255]) < 4.5);
});

test('large text is 18pt, or 14pt bold, and gets the 3:1 minimum', () => {
  assert.equal(isLargeText(18, false), true);
  assert.equal(isLargeText(17.5, false), false);
  assert.equal(isLargeText(14, true), true);
  assert.equal(isLargeText(14, false), false);
  assert.equal(minimumRatio(true), 3);
  assert.equal(minimumRatio(false), 4.5);
});

test('ratios are quoted floored to two places, never rounded up past a threshold', () => {
  // 4.499 must read as 4.49:1, not 4.5:1 – a report that rounded a failure
  // into a pass would be the worst kind of wrong.
  assert.equal(formatRatio(4.499), '4.49:1');
  assert.equal(formatRatio(21), '21:1');
  assert.equal(formatRatio(4.5), '4.5:1');
});
