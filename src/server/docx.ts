/**
 * From bytes to the XML parts the detector reads. The one place a .docx is
 * opened; nothing here looks at the content beyond finding the parts.
 */

import type { DocxParts } from '@/domain/docx';
import { unzip, ZipError } from './unzip';

export class NotADocxError extends Error {}

const DOCUMENT = 'word/document.xml';
const OPTIONAL: Array<[keyof Omit<DocxParts, 'document'>, string]> = [
  ['styles', 'word/styles.xml'],
  ['settings', 'word/settings.xml'],
  ['core', 'docProps/core.xml'],
];

export function readDocxParts(bytes: Uint8Array): DocxParts {
  let entries: Map<string, Uint8Array>;
  try {
    entries = unzip(bytes);
  } catch (error) {
    if (error instanceof ZipError) throw new NotADocxError(error.message);
    throw error;
  }
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
