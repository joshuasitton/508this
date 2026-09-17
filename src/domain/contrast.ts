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

/**
 * The nearest colour to `fg` that meets the minimum against `bg`, found by
 * mixing `fg` toward black on a light background or toward white on a dark
 * one until the ratio is reached. A bisection, because the ratio is
 * monotonic along that line, and the smallest change that passes is the one
 * that best keeps the design. Returns `fg` unchanged if it already passes.
 */
export function adjustForContrast(fg: Rgb, bg: Rgb, minimum: number): Rgb {
  if (contrastRatio(fg, bg) >= minimum) return fg;
  const target: Rgb = relativeLuminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  const mix = (t: number): Rgb => [
    Math.round(fg[0] + (target[0] - fg[0]) * t),
    Math.round(fg[1] + (target[1] - fg[1]) * t),
    Math.round(fg[2] + (target[2] - fg[2]) * t),
  ];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mix(mid), bg) >= minimum) hi = mid;
    else lo = mid;
  }
  const result = mix(hi);
  // Rounding can land a hair under; nudge along the line until it passes.
  let t = hi;
  let out = result;
  while (contrastRatio(out, bg) < minimum && t < 1) {
    t = Math.min(1, t + 1 / 255);
    out = mix(t);
  }
  return out;
}

export function toHex([r, g, b]: Rgb): string {
  return [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}
