import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attr, child, children, decodeEntities, find, findAll, parseXml, textOf } from '../src/domain/xml';

test('parses what Word writes: declaration, prefixes, self-closing tags, both quote styles', () => {
  const root = parseXml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
     <w:document xmlns:w="x"><w:body><w:p><w:pPr><w:pStyle w:val='Heading1'/></w:pPr><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`,
  );
  assert.equal(root.name, 'w:document');
  assert.equal(root.local, 'document');
  const p = find(root, 'p')!;
  assert.equal(attr(child(child(p, 'pPr')!, 'pStyle')!, 'val'), 'Heading1');
  assert.equal(textOf(p), 'Hi');
});

test('names match by local part, so a renamed prefix still finds the element', () => {
  // A document round-tripped through another editor can write the main
  // namespace under a different prefix. The header row is still there.
  const root = parseXml('<a:tbl xmlns:a="x"><a:tr><a:trPr><a:tblHeader/></a:trPr></a:tr></a:tbl>');
  assert.ok(find(root, 'tblHeader'));
  assert.equal(children(root, 'tr').length, 1);
});

test('whitespace between elements is dropped; whitespace inside a leaf is kept', () => {
  // `<w:t xml:space="preserve"> </w:t>` is the space between two words. Drop
  // it and "click" + "here" becomes "clickhere", which the link check would
  // then fail to recognise as generic text.
  const root = parseXml('<w:p>\n  <w:r><w:t>click</w:t></w:r>\n  <w:r><w:t xml:space="preserve"> </w:t></w:r>\n  <w:r><w:t>here</w:t></w:r>\n</w:p>');
  assert.equal(textOf(root), 'click here');
  assert.equal(root.children.length, 3);
});

test('entities decode in text and attributes', () => {
  assert.equal(decodeEntities('a &amp; b &lt; c &#169; &#x263A; &quot;q&quot; &apos;s&apos;'), 'a & b < c © ☺ "q" \'s\'');
  const root = parseXml('<x d="R&amp;D &quot;alt&quot;">Fish &amp; chips</x>');
  assert.equal(attr(root, 'd'), 'R&D "alt"');
  assert.equal(textOf(root), 'Fish & chips');
});

test('comments and CDATA are handled', () => {
  const root = parseXml('<x><!-- note --><y><![CDATA[<raw> & stuff]]></y></x>');
  assert.equal(textOf(root), '<raw> & stuff');
});

test('attr: a prefixed name is exact, a bare name matches by local part', () => {
  const root = parseXml('<x w:val="a" r:id="b" xml:space="preserve"/>');
  assert.equal(attr(root, 'val'), 'a');
  assert.equal(attr(root, 'w:val'), 'a');
  assert.equal(attr(root, 'id'), 'b');
  assert.equal(attr(root, 'r:id'), 'b');
  assert.equal(attr(root, 'space'), 'preserve');
  assert.equal(attr(root, 'nope'), undefined);
});

test('findAll returns descendants in document order, including nested ones', () => {
  const root = parseXml('<b><p>1<p>2</p></p><t><p>3</p></t></b>');
  assert.deepEqual(
    findAll(root, 'p').map((p) => textOf(p)),
    ['12', '2', '3'],
  );
});

test('malformed input throws rather than guessing', () => {
  // A corrupt upload should fail at the reader with a clear message, not
  // produce an empty findings list that reads as "this document is fine".
  assert.throws(() => parseXml('<a><b></a>'), /Mismatched/);
  assert.throws(() => parseXml('<a>'), /Unclosed/);
  assert.throws(() => parseXml('<a b=c/>'), /not quoted/);
});
