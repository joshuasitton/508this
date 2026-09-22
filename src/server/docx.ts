/**
 * From bytes to the XML parts the detector reads. The one place a .docx is
 * opened; nothing here looks at the content beyond finding the parts.
 */

import type { DocxParts } from '@/domain/docx';
import { unzip, ZipError } from './unzip';
import { zip } from './zip';

export class NotADocxError extends Error {}

const DOCUMENT = 'word/document.xml';
const OPTIONAL: Array<[keyof Omit<DocxParts, 'document'>, string]> = [
  ['styles', 'word/styles.xml'],
  ['settings', 'word/settings.xml'],
  ['core', 'docProps/core.xml'],
  ['contentTypes', '[Content_Types].xml'],
  ['rels', '_rels/.rels'],
  ['documentRels', 'word/_rels/document.xml.rels'],
];
const PATHS: Record<keyof DocxParts, string> = {
  document: DOCUMENT,
  styles: 'word/styles.xml',
  settings: 'word/settings.xml',
  core: 'docProps/core.xml',
  contentTypes: '[Content_Types].xml',
  rels: '_rels/.rels',
  documentRels: 'word/_rels/document.xml.rels',
};

export function readDocxParts(bytes: Uint8Array): DocxParts {
  return partsOf(readEntries(bytes));
}

function readEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  try {
    return unzip(bytes);
  } catch (error) {
    if (error instanceof ZipError) throw new NotADocxError(error.message);
    throw error;
  }
}

function partsOf(entries: Map<string, Uint8Array>): DocxParts {
  const document = entries.get(DOCUMENT);
  if (!document) throw new NotADocxError(`No ${DOCUMENT} part; this is a zip but not a Word document`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: DocxParts = { document: decoder.decode(document) };
  for (const [key, path] of OPTIONAL) {
    const bytes = entries.get(path);
    if (bytes) parts[key] = decoder.decode(bytes);
  }
  return parts;
}

/**
 * The bytes of one part of the archive – a picture, for the drafting path.
 * Returns null rather than throwing for a part that is not there, because a
 * document can name a relationship whose target was never packed.
 */
export function readDocxPart(original: Uint8Array, part: string): Uint8Array | null {
  return readEntries(original).get(part) ?? null;
}

/**
 * The original archive with the changed parts written over it. Everything
 * remediation did not touch – images, fonts, numbering, comments – is
 * carried across byte for byte, so the output is the customer's document
 * and not a reconstruction of it.
 */
export function writeDocx(original: Uint8Array, parts: DocxParts): Uint8Array {
  const entries = readEntries(original);
  const enc = new TextEncoder();
  for (const [key, path] of Object.entries(PATHS) as [keyof DocxParts, string][]) {
    const value = parts[key];
    if (value !== undefined) entries.set(path, enc.encode(value));
  }
  return zip(entries);
}
