/**
 * The conformance report as a file. The domain writes the XML; this adds the
 * two things the domain may not have — a UTF-8 encoder and a zip — and hands
 * back a .docx.
 */

import type { Acr } from '@/domain/acr';
import { acrParts } from '@/domain/acrDocx';
import { zip } from './zip';

export function acrDocx(acr: Acr, now: string): Uint8Array {
  const enc = new TextEncoder();
  const entries = new Map<string, Uint8Array>();
  for (const [path, xml] of acrParts(acr, now)) entries.set(path, enc.encode(xml));
  return zip(entries);
}
