/**
 * A zip reader for .docx files, on Node's own zlib.
 *
 * A .docx is a zip of XML parts. Reading one needs the central directory and
 * raw deflate, both of which are a page of the zip specification and one
 * call into `node:zlib`. Taking a dependency for that would be the first
 * npm package on the server path, for a format whose entire reader fits in
 * this file and is tested against archives built in the test itself.
 *
 * It refuses what Word never writes: encryption, ZIP64, and compression
 * methods other than stored and deflate. A refusal is a clear error, and a
 * clear error is what a corrupt upload deserves.
 */

import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const STORED = 0;
const DEFLATE = 8;

export class ZipError extends Error {}

export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at, true);
  const u16 = (at: number) => view.getUint16(at, true);

  // The end-of-central-directory record is at the end, possibly followed by
  // a comment of up to 65535 bytes. Scan back for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new ZipError('Not a zip archive: no end-of-central-directory record');

  const entryCount = u16(eocd + 10);
  const centralOffset = u32(eocd + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported');

  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let at = centralOffset;
  for (let n = 0; n < entryCount; n++) {
    if (at + 46 > bytes.length || u32(at) !== CENTRAL) throw new ZipError('Corrupt central directory');
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const compressedSize = u32(at + 20);
    const uncompressedSize = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const localOffset = u32(at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) throw new ZipError('Encrypted archives are not supported');
    if (name.endsWith('/')) continue; // a directory entry

    if (localOffset + 30 > bytes.length || u32(localOffset) !== LOCAL) throw new ZipError(`Corrupt local header for ${name}`);
    const localNameLength = u16(localOffset + 26);
    const localExtraLength = u16(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new ZipError(`Truncated data for ${name}`);
    const data = bytes.subarray(dataStart, dataEnd);

    let content: Uint8Array;
    if (method === STORED) {
      content = data;
    } else if (method === DEFLATE) {
      content = new Uint8Array(inflateRawSync(data));
    } else {
      throw new ZipError(`Unsupported compression method ${method} for ${name}`);
    }
    if (content.length !== uncompressedSize) throw new ZipError(`Size mismatch for ${name}`);
    out.set(name, content);
  }
  return out;
}
