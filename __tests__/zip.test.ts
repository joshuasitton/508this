import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';

import { unzip } from '../src/server/unzip';
import { zip } from '../src/server/zip';

test('what the writer writes, the reader reads, and every entry carries its real CRC', () => {
  // Word refuses an archive with a wrong CRC as corrupt. The reader here
  // does not check CRCs, so the test does, against node:zlib, for each
  // entry in both the local and central headers.
  const enc = new TextEncoder();
  const big = enc.encode('lorem ipsum '.repeat(2000));
  const tiny = new Uint8Array([1, 2, 3]);
  const bytes = zip(new Map([['word/document.xml', big], ['word/media/x.bin', tiny]]));
  const back = unzip(bytes);
  assert.deepEqual([...back.get('word/document.xml')!], [...big]);
  assert.deepEqual([...back.get('word/media/x.bin')!], [...tiny]);

  const view = new DataView(bytes.buffer);
  const found: number[] = [];
  for (let i = 0; i + 4 <= bytes.length; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50) found.push(view.getUint32(i + 14, true));
    if (sig === 0x02014b50) found.push(view.getUint32(i + 16, true));
  }
  assert.deepEqual(found.sort(), [crc32(big), crc32(tiny), crc32(big), crc32(tiny)].sort());
  assert.ok(bytes.length < big.length, 'the repetitive part was deflated');
});
