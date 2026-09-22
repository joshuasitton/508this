/**
 * The picture behind a finding, whichever format the document is.
 *
 * Both paths end in the same place – bytes and a media type – but they get
 * there differently. A Word image is a part in the archive, reached through
 * a relationship id. A PDF figure paints its image inside a marked-content
 * span, or paints vector artwork and has no image at all, which on real
 * design work is the usual answer.
 *
 * `imagesForFindings` exists because the review page asks the same question
 * about every figure at once, and a submission with 76 of them would
 * otherwise reopen and reparse the document 76 times to draw one screen.
 * The document is opened once and every finding answered from it.
 */

import { isSendable, type FigureImage, type NoImage } from '@/domain/alt';
import { imagePartFor } from '@/domain/docxImages';
import { findingKey, type Finding } from '@/domain/findings';
import type { DocxParts } from '@/domain/docx';
import type { Format } from '@/domain/job';
import { figureImage } from '@/domain/pdfImages';
import { readDocxPart, readDocxParts } from './docx';
import { sendableImage } from './images';
import { readPdf } from './pdf';

export type FigureResult = { ok: true; image: FigureImage } | { ok: false; reason: NoImage };

/** One finding's picture. Opens the document; prefer the batch for a page. */
export function imageForFinding(original: Uint8Array, format: Format, finding: Finding): FigureResult {
  return imagesForFindings(original, format, [finding]).get(findingKey(finding)) ?? { ok: false, reason: 'not-found' };
}

/**
 * Every finding's picture, from one opening of the document. Keyed by
 * `findingKey`, which is what the forms and the store already use.
 */
export function imagesForFindings(
  original: Uint8Array,
  format: Format,
  findings: readonly Finding[],
): Map<string, FigureResult> {
  const out = new Map<string, FigureResult>();
  const wanted = findings.filter((f) => f.kind === 'image-alt');
  if (wanted.length === 0) return out;

  if (format === 'pdf') {
    const doc = readPdf(original);
    for (const finding of wanted) {
      const found = figureImage(doc, finding.anchor);
      out.set(findingKey(finding), found.ok ? sendableImage(doc, found.stream) : { ok: false, reason: found.reason });
    }
    return out;
  }

  const parts = readDocxParts(original);
  for (const finding of wanted) out.set(findingKey(finding), fromDocx(original, parts, finding));
  return out;
}

function fromDocx(original: Uint8Array, parts: DocxParts, finding: Finding): FigureResult {
  if (!finding.anchor) return { ok: false, reason: 'no-anchor' };
  const ref = imagePartFor(parts, finding.anchor);
  if (!ref) return { ok: false, reason: 'not-found' };
  if (!isSendable(ref.mediaType)) return { ok: false, reason: 'unsupported-filter' };
  const bytes = readDocxPart(original, ref.part);
  if (!bytes) return { ok: false, reason: 'not-found' };
  return { ok: true, image: { bytes, mediaType: ref.mediaType } };
}
