/**
 * WCAG 2.0 contrast, as defined in the standard's glossary. Used twice: by
 * the Word detector for coloured runs (1.4.3), and by a test that checks the
 * site's own colour tokens against the ratios written beside them, so the
 * comment in `globals.css` cannot quietly stop being true.
 */

export type Rgb = readonly [number, number, number];

/** "FF0000", "#ff0000" or "f00". Word writes six hex digits with no hash. */
export function parseHex(hex: string): Rgb | null {
  const s = hex.trim().replace(/^#/, '');
  const six = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(six)) return null;
  return [parseInt(six.slice(0, 2), 16), parseInt(six.slice(2, 4), 16), parseInt(six.slice(4, 6), 16)];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Always ≥ 1; order of the two colours does not matter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * 1.4.3 Contrast (Minimum): 4.5:1, or 3:1 for large text. Large is at least
 * 18 point, or at least 14 point bold – the standard's own definition, in
 * points because that is what Word measures in.
 */
export function isLargeText(points: number, bold: boolean): boolean {
  return points >= 18 || (bold && points >= 14);
}

export function minimumRatio(large: boolean): number {
  return large ? 3 : 4.5;
}

/** One decimal, the way ratios are quoted in reports: "4.5:1". */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2).replace(/\.?0+$/, '')}:1`;
}
