import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { contrastRatio, parseHex } from '../src/domain/contrast';

/**
 * The site must pass what it sells.
 *
 * `globals.css` annotates every colour token with what it is for: a text
 * colour names the surface it sits on and the ratio it reaches there, a
 * surface says so, and a colour that only draws a boundary says that with the
 * ratio it manages. This test recomputes each of those with the same code the
 * Word and PDF detectors use, and refuses a token that carries no annotation
 * at all.
 *
 * The refusal is the useful half. A ratio written by hand goes stale the
 * moment someone nudges a hex value; an unannotated token is how a colour
 * gets into the product having never been measured once.
 */
const css = readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');

interface Token {
  readonly name: string;
  readonly hex: string;
  /** Everything after the `;`, to the end of that line. */
  readonly note: string;
}

/**
 * The `:root` blocks, by scheme. Split on the brace rather than on the media
 * query, so a later `@media` — reduced motion, a breakpoint — cannot be
 * mistaken for another palette.
 */
function scheme(which: 'light' | 'dark'): Token[] {
  const roots = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]!);
  const block = which === 'light' ? roots[0] : roots[1];
  assert.ok(block, `no ${which} :root block in globals.css`);
  const out: Token[] = [];
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;([^\n]*)/g)) {
    out.push({ name: m[1]!, hex: m[2]!, note: m[3]!.trim() });
  }
  return out;
}

const schemes = { light: scheme('light'), dark: scheme('dark') };

/** "6.4:1 on --background", or "boundary 3.1:1 on --background". */
const MEASURED = /(?:(boundary)\s+)?([\d.]+):1\s+on\s+--([a-z0-9-]+)/;

for (const [which, tokens] of Object.entries(schemes)) {
  const find = (name: string) => tokens.find((t) => t.name === name);

  test(`${which}: every colour token says what it is for`, () => {
    for (const token of tokens) {
      const annotated = /\/\*\s*(surface|boundary\s|[\d.]+:1\s)/.test(token.note);
      assert.ok(
        annotated,
        `--${token.name}: ${token.hex} carries no annotation. Say "surface", "N:1 on --token", or "boundary N:1 on --token".`,
      );
    }
  });

  test(`${which}: the ratio written beside each token is the ratio it has`, () => {
    for (const token of tokens) {
      const said = MEASURED.exec(token.note);
      if (!said) continue;
      const against = find(said[3]!);
      assert.ok(against, `--${token.name} is measured against --${said[3]}, which this scheme does not define`);
      const actual = contrastRatio(parseHex(token.hex)!, parseHex(against.hex)!);
      assert.equal(
        actual.toFixed(1),
        Number(said[2]).toFixed(1),
        `--${token.name} ${token.hex} on --${said[3]} ${against.hex} says ${said[2]}:1, is ${actual.toFixed(2)}:1`,
      );
    }
  });

  test(`${which}: text tokens reach 4.5:1 and boundaries reach 3:1`, () => {
    for (const token of tokens) {
      const said = MEASURED.exec(token.note);
      if (!said) continue;
      // A hairline between table rows is decoration, and exempt from both: it
      // carries nothing a reader could miss by not seeing it.
      if (token.name === 'rule') continue;
      const floor = said[1] ? 3 : 4.5;
      const actual = contrastRatio(parseHex(token.hex)!, parseHex(find(said[3]!)!.hex)!);
      assert.ok(actual >= floor, `--${token.name} is ${actual.toFixed(2)}:1 on --${said[3]}, and needs ${floor}:1`);
    }
  });

  /*
   * The annotation names one surface, but these inks are used on all of them:
   * a badge sits on a card, a card sits on the page, a well is cut into the
   * card. Measuring only the stated pair would let an ink be legible on the
   * page and unreadable on the card it actually appears on.
   */
  test(`${which}: every ink is legible on every surface`, () => {
    const surfaces = tokens.filter((t) => /\/\*\s*surface/.test(t.note));
    assert.ok(surfaces.length >= 3, 'expected at least the page, the card and the well');
    for (const ink of ['foreground', 'muted', 'accent', 'accent-strong', 'pass', 'fail', 'wait', 'off']) {
      const token = find(ink);
      assert.ok(token, `the ${which} scheme has no --${ink}`);
      for (const surface of surfaces) {
        const ratio = contrastRatio(parseHex(token.hex)!, parseHex(surface.hex)!);
        assert.ok(ratio >= 4.5, `--${ink} on --${surface.name} is ${ratio.toFixed(2)}:1`);
      }
    }
  });

  /*
   * A status ink and its tint are a pair by name, and the pairing is what a
   * badge draws — the one combination guaranteed to appear on screen.
   */
  test(`${which}: each status ink is legible on its own tint`, () => {
    for (const status of ['pass', 'fail', 'wait', 'off']) {
      const ink = find(status);
      const tint = find(`${status}-tint`);
      assert.ok(ink && tint, `the ${which} scheme is missing --${status} or --${status}-tint`);
      const ratio = contrastRatio(parseHex(ink.hex)!, parseHex(tint.hex)!);
      assert.ok(ratio >= 4.5, `--${status} on --${status}-tint is ${ratio.toFixed(2)}:1`);
    }
  });

  /* A primary button paints its own background, so its label is measured
     against the accent and not against the page. */
  test(`${which}: a button label is legible on the button`, () => {
    for (const on of ['accent', 'accent-strong']) {
      const ratio = contrastRatio(parseHex(find('on-accent')!.hex)!, parseHex(find(on)!.hex)!);
      assert.ok(ratio >= 4.5, `--on-accent on --${on} is ${ratio.toFixed(2)}:1`);
    }
  });
}

/*
 * A colour defined in one scheme and forgotten in the other is the specific
 * bug that produces black text on a black card for the half of the audience
 * whose laptop is set to dark.
 */
test('every colour exists in both schemes', () => {
  const light = schemes.light.map((t) => t.name);
  const dark = schemes.dark.map((t) => t.name);
  for (const name of dark) assert.ok(light.includes(name), `--${name} is defined in dark but not in light`);
  for (const name of light) assert.ok(dark.includes(name), `--${name} is a colour in light that dark never redefines`);
});
