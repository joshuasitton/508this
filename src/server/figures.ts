/**
 * The picture behind one finding, whichever format the document is.
 *
 * Both paths end in the same place – bytes and a media type – but they get
 * there differently. A Word image is a part in the archive, reached through
 * a relationship id. A PDF figure paints its image inside a marked-content
 * span, or paints vector artwork and has no image at all, which on real
 * design work is the usual answer.
 */

import { type FigureImage, type NoImage } from '@/domain/alt';
import { imagePartFor } from '@/domain/docxImages';
import { isSendable } from '@/domain/alt';
import type { Finding } from '@/domain/findings';
import type { Format } from '@/domain/job';
import { figureImage } from '@/domain/pdfImages';
import { readDocxPart, readDocxParts } from './docx';
import { sendableImage } from './images';
import { readPdf } from './pdf';

export type FigureResult = { ok: true; image: FigureImage } | { ok: false; reason: NoImage };

export function imageForFinding(original: Uint8Array, format: Format, finding: Finding): FigureResult {
  if (!finding.anchor) return { ok: false, reason: 'no-anchor' };
  return format === 'pdf' ? fromPdf(original, finding) : fromDocx(original, finding);
}

function fromDocx(original: Uint8Array, finding: Finding): FigureResult {
  const parts = readDocxParts(original);
  const ref = imagePartFor(parts, finding.anchor);
  if (!ref) return { ok: false, reason: 'not-found' };
  if (!isSendable(ref.mediaType)) return { ok: false, reason: 'unsupported-filter' };
  const bytes = readDocxPart(original, ref.part);
  if (!bytes) return { ok: false, reason: 'not-found' };
  return { ok: true, image: { bytes, mediaType: ref.mediaType } };
}

function fromPdf(original: Uint8Array, finding: Finding): FigureResult {
  const doc = readPdf(original);
  const found = figureImage(doc, finding.anchor);
  if (!found.ok) return { ok: false, reason: found.reason };
  return sendableImage(doc, found.stream);
}
