import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeWinAnsi, foldToWinAnsi, winAnsiByte } from '../src/domain/pdfEncode';
import { FONT_WIDTHS } from '../src/domain/pdfFontWidths';
import { widthOf } from '../src/domain/pdfBuild';

/**
 * `npm run widths` derives these numbers from the standard-14 metrics pdf.js
 * carries. Deriving them is what stops a typo, and this is what stops the
 * derivation reading the wrong table: every value below is from Adobe's
 * published Helvetica metrics, which have not changed since 1985 and will not.
 *
 * A wrong width is not a crash. It is a line that overruns the margin on page
 * nine of a customer's document, which is why it is worth a test.
 */
const PUBLISHED: Array<[string, number, number]> = [
  // character, Helvetica, Helvetica-Bold
  [' ', 278, 278],
  ['A', 667, 722],
  ['M', 833, 833],
  ['W', 944, 944],
  ['i', 222, 278],
  ['l', 222, 278],
  ['m', 833, 889],
  ['0', 556, 556],
  ['.', 278, 278],
  ['—', 1000, 1000], // em dash
  ['é', 556, 556],
  ['©', 737, 737],
];

test('the widths are the published standard-14 metrics', () => {
  for (const [ch, regular, bold] of PUBLISHED) {
    const byte = winAnsiByte(ch);
    assert.ok(byte !== null, `WinAnsi has no ${ch}`);
    assert.equal(FONT_WIDTHS.Helvetica[byte], regular, `Helvetica ${ch}`);
    assert.equal(FONT_WIDTHS['Helvetica-Bold'][byte], bold, `Helvetica-Bold ${ch}`);
  }
});

/* An oblique face is the upright one, slanted; the advances are identical. */
test('the oblique faces advance like the upright ones', () => {
  assert.deepEqual(FONT_WIDTHS['Helvetica-Oblique'], FONT_WIDTHS.Helvetica);
  assert.deepEqual(FONT_WIDTHS['Helvetica-BoldOblique'], FONT_WIDTHS['Helvetica-Bold']);
});

/**
 * Every character the encoder can produce has to have a width, or a line of
 * text measures short and runs off the page. This is the check that would have
 * caught a regenerate that silently lost the upper half of the table.
 */
test('every byte the encoder produces has a width', () => {
  for (let code = 0x20; code <= 0xff; code += 1) {
    const ch = String.fromCharCode(code);
    const byte = winAnsiByte(ch);
    if (byte === null) continue;
    for (const face of Object.keys(FONT_WIDTHS) as Array<keyof typeof FONT_WIDTHS>) {
      assert.ok((FONT_WIDTHS[face][byte] ?? 0) > 0, `${face} has no width for 0x${code.toString(16)}`);
    }
  }
  for (const ch of '‘’“”•–—€™…†‡ŠŒŽšœžŸƒ‰') {
    const byte = winAnsiByte(ch);
    assert.ok(byte !== null, `the encoder cannot set ${ch}`);
    assert.ok((FONT_WIDTHS.Helvetica[byte] ?? 0) > 0, `no width for ${ch}`);
  }
});

test('measuring is millesimal arithmetic on those widths', () => {
  // "AWA" in 12pt Helvetica: (667 + 944 + 667) / 1000 × 12.
  assert.equal(widthOf('AWA', 'Helvetica', 12), ((667 + 944 + 667) * 12) / 1000);
  assert.equal(widthOf('', 'Helvetica', 12), 0);
});

/**
 * The folding table exists so a real document's punctuation does not refuse the
 * export. It may only ever contain characters with an exact equivalent, so this
 * pins the two properties that make that true: what comes out is encodable, and
 * what goes in is not silently turned into something that says anything else.
 */
test('folding only simplifies what has an exact equivalent', () => {
  assert.equal(foldToWinAnsi('a b'), 'a b'); // no-break space
  assert.equal(foldToWinAnsi('re‑entry'), 're-entry'); // non-breaking hyphen
  assert.equal(foldToWinAnsi('ﬁn'), 'fin'); // ligature
  assert.equal(foldToWinAnsi('zero​width'), 'zerowidth');
  // An arrow means something no WinAnsi character means, so it is not folded —
  // it refuses instead, and the reviewer is told which character did it.
  assert.equal(foldToWinAnsi('a → b'), 'a → b');
  assert.deepEqual(encodeWinAnsi('a → b').missing, ['→']);
});
