/**
 * The conformance report as a file. The domain writes the XML; this adds the
 * three things the domain may not have — a UTF-8 encoder, a zip, and the
 * bytes of the mark — and hands back a .docx.
 *
 * The mark is added here rather than in the domain because it is the one part
 * of the package that is not text. `acrParts` stays a map of strings, which is
 * what lets the XML be asserted directly in tests.
 */

import type { Acr } from '@/domain/acr';
import { MARK_PART, acrParts } from '@/domain/acrDocx';
import { markPng } from './markPng';
import { zip } from './zip';

export function acrDocx(acr: Acr, now: string): Uint8Array {
  const enc = new TextEncoder();
  const entries = new Map<string, Uint8Array>();
  for (const [path, xml] of acrParts(acr, now)) entries.set(path, enc.encode(xml));
  entries.set(MARK_PART, markPng());
  return zip(entries);
}
