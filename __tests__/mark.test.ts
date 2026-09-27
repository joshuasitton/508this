import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DIGIT_ORIGINS, STROKE, TILE_RADIUS, VIEWBOX, digitsPath, markSvg } from '../src/domain/mark';
import { markPng } from '../src/server/markPng';

/**
 * The mark exists in three places and is defined in one. These tests are what
 * make that true rather than merely intended.
 *
 * `npm run mark` writes `src/app/icon.svg` and `src/server/markPng.ts` from
 * `src/domain/mark.ts`. Nothing forces anyone to run it, so the first test
 * re-derives the SVG and compares — a change to the geometry without a
 * regenerate fails here instead of shipping a favicon that disagrees with the
 * header.
 */
const root = process.cwd();

test('the committed favicon is the geometry, regenerated', () => {
  const committed = readFileSync(path.join(root, 'src/app/icon.svg'), 'utf8');
  assert.equal(
    committed.trim(),
    markSvg('#14457e', '#ffffff').trim(),
    'src/app/icon.svg is out of date — run `npm run mark`',
  );
});

/*
 * The raster cannot be re-derived here: rasterising it needs a canvas, and
 * nothing a test imports may take an npm dependency. What can be checked
 * without one is that the constant decodes to a PNG, which catches the two
 * ways it actually goes wrong — never generated, or generated empty.
 */
test('the mark ships as a raster for the conformance statement', () => {
  const png = markPng();
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'not a PNG');
  assert.ok(png.byteLength > 200, 'suspiciously small for artwork');
});

test('the digits sit inside the tile, with room for the stroke', () => {
  const numbers = digitsPath()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const margin = STROKE / 2;
  for (const n of numbers) {
    assert.ok(n >= -margin, `a coordinate at ${n} is off the left or top of the tile`);
    assert.ok(n <= VIEWBOX + margin, `a coordinate at ${n} is off the right or bottom of the tile`);
  }
});

test('the three digits are evenly spaced and share a baseline', () => {
  const [a, b, c] = DIGIT_ORIGINS;
  assert.ok(a && b && c);
  const first = Math.round((b[0] - a[0]) * 10);
  const second = Math.round((c[0] - b[0]) * 10);
  assert.equal(first, second, 'the gap between digits is uneven');
  assert.equal(a[1], b[1]);
  assert.equal(b[1], c[1]);
});

/*
 * The tile is a rounded square, not a circle and not a box. Both extremes
 * have been drawn by accident before by someone tuning one number.
 */
test('the tile stays a rounded square', () => {
  assert.ok(TILE_RADIUS > 0, 'a square tile');
  assert.ok(TILE_RADIUS < VIEWBOX / 2, 'a circle, not a tile');
});
