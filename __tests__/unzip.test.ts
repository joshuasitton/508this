import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzip } from '../src/server/unzip';
import { zip } from './helpers/zip';
import { NotADocxError, readDocxParts } from '../src/server/docx';

const text = (b: Uint8Array) => new TextDecoder().decode(b);

test('reads deflated and stored entries', () => {
  const big = 'lorem ipsum '.repeat(500);
  const deflated = unzip(zip({ 'a.txt': 'hello', 'dir/b.txt': big }));
  assert.equal(text(deflated.get('a.txt')!), 'hello');
  assert.equal(text(deflated.get('dir/b.txt')!), big);
  const stored = unzip(zip({ 'a.txt': 'hello' }, { store: true }));
  assert.equal(text(stored.get('a.txt')!), 'hello');
});

test('finds the directory behind an archive comment', () => {
  // Word does not write comments, but other tools do, and the scan for the
  // end record has to look past one rather than declare the file corrupt.
  const bytes = unzip(zip({ 'a.txt': 'x' }, { comment: 'made by a tool' }));
  assert.equal(text(bytes.get('a.txt')!), 'x');
});

test('refuses what is not a zip, with a message that says so', () => {
  assert.throws(() => unzip(new TextEncoder().encode('<html>not a zip</html>')), /Not a zip archive/);
  assert.throws(() => unzip(new Uint8Array(0)), /Not a zip archive/);
});

test('readDocxParts returns the parts the detector wants and tolerates missing optional ones', () => {
  const parts = readDocxParts(
    zip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': '<w:document/>',
      'word/styles.xml': '<w:styles/>',
      'docProps/core.xml': '<cp:coreProperties/>',
    }),
  );
  assert.equal(parts.document, '<w:document/>');
  assert.equal(parts.styles, '<w:styles/>');
  assert.equal(parts.core, '<cp:coreProperties/>');
  assert.equal(parts.settings, undefined);
});

test('a zip without a document part is not a Word document', () => {
  // A .pptx renamed to .docx passes the signature check; this is where it
  // is caught, with an error the action can turn into a sentence.
  assert.throws(() => readDocxParts(zip({ 'ppt/presentation.xml': '<p/>' })), NotADocxError);
  assert.throws(() => readDocxParts(new TextEncoder().encode('junk')), NotADocxError);
});
