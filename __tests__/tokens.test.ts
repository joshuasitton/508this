import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { contrastRatio, parseHex } from '../src/domain/contrast';

/**
 * The site must pass what it sells. globals.css annotates each text colour
 * with its contrast ratio; this test recomputes them so the annotation and
 * the invariant cannot quietly stop being true.
 */
const css = readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,6})/g)) out[m[1]!] = m[2]!;
  return out;
}

const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
const schemes = { light: tokens(light!), dark: tokens(dark!) };

for (const [name, t] of Object.entries(schemes)) {
  test(`${name} scheme: foreground, muted and accent all reach 4.5:1 on the background`, () => {
    const bg = parseHex(t['background']!)!;
    for (const key of ['foreground', 'muted', 'accent']) {
      const ratio = contrastRatio(parseHex(t[key]!)!, bg);
      assert.ok(ratio >= 4.5, `${name} --${key} ${t[key]} on ${t['background']} is ${ratio.toFixed(2)}:1`);
    }
  });
}

test('the ratios written in the CSS comments are the real ones, to one decimal', () => {
  for (const [name, block] of [['light', light!], ['dark', dark!]] as const) {
    const bg = parseHex(tokens(block)['background']!)!;
    for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6});\s*\/\*\s*([\d.]+):1/g)) {
      const actual = contrastRatio(parseHex(m[2]!)!, bg);
      assert.equal(actual.toFixed(1), Number(m[3]).toFixed(1), `${name} --${m[1]} comment says ${m[3]}:1, is ${actual.toFixed(2)}:1`);
    }
  }
});
