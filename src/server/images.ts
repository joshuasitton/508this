/**
 * A PDF image XObject, turned into bytes a vision model will accept.
 *
 * Two cases cover almost every real document:
 *
 * - **`/DCTDecode`** is a JPEG already. The stream's raw bytes *are* the
 *   file; nothing is decoded and nothing is re-encoded, so the model sees
 *   exactly what the document contains.
 * - **`/FlateDecode`, or no filter at all**, is raw samples. Those are not
 *   an image format anything accepts, so they are wrapped in a PNG — which
 *   is a header, the same samples deflated with a filter byte per row, and
 *   three CRCs. `node:zlib` provides both the deflate and the CRC, which is
 *   why this is here and not in `src/domain/`.
 *
 * Everything else is refused by name rather than guessed at. JPEG 2000,
 * CCITT fax, JBIG2 and indexed or separation colour spaces are all real and
 * all need a decoder this service does not have; a reviewer being told
 * "describe it yourself" is a worse outcome than a drafted sentence and a
 * far better one than a description of the wrong picture.
 */

import { crc32, deflateSync } from 'node:zlib';

import { MAX_IMAGE_BYTES, type FigureImage, type NoImage } from '@/domain/alt';
import { PdfName, PdfStream, type PdfDocument, type PdfValue } from '@/domain/pdf';

export type Extracted = { ok: true; image: FigureImage } | { ok: false; reason: NoImage };

function nameOf(value: PdfValue): string {
  return value instanceof PdfName ? value.name : '';
}

/** The filters on a stream, in order, as plain names. */
function filtersOf(doc: PdfDocument, stream: PdfStream): string[] {
  const filter = doc.resolve(stream.dict.get('Filter'));
  if (filter instanceof PdfName) return [filter.name];
  if (Array.isArray(filter)) return filter.map((f) => nameOf(doc.resolve(f)));
  return [];
}

export function sendableImage(doc: PdfDocument, stream: PdfStream): Extracted {
  const filters = filtersOf(doc, stream);
  const width = Number(doc.resolve(stream.dict.get('Width')));
  const height = Number(doc.resolve(stream.dict.get('Height')));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: 'not-found' };
  }

  // A JPEG is already a file. Hand it over untouched.
  if (filters.length === 1 && filters[0] === 'DCTDecode') {
    if (stream.raw.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too-large' };
    return { ok: true, image: { bytes: stream.raw, mediaType: 'image/jpeg' } };
  }

  if (filters.some((f) => f !== 'FlateDecode')) return { ok: false, reason: 'unsupported-filter' };

  // A stencil mask has one bit per sample and no colour at all.
  if (doc.resolve(stream.dict.get('ImageMask')) === true) return { ok: false, reason: 'unsupported-colour' };

  const bits = Number(doc.resolve(stream.dict.get('BitsPerComponent')) ?? 8);
  if (bits !== 8) return { ok: false, reason: 'unsupported-colour' };

  const space = nameOf(doc.resolve(stream.dict.get('ColorSpace')));
  const channels = space === 'DeviceRGB' ? 3 : space === 'DeviceGray' ? 1 : 0;
  if (channels === 0) return { ok: false, reason: 'unsupported-colour' };

  let samples: Uint8Array;
  try {
    samples = doc.decode(stream);
  } catch {
    return { ok: false, reason: 'unsupported-filter' };
  }
  if (samples.length < width * height * channels) return { ok: false, reason: 'not-found' };

  const png = encodePng(samples, width, height, channels);
  if (png.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too-large' };
  return { ok: true, image: { bytes: png, mediaType: 'image/png' } };
}

function chunk(tag: string, data: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(tag);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(name, 4);
  out.set(data, 8);
  const body = new Uint8Array(4 + data.length);
  body.set(name, 0);
  body.set(data, 4);
  view.setUint32(8 + data.length, crc32(Buffer.from(body)) >>> 0);
  return out;
}

/**
 * Samples to a PNG. Every row is prefixed with filter byte 0 ("none"),
 * because the point is a file a model can open rather than the smallest
 * possible one, and a filter that guesses wrong costs more than it saves.
 */
function encodePng(samples: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(samples.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 3 ? 2 : 0; // colour type: truecolour or greyscale
  // 10, 11, 12 are compression, filter and interlace methods, all zero.

  const idat = new Uint8Array(deflateSync(Buffer.from(raw), { level: 6 }));
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
