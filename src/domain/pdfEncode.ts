/**
 * Text to the bytes a PDF string holds, in WinAnsi.
 *
 * The exported PDF sets its text in the four standard Helvetica faces, which
 * every reader in the world already has. That is a deliberate trade: no font
 * is embedded, so the file is small and needs nothing installed — and the
 * price is that the text has to fit one 256-character encoding.
 *
 * WinAnsiEncoding is that encoding, and it is Windows code page 1252 with two
 * corrections from the PDF specification's own table: `0xA0` is a space rather
 * than a no-break space, and `0xAD` is an ordinary hyphen rather than a soft
 * one. Both are written here the way the specification defines them, because a
 * reader following the specification is the only thing this file can rely on.
 *
 * **A character this cannot encode is refused, not replaced.** Silently
 * turning a customer's text into something else is the worst outcome available
 * to a remediation service: it would be undetectable in the delivered file and
 * it would be a lie about what the document says. So `encodeWinAnsi` returns
 * the characters it could not set, and the export refuses the document and
 * says which they were.
 *
 * `FOLD` is the exception, and it is narrow on purpose: every entry is a
 * character that has an exact typographic equivalent in the encoding — a
 * differently-measured space is still a space, a non-breaking hyphen is still
 * a hyphen, a ligature is the letters it joins. Nothing that changes what a
 * sentence says is in that table, which is why an arrow is not in it.
 */

/** The 0x80–0x9F block, which is where WinAnsi stops being Latin-1. */
const HIGH: Record<number, number> = {
  0x20ac: 0x80, // euro
  0x201a: 0x82, // single low-9 quotation mark
  0x0192: 0x83, // florin
  0x201e: 0x84, // double low-9 quotation mark
  0x2026: 0x85, // ellipsis
  0x2020: 0x86, // dagger
  0x2021: 0x87, // double dagger
  0x02c6: 0x88, // circumflex
  0x2030: 0x89, // per mille
  0x0160: 0x8a, // S caron
  0x2039: 0x8b, // single left angle quote
  0x0152: 0x8c, // OE
  0x017d: 0x8e, // Z caron
  0x2018: 0x91, // left single quote
  0x2019: 0x92, // right single quote
  0x201c: 0x93, // left double quote
  0x201d: 0x94, // right double quote
  0x2022: 0x95, // bullet
  0x2013: 0x96, // en dash
  0x2014: 0x97, // em dash
  0x02dc: 0x98, // small tilde
  0x2122: 0x99, // trade mark
  0x0161: 0x9a, // s caron
  0x203a: 0x9b, // single right angle quote
  0x0153: 0x9c, // oe
  0x017e: 0x9e, // z caron
  0x0178: 0x9f, // Y diaeresis
};

/**
 * Characters with an exact equivalent in the encoding. Each is a different
 * *measure* of something WinAnsi has, never a different meaning.
 */
const FOLD: Record<string, string> = {
  ' ': ' ', // no-break space
  ' ': ' ', // en space
  ' ': ' ', // em space
  ' ': ' ', // figure space
  ' ': ' ', // punctuation space
  ' ': ' ', // thin space
  ' ': ' ', // hair space
  ' ': ' ', // narrow no-break space
  ' ': ' ', // medium mathematical space
  '　': ' ', // ideographic space
  '​': '', // zero-width space
  '‌': '', // zero-width non-joiner
  '‍': '', // zero-width joiner
  '﻿': '', // byte order mark
  '­': '-', // soft hyphen
  '‐': '-', // hyphen
  '‑': '-', // non-breaking hyphen
  '−': '-', // minus sign
  '⁃': '-', // hyphen bullet
  'ʹ': "'", // modifier letter prime
  'ʼ': "'", // modifier letter apostrophe
  '′': "'", // prime
  '″': '"', // double prime
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  ' ': ' ', // line separator
  ' ': ' ', // paragraph separator
};

/** The byte for one character, or null when WinAnsi has no such character. */
export function winAnsiByte(ch: string): number | null {
  const code = ch.codePointAt(0);
  if (code === undefined) return null;
  if (code === 0x20 || (code >= 0x21 && code <= 0x7e)) return code;
  // The specification puts an ordinary hyphen at 0xAD, where Latin-1 has a
  // soft one. Both are the same glyph, and one hyphen byte in the file is
  // better than two: `FOLD` sends it to 0x2D and so does this, so nothing
  // ever writes a byte whose width nobody measured.
  if (code === 0x00ad) return 0x2d;
  if (code >= 0xa1 && code <= 0xff) return code;
  return HIGH[code] ?? null;
}

/** Everything `FOLD` can simplify, applied first so the rest is a fair test. */
export function foldToWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) out += FOLD[ch] ?? ch;
  return out;
}

export interface Encoded {
  bytes: Uint8Array;
  /** The distinct characters that had no place in the encoding, in order. */
  missing: string[];
}

/**
 * The bytes for a run of text, and what could not be set.
 *
 * A caller that cannot tolerate a missing character checks `missing` and
 * refuses; the bytes are still returned with those characters left out, so a
 * caller measuring a line does not have to handle two shapes of answer.
 */
export function encodeWinAnsi(text: string): Encoded {
  const bytes: number[] = [];
  const missing: string[] = [];
  for (const ch of foldToWinAnsi(text)) {
    const byte = winAnsiByte(ch);
    if (byte === null) {
      if (!missing.includes(ch)) missing.push(ch);
      continue;
    }
    bytes.push(byte);
  }
  return { bytes: Uint8Array.from(bytes), missing };
}
