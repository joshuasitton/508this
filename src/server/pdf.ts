/**
 * Bytes to a parsed PDF. The one place `node:zlib` meets the PDF reader,
 * mirroring how `unzip.ts` serves `domain/xml.ts`.
 */

import { deflateSync, inflateRawSync, inflateSync } from 'node:zlib';

import { PdfDocument, PdfError } from '@/domain/pdf';
import { incrementalUpdate, type PdfEdit } from '@/domain/pdfWrite';
import type { PdfValue } from '@/domain/pdf';

export class NotAPdfError extends Error {}

/**
 * Flate data in a PDF is often written with a damaged final block – Acrobat
 * and many generators truncate the checksum – so a strict inflate throws on
 * files every reader in the world opens. `finishFlush: Z_SYNC_FLUSH` keeps
 * what was decoded instead of discarding it, and a raw-deflate retry covers
 * streams written without the zlib header.
 */
function inflate(data: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(inflateSync(data, { finishFlush: 2 /* Z_SYNC_FLUSH */ }));
  } catch {
    return new Uint8Array(inflateRawSync(data, { finishFlush: 2 }));
  }
}

export function readPdf(bytes: Uint8Array): PdfDocument {
  try {
    return PdfDocument.parse(bytes, inflate);
  } catch (error) {
    if (error instanceof PdfError) throw new NotAPdfError(error.message);
    throw error;
  }
}

/** The counterpart of `inflate`, for cross reference streams we write. */
function deflate(data: Uint8Array): Uint8Array {
  return new Uint8Array(deflateSync(data));
}

/**
 * The original file with the changed objects appended. Nothing in the
 * original is moved or rewritten, so everything the service did not touch –
 * fonts, colour profiles, artwork – survives byte for byte, and the
 * original remains readable inside the new file's history.
 */
export function writePdf(
  doc: PdfDocument,
  edits: readonly PdfEdit[],
  trailerExtras: ReadonlyMap<string, PdfValue> = new Map(),
): Uint8Array {
  return incrementalUpdate(doc, edits, deflate, trailerExtras);
}
