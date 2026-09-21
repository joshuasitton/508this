/**
 * Which part of a `.docx` archive holds the picture a finding points at.
 *
 * A Word image is a real file inside the archive — `word/media/image1.png` —
 * and the drawing in `document.xml` reaches it through two hops: the
 * `a:blip`'s `r:embed` names a relationship id, and
 * `word/_rels/document.xml.rels` maps that id to a target path. This walks
 * those hops and returns the path; reading the bytes out of the zip is the
 * server's job, exactly as `domain/xml.ts` leaves unzipping to
 * `server/unzip.ts`.
 *
 * The finding is found by its anchor (`docPr:7`) rather than by counting
 * images, for the same reason remediation applies fixes by anchor:
 * automatic remediation may have run first, and the `docPr` id is the one
 * thing it does not move.
 */

import type { DocxParts } from './docx';
import { attr, find, findAll, parseXml, type XmlElement } from './xml';

/** Image extensions Word writes, mapped to what a vision model accepts. */
const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export interface DocxImageRef {
  /** Path inside the archive, e.g. `word/media/image1.png`. */
  part: string;
  mediaType: string;
}

/** The `docPr` id in an anchor like `docPr:7`, or null for anything else. */
export function docPrId(anchor: string | undefined): string | null {
  if (!anchor) return null;
  const m = /^docPr:(.+)$/.exec(anchor);
  return m?.[1] ?? null;
}

/**
 * The relationship id a drawing's picture is embedded under. `r:embed` is
 * the normal case; `r:link` means the picture lives outside the archive,
 * which is a document that will not print the same on another machine and
 * has no bytes here to send.
 */
function embedIdOf(drawing: XmlElement): string | null {
  for (const blip of findAll(drawing, 'blip')) {
    const embed = attr(blip, 'embed');
    if (embed) return embed;
  }
  return null;
}

/**
 * The archive path and media type for the picture a finding anchors to, or
 * null when the document has no sendable picture there — an externally
 * linked image, a drawing that is a shape rather than a photograph, or a
 * format a vision model does not accept (Word will happily embed EMF and
 * TIFF, and neither can be sent).
 */
export function imagePartFor(parts: DocxParts, anchor: string | undefined): DocxImageRef | null {
  const id = docPrId(anchor);
  if (id === null || !parts.documentRels) return null;

  const body = find(parseXml(parts.document), 'body');
  if (!body) return null;

  const drawing = findAll(body, 'drawing').find((d) => {
    const docPr = find(d, 'docPr');
    return docPr !== undefined && attr(docPr, 'id') === id;
  });
  if (!drawing) return null;

  const embed = embedIdOf(drawing);
  if (!embed) return null;

  return targetOf(parts, embed);
}

/**
 * The relationship table for `word/document.xml` is `word/_rels/document.xml.rels`,
 * and its targets are relative to `word/`. `DocxParts.rels` is the package
 * relationships file; the document's own table is read from the archive by
 * the server and passed in as `documentRels`.
 */
export function targetOfIn(documentRels: string, embedId: string): DocxImageRef | null {
  const root = parseXml(documentRels);
  for (const rel of findAll(root, 'Relationship')) {
    if (attr(rel, 'Id') !== embedId) continue;
    const target = attr(rel, 'Target');
    if (!target) return null;
    // An external target is a URL or an absolute path; there are no bytes
    // in this archive for it.
    if (/^[a-z]+:\/\//i.test(target) || attr(rel, 'TargetMode') === 'External') return null;
    const part = target.startsWith('/') ? target.slice(1) : `word/${target}`.replace(/\/\.\//g, '/');
    const ext = (part.split('.').pop() ?? '').toLowerCase();
    const mediaType = MEDIA_TYPES[ext];
    if (!mediaType) return null;
    return { part: normalise(part), mediaType };
  }
  return null;
}

/** Resolves `word/../docProps/x.png` and similar without a path library. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

function targetOf(parts: DocxParts, embedId: string): DocxImageRef | null {
  return parts.documentRels ? targetOfIn(parts.documentRels, embedId) : null;
}
