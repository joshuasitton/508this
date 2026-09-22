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
import { figureBox, figureImage, type FigureBox } from '@/domain/pdfImages';
import { readDocxPart, readDocxParts } from './docx';
import { sendableImage } from './images';
import { readPdf } from './pdf';

/**
 * `render` present means: there is no stored picture, but the document says
 * where the figure sits on the page, so one can be drawn. It rides on the
 * failure case rather than being a third state because every existing
 * caller already handles `ok: false` correctly — a caller that cannot
 * render falls through to the reason and tells the reviewer, which is what
 * it did before rendering existed.
 */
export type FigureResult =
  | { ok: true; image: FigureImage }
  | { ok: false; reason: NoImage; render?: FigureBox };

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
      if (found.ok) {
        out.set(findingKey(finding), sendableImage(doc, found.stream));
        continue;
      }
      // Vector artwork is the ordinary case on real design work. It is no
      // longer the end of the road: if the tag tree says where the figure
      // is, it can be drawn. No box, and it still is.
      const where = found.reason === 'vector' ? figureBox(doc, finding.anchor) : null;
      out.set(
        findingKey(finding),
        where ? { ok: false, reason: 'vector', render: where } : { ok: false, reason: noBox(found.reason) },
      );
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


/**
 * Vector artwork with nowhere recorded to draw from gets its own sentence.
 * "There is no picture in the file" was the whole truth before a renderer
 * existed; now the truth is narrower and the reviewer deserves the narrower
 * one.
 */
function noBox(reason: NoImage): NoImage {
  return reason === 'vector' ? 'no-box' : reason;
}
