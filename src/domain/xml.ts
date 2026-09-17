/**
 * A small XML reader for Office Open XML.
 *
 * Node has no DOM, and the domain layer may not take a dependency, so the
 * detector needs its own way to walk WordprocessingML. This is deliberately
 * not a general XML parser: it handles what Word writes – a declaration,
 * elements, attributes in either quote, the five built-in entities and
 * numeric references, comments and CDATA – and nothing it does not write
 * (DTDs, processing instructions mid-document, namespace resolution).
 * Word's output is machine-generated and well-formed; a permissive reader
 * that guessed at broken input would only hide a corrupt upload until later.
 *
 * Names are matched by their local part, so `w:p` and `p` are the same
 * element to a caller. Word's prefixes are conventional but not guaranteed –
 * a document round-tripped through another editor can rename them – and a
 * detector that looked for the literal string "w:tblHeader" would miss a
 * header row that is there.
 */

export interface XmlElement {
  type: 'element';
  /** The name as written, e.g. "w:p". */
  name: string;
  /** The part after the colon, e.g. "p". */
  local: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export interface XmlText {
  type: 'text';
  text: string;
}

export type XmlNode = XmlElement | XmlText;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

function localOf(name: string): string {
  const i = name.indexOf(':');
  return i === -1 ? name : name.slice(i + 1);
}

function element(name: string, attrs: Record<string, string>): XmlElement {
  return { type: 'element', name, local: localOf(name), attrs, children: [] };
}

const NAME_END = /[\s/>=]/;

export function parseXml(source: string): XmlElement {
  const root = element('#document', {});
  const stack: XmlElement[] = [root];
  let i = 0;
  const n = source.length;

  const top = (): XmlElement => stack[stack.length - 1]!;

  while (i < n) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      pushText(top(), source.slice(i));
      break;
    }
    if (lt > i) pushText(top(), source.slice(i, lt));

    if (source.startsWith('<?', lt)) {
      i = skipTo(source, '?>', lt + 2);
    } else if (source.startsWith('<!--', lt)) {
      i = skipTo(source, '-->', lt + 4);
    } else if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      if (end === -1) throw new Error('Unterminated CDATA section');
      top().children.push({ type: 'text', text: source.slice(lt + 9, end) });
      i = end + 3;
    } else if (source.startsWith('<!', lt)) {
      i = skipTo(source, '>', lt + 2);
    } else if (source.startsWith('</', lt)) {
      const end = source.indexOf('>', lt + 2);
      if (end === -1) throw new Error('Unterminated closing tag');
      const name = source.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`Mismatched closing tag </${name}>`);
      finish(open);
      i = end + 1;
    } else {
      // Opening tag.
      let j = lt + 1;
      while (j < n && !NAME_END.test(source[j]!)) j++;
      const name = source.slice(lt + 1, j);
      if (!name) throw new Error(`Empty element name at ${lt}`);
      const attrs: Record<string, string> = {};
      let selfClosing = false;
      for (;;) {
        while (j < n && /\s/.test(source[j]!)) j++;
        if (j >= n) throw new Error(`Unterminated tag <${name}>`);
        if (source.startsWith('/>', j)) {
          selfClosing = true;
          j += 2;
          break;
        }
        if (source[j] === '>') {
          j += 1;
          break;
        }
        let k = j;
        while (k < n && !NAME_END.test(source[k]!)) k++;
        const attrName = source.slice(j, k);
        while (k < n && /\s/.test(source[k]!)) k++;
        if (source[k] !== '=') throw new Error(`Attribute ${attrName} in <${name}> has no value`);
        k++;
        while (k < n && /\s/.test(source[k]!)) k++;
        const quote = source[k];
        if (quote !== '"' && quote !== "'") throw new Error(`Attribute ${attrName} in <${name}> is not quoted`);
        const close = source.indexOf(quote, k + 1);
        if (close === -1) throw new Error(`Attribute ${attrName} in <${name}> is unterminated`);
        attrs[attrName] = decodeEntities(source.slice(k + 1, close));
        j = close + 1;
      }
      const el = element(name, attrs);
      top().children.push(el);
      if (!selfClosing) stack.push(el);
      i = j;
    }
  }

  if (stack.length !== 1) throw new Error(`Unclosed element <${top().name}>`);
  finish(root);
  const first = root.children.find((c): c is XmlElement => c.type === 'element');
  if (!first) throw new Error('No root element');
  return first;
}

function skipTo(source: string, marker: string, from: number): number {
  const end = source.indexOf(marker, from);
  if (end === -1) throw new Error(`Unterminated ${marker === '?>' ? 'declaration' : 'comment'}`);
  return end + marker.length;
}

function pushText(parent: XmlElement, raw: string) {
  parent.children.push({ type: 'text', text: decodeEntities(raw) });
}

/**
 * Whitespace between child elements is formatting, not content, and is
 * dropped. Whitespace inside a leaf is content – `<w:t xml:space="preserve"> </w:t>`
 * is the space between two words – and is kept.
 */
function finish(el: XmlElement) {
  if (el.children.some((c) => c.type === 'element')) {
    el.children = el.children.filter((c) => c.type === 'element' || c.text.trim() !== '');
  }
}

/** Direct children that are elements. */
export function elements(el: XmlElement): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.type === 'element');
}

/** First direct child with this local name. */
export function child(el: XmlElement, local: string): XmlElement | undefined {
  return elements(el).find((c) => c.local === local);
}

/** Direct children with this local name. */
export function children(el: XmlElement, local: string): XmlElement[] {
  return elements(el).filter((c) => c.local === local);
}

/** All descendants with this local name, in document order. */
export function findAll(el: XmlElement, local: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement) => {
    for (const c of elements(node)) {
      if (c.local === local) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

export function find(el: XmlElement, local: string): XmlElement | undefined {
  for (const c of elements(el)) {
    if (c.local === local) return c;
    const deeper = find(c, local);
    if (deeper) return deeper;
  }
  return undefined;
}

/**
 * An attribute by name. A prefixed name ("w:val") must match exactly; a bare
 * name ("val") matches by local part. Bare names are what callers want almost
 * everywhere, since Word writes `w:val` and `r:id` and `xml:space` and the
 * prefix carries no information a detector needs.
 */
export function attr(el: XmlElement, name: string): string | undefined {
  if (name.includes(':')) return el.attrs[name];
  if (name in el.attrs) return el.attrs[name];
  for (const key of Object.keys(el.attrs)) {
    if (localOf(key) === name) return el.attrs[key];
  }
  return undefined;
}

/** All text beneath the element, in order. */
export function textOf(el: XmlElement): string {
  let s = '';
  for (const c of el.children) {
    s += c.type === 'text' ? c.text : textOf(c);
  }
  return s;
}
