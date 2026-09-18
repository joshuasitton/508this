/**
 * A PDF reader, enough of one to find what Section 508 asks about.
 *
 * The domain may not take a dependency, and a PDF is not a format you can
 * skim with a regular expression: objects are reached through a cross
 * reference table that may itself be a compressed stream, and most of a
 * modern PDF's objects live inside other objects. So this is a real parser,
 * kept to what the detector and the remediator need:
 *
 * - the object grammar (null, booleans, numbers, strings, names, arrays,
 *   dictionaries, streams, indirect references)
 * - classic `xref` tables and PDF 1.5 cross reference streams, including the
 *   PNG predictors Adobe writes with them
 * - object streams, where Adobe puts the structure tree
 * - `/Prev` chains, because a linearized PDF – which is what every file that
 *   has been through Acrobat is – has two cross reference sections
 *
 * Decompression is not here. `inflate` is passed in, so this file stays
 * free of `node:zlib` and `npm test` keeps running with nothing installed,
 * exactly as the .docx path splits between `domain/xml.ts` and
 * `server/unzip.ts`.
 *
 * What it deliberately does not do: encryption (an encrypted PDF is refused,
 * with a sentence saying so), and any filter but Flate (LZW and the image
 * codecs decode picture data, which nothing here reads).
 */

export class PdfError extends Error {}

export class PdfName {
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  toString() {
    return `/${this.name}`;
  }
}

export class PdfRef {
  readonly num: number;
  readonly gen: number;
  constructor(num: number, gen: number) {
    this.num = num;
    this.gen = gen;
  }
  get key() {
    return `${this.num} ${this.gen}`;
  }
}

export class PdfStream {
  readonly dict: PdfDict;
  /** Bytes as stored, still filtered. */
  readonly raw: Uint8Array;
  constructor(dict: PdfDict, raw: Uint8Array) {
    this.dict = dict;
    this.raw = raw;
  }
}

export type PdfDict = Map<string, PdfValue>;

export type PdfValue =
  | null
  | boolean
  | number
  | Uint8Array // a string object, bytes as written
  | PdfName
  | PdfRef
  | PdfValue[]
  | PdfDict
  | PdfStream;

export type Inflate = (data: Uint8Array) => Uint8Array;

const SPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isSpace(b: number) {
  return SPACE.has(b);
}
function isDelim(b: number) {
  return DELIM.has(b);
}
function isRegular(b: number) {
  return !isSpace(b) && !isDelim(b);
}

/** A cursor over the file's bytes that knows the object grammar. */
export class PdfLexer {
  pos = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  private byte(at = this.pos): number {
    return this.bytes[at] ?? -1;
  }

  skipSpace() {
    for (;;) {
      while (this.pos < this.bytes.length && isSpace(this.byte())) this.pos++;
      if (this.byte() !== 0x25) return; // '%' comment runs to end of line
      while (this.pos < this.bytes.length && this.byte() !== 0x0a && this.byte() !== 0x0d) this.pos++;
    }
  }

  /** The next regular-character run, e.g. a keyword or a number. */
  token(): string {
    this.skipSpace();
    const start = this.pos;
    while (this.pos < this.bytes.length && isRegular(this.byte())) this.pos++;
    if (this.pos === start) {
      // A delimiter is a token of its own.
      this.pos++;
      return String.fromCharCode(this.byte(start));
    }
    return latin1(this.bytes.subarray(start, this.pos));
  }

  peekToken(): string {
    const at = this.pos;
    const t = this.token();
    this.pos = at;
    return t;
  }

  expect(keyword: string) {
    const t = this.token();
    if (t !== keyword) throw new PdfError(`Expected ${keyword} at ${this.pos}, found ${JSON.stringify(t)}`);
  }

  /**
   * One object. `resolveLength` is called when a stream's /Length is an
   * indirect reference, which Acrobat writes often.
   */
  object(resolveLength?: (ref: PdfRef) => PdfValue): PdfValue {
    this.skipSpace();
    const b = this.byte();
    if (b === -1) throw new PdfError('Unexpected end of file');

    if (b === 0x2f) return this.name();
    if (b === 0x28) return this.literalString();
    if (b === 0x5b) return this.array(resolveLength);
    if (b === 0x3c) {
      if (this.byte(this.pos + 1) === 0x3c) return this.dictOrStream(resolveLength);
      return this.hexString();
    }
    if (b === 0x5d || b === 0x3e) throw new PdfError(`Unexpected ${String.fromCharCode(b)} at ${this.pos}`);

    const start = this.pos;
    const t = this.token();
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (/^[+-]?[\d.]+$/.test(t)) {
      // "12 0 R" is a reference; "12 0 obj" is a definition, not a value here.
      const save = this.pos;
      const gen = this.token();
      if (/^\d+$/.test(gen)) {
        const kw = this.token();
        if (kw === 'R') return new PdfRef(Number(t), Number(gen));
      }
      this.pos = save;
      return Number(t);
    }
    this.pos = start;
    throw new PdfError(`Unparsable object at ${start}: ${JSON.stringify(t)}`);
  }

  private name(): PdfName {
    this.pos++; // '/'
    let out = '';
    while (this.pos < this.bytes.length && isRegular(this.byte())) {
      let c = this.byte();
      this.pos++;
      if (c === 0x23) {
        const hex = latin1(this.bytes.subarray(this.pos, this.pos + 2));
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          c = parseInt(hex, 16);
          this.pos += 2;
        }
      }
      out += String.fromCharCode(c);
    }
    return new PdfName(out);
  }

  private literalString(): Uint8Array {
    this.pos++; // '('
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.bytes.length) {
      const c = this.byte();
      this.pos++;
      if (c === 0x5c) {
        const e = this.byte();
        this.pos++;
        switch (e) {
          case 0x6e: out.push(0x0a); break;
          case 0x72: out.push(0x0d); break;
          case 0x74: out.push(0x09); break;
          case 0x62: out.push(0x08); break;
          case 0x66: out.push(0x0c); break;
          case 0x0a: break; // line continuation
          case 0x0d: if (this.byte() === 0x0a) this.pos++; break;
          default:
            if (e >= 0x30 && e <= 0x37) {
              let oct = String.fromCharCode(e);
              for (let i = 0; i < 2 && this.byte() >= 0x30 && this.byte() <= 0x37; i++) {
                oct += String.fromCharCode(this.byte());
                this.pos++;
              }
              out.push(parseInt(oct, 8) & 0xff);
            } else out.push(e);
        }
        continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29) {
        depth--;
        if (depth === 0) break;
      }
      out.push(c);
    }
    return Uint8Array.from(out);
  }

  private hexString(): Uint8Array {
    this.pos++; // '<'
    let hex = '';
    while (this.pos < this.bytes.length && this.byte() !== 0x3e) {
      const c = this.byte();
      this.pos++;
      if (/[0-9a-fA-F]/.test(String.fromCharCode(c))) hex += String.fromCharCode(c);
    }
    this.pos++; // '>'
    if (hex.length % 2) hex += '0';
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  private array(resolveLength?: (ref: PdfRef) => PdfValue): PdfValue[] {
    this.pos++; // '['
    const out: PdfValue[] = [];
    for (;;) {
      this.skipSpace();
      if (this.byte() === 0x5d) {
        this.pos++;
        return out;
      }
      if (this.pos >= this.bytes.length) throw new PdfError('Unterminated array');
      out.push(this.object(resolveLength));
    }
  }

  private dictOrStream(resolveLength?: (ref: PdfRef) => PdfValue): PdfDict | PdfStream {
    this.pos += 2; // '<<'
    const dict: PdfDict = new Map();
    for (;;) {
      this.skipSpace();
      if (this.byte() === 0x3e && this.byte(this.pos + 1) === 0x3e) {
        this.pos += 2;
        break;
      }
      if (this.pos >= this.bytes.length) throw new PdfError('Unterminated dictionary');
      const key = this.object(resolveLength);
      if (!(key instanceof PdfName)) throw new PdfError('Dictionary key is not a name');
      dict.set(key.name, this.object(resolveLength));
    }

    const save = this.pos;
    if (this.peekToken() !== 'stream') {
      this.pos = save;
      return dict;
    }
    this.token(); // 'stream'
    // The data begins after CRLF or LF, and nothing else.
    if (this.byte() === 0x0d) this.pos++;
    if (this.byte() === 0x0a) this.pos++;
    const start = this.pos;

    let length = dict.get('Length');
    if (length instanceof PdfRef && resolveLength) length = resolveLength(length);
    let end: number;
    if (typeof length === 'number' && length >= 0 && start + length <= this.bytes.length) {
      end = start + length;
      // Trust but verify: 'endstream' should follow.
      const after = latin1(this.bytes.subarray(end, end + 20));
      if (!/^\s*endstream/.test(after)) end = this.findEndstream(start);
    } else {
      end = this.findEndstream(start);
    }
    const raw = this.bytes.subarray(start, end);
    this.pos = end;
    this.skipSpace();
    if (this.peekToken() === 'endstream') this.token();
    return new PdfStream(dict, raw);
  }

  /** For a wrong or missing /Length: scan for the keyword. */
  private findEndstream(start: number): number {
    const needle = [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d]; // endstream
    for (let i = start; i <= this.bytes.length - needle.length; i++) {
      let hit = true;
      for (let j = 0; j < needle.length; j++) {
        if (this.bytes[i + j] !== needle[j]) {
          hit = false;
          break;
        }
      }
      if (!hit) continue;
      let end = i;
      if (this.bytes[end - 1] === 0x0a) end--;
      if (this.bytes[end - 1] === 0x0d) end--;
      return end;
    }
    throw new PdfError('Unterminated stream');
  }
}

export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/**
 * A PDF string as text. A leading byte-order mark means UTF-16BE, which is
 * what Acrobat writes for anything with a non-ASCII character; everything
 * else is PDFDocEncoding, close enough to Latin-1 for the fields read here.
 */
export function pdfText(value: PdfValue): string {
  if (!(value instanceof Uint8Array)) return '';
  if (value.length >= 2 && value[0] === 0xfe && value[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < value.length; i += 2) s += String.fromCharCode((value[i]! << 8) | value[i + 1]!);
    return s;
  }
  return latin1(value);
}

interface XrefEntry {
  /** Byte offset, for a normal object. */
  offset?: number;
  /** Containing object stream and index, for a compressed object. */
  inStream?: { stream: number; index: number };
}

export class PdfDocument {
  private readonly lexer: PdfLexer;
  private readonly xref = new Map<number, XrefEntry>();
  private readonly cache = new Map<number, PdfValue>();
  private readonly objStmCache = new Map<number, Map<number, PdfValue>>();
  readonly trailer: PdfDict = new Map();
  /** Byte offset of the newest cross reference section, for an update's /Prev. */
  startXref = -1;
  /** Whether that newest section is a cross reference stream rather than a table. */
  xrefIsStream = false;

  readonly bytes: Uint8Array;
  private readonly inflate: Inflate;

  private constructor(bytes: Uint8Array, inflate: Inflate) {
    this.bytes = bytes;
    this.inflate = inflate;
    this.lexer = new PdfLexer(bytes);
  }

  static parse(bytes: Uint8Array, inflate: Inflate): PdfDocument {
    const doc = new PdfDocument(bytes, inflate);
    doc.load();
    return doc;
  }

  get version(): string {
    const head = latin1(this.bytes.subarray(0, 16));
    return /^%PDF-(\d\.\d)/.exec(head)?.[1] ?? '';
  }

  private load() {
    if (!latin1(this.bytes.subarray(0, 5)).startsWith('%PDF-')) {
      throw new PdfError('Not a PDF: the file does not begin with %PDF-');
    }
    const tail = latin1(this.bytes.subarray(Math.max(0, this.bytes.length - 2048)));
    const m = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(tail) ?? /startxref\s+(\d+)/.exec(tail);
    let ok = false;
    if (m) {
      try {
        this.startXref = Number(m[1]);
        this.readXrefChain(Number(m[1]));
        ok = this.xref.size > 0 && this.trailer.has('Root');
      } catch {
        ok = false;
      }
    }
    // A file with a damaged table still has its objects; find them by scanning.
    if (!ok) this.rebuildByScanning();
    if (this.trailer.has('Encrypt')) {
      throw new PdfError('The PDF is encrypted. Remove the password or permissions and send it again.');
    }
    if (!this.trailer.has('Root')) throw new PdfError('The PDF has no document catalogue');
  }

  private readXrefChain(start: number) {
    const seen = new Set<number>();
    let at: number | undefined = start;
    let first = true;
    while (at !== undefined && !seen.has(at) && at >= 0 && at < this.bytes.length) {
      seen.add(at);
      const wasStream = this.readXrefSection(at);
      if (first) {
        this.xrefIsStream = wasStream.isStream;
        first = false;
      }
      at = wasStream.prev;
    }
  }

  /** One more than the highest object number the file uses. */
  get size(): number {
    const declared = Number(this.resolve(this.trailer.get('Size')) ?? 0);
    let highest = 0;
    for (const num of this.xref.keys()) highest = Math.max(highest, num);
    return Math.max(declared, highest + 1);
  }

  /** Reads one section, reporting its kind and the /Prev offset if there is one. */
  private readXrefSection(at: number): { prev: number | undefined; isStream: boolean } {
    this.lexer.pos = at;
    this.lexer.skipSpace();
    if (this.lexer.peekToken() === 'xref') {
      this.lexer.token();
      for (;;) {
        this.lexer.skipSpace();
        const t = this.lexer.peekToken();
        if (t === 'trailer') {
          this.lexer.token();
          const dict = this.lexer.object() as PdfDict;
          for (const [k, v] of dict) if (!this.trailer.has(k)) this.trailer.set(k, v);
          // A hybrid file points at an xref stream with the rest.
          const hybrid = dict.get('XRefStm');
          if (typeof hybrid === 'number') {
            try {
              this.readXrefSection(hybrid);
            } catch {
              // a broken hybrid section is not fatal
            }
          }
          const prev = dict.get('Prev');
          return { prev: typeof prev === 'number' ? prev : undefined, isStream: false };
        }
        if (!/^\d+$/.test(t)) return { prev: undefined, isStream: false };
        const first = Number(this.lexer.token());
        const count = Number(this.lexer.token());
        if (!Number.isFinite(count)) return { prev: undefined, isStream: false };
        for (let i = 0; i < count; i++) {
          const offset = Number(this.lexer.token());
          this.lexer.token(); // generation
          const type = this.lexer.token();
          const num = first + i;
          if (type === 'n' && !this.xref.has(num)) this.xref.set(num, { offset });
        }
      }
    }

    // Otherwise the section is itself an object: a cross reference stream.
    this.lexer.token(); // object number
    this.lexer.token(); // generation
    this.lexer.expect('obj');
    const stream = this.lexer.object();
    if (!(stream instanceof PdfStream)) throw new PdfError(`No cross reference at ${at}`);
    this.readXrefStream(stream);
    for (const [k, v] of stream.dict) if (!this.trailer.has(k)) this.trailer.set(k, v);
    const prev = stream.dict.get('Prev');
    return { prev: typeof prev === 'number' ? prev : undefined, isStream: true };
  }

  private readXrefStream(stream: PdfStream) {
    const data = this.decode(stream);
    const w = (stream.dict.get('W') as PdfValue[] | undefined)?.map((x) => Number(x)) ?? [];
    if (w.length < 3) throw new PdfError('Cross reference stream has no /W');
    const size = Number(stream.dict.get('Size') ?? 0);
    const indexRaw = stream.dict.get('Index');
    const index = Array.isArray(indexRaw) ? indexRaw.map((x) => Number(x)) : [0, size];
    const width = w.reduce((a, b) => a + b, 0);
    let at = 0;
    const field = (offset: number, bytes: number, fallback: number) => {
      if (bytes === 0) return fallback;
      let v = 0;
      for (let i = 0; i < bytes; i++) v = v * 256 + (data[offset + i] ?? 0);
      return v;
    };
    for (let s = 0; s + 1 < index.length; s += 2) {
      const first = index[s]!;
      const count = index[s + 1]!;
      for (let i = 0; i < count; i++) {
        if (at + width > data.length) return;
        const type = field(at, w[0]!, 1);
        const f2 = field(at + w[0]!, w[1]!, 0);
        const f3 = field(at + w[0]! + w[1]!, w[2]!, 0);
        at += width;
        const num = first + i;
        if (this.xref.has(num)) continue;
        if (type === 1) this.xref.set(num, { offset: f2 });
        else if (type === 2) this.xref.set(num, { inStream: { stream: f2, index: f3 } });
      }
    }
  }

  /**
   * Last resort: walk the file for "n g obj". A PDF whose table is wrong is
   * still readable this way, and a document the customer cannot open is
   * exactly the kind that arrives needing remediation.
   */
  private rebuildByScanning() {
    const text = latin1(this.bytes);
    for (const m of text.matchAll(/(?:^|[\s>])(\d+)\s+(\d+)\s+obj\b/g)) {
      const num = Number(m[1]);
      const offset = m.index! + m[0].indexOf(m[1]!);
      this.xref.set(num, { offset });
    }
    if (!this.trailer.has('Root')) {
      const t = /trailer\s*<</g;
      let m: RegExpExecArray | null;
      while ((m = t.exec(text)) !== null) {
        this.lexer.pos = m.index + 'trailer'.length;
        try {
          const dict = this.lexer.object() as PdfDict;
          for (const [k, v] of dict) this.trailer.set(k, v);
        } catch {
          // keep looking
        }
      }
    }
    if (!this.trailer.has('Root')) {
      // Find the catalogue directly.
      for (const num of this.xref.keys()) {
        const o = this.get(num);
        const d = o instanceof PdfStream ? o.dict : o;
        if (d instanceof Map && (d.get('Type') as PdfName | undefined)?.name === 'Catalog') {
          this.trailer.set('Root', new PdfRef(num, 0));
          break;
        }
      }
    }
  }

  /** Object by number, parsed once. */
  get(num: number): PdfValue {
    if (this.cache.has(num)) return this.cache.get(num)!;
    this.cache.set(num, null); // break reference cycles
    const entry = this.xref.get(num);
    let value: PdfValue = null;
    try {
      if (entry?.offset !== undefined) {
        this.lexer.pos = entry.offset;
        const declared = Number(this.lexer.token());
        this.lexer.token();
        const kw = this.lexer.token();
        if (kw === 'obj' && (declared === num || !Number.isFinite(declared))) {
          value = this.lexer.object((ref) => this.resolve(ref));
        }
      } else if (entry?.inStream) {
        value = this.fromObjectStream(entry.inStream.stream, num);
      }
    } catch {
      value = null;
    }
    this.cache.set(num, value);
    return value;
  }

  private fromObjectStream(streamNum: number, want: number): PdfValue {
    let table = this.objStmCache.get(streamNum);
    if (!table) {
      table = new Map();
      this.objStmCache.set(streamNum, table);
      const stm = this.get(streamNum);
      if (stm instanceof PdfStream) {
        const data = this.decode(stm);
        const n = Number(this.resolve(stm.dict.get('N') ?? 0));
        const first = Number(this.resolve(stm.dict.get('First') ?? 0));
        const header = new PdfLexer(data.subarray(0, first));
        const pairs: Array<[number, number]> = [];
        for (let i = 0; i < n; i++) {
          const num = Number(header.token());
          const off = Number(header.token());
          if (!Number.isFinite(num) || !Number.isFinite(off)) break;
          pairs.push([num, off]);
        }
        for (const [num, off] of pairs) {
          const body = new PdfLexer(data);
          body.pos = first + off;
          try {
            table.set(num, body.object());
          } catch {
            table.set(num, null);
          }
        }
      }
    }
    return table.get(want) ?? null;
  }

  /** Follows references until it reaches a value. */
  resolve(v: PdfValue | undefined): PdfValue {
    let out: PdfValue = v ?? null;
    for (let i = 0; i < 64 && out instanceof PdfRef; i++) out = this.get(out.num);
    return out instanceof PdfRef ? null : out;
  }

  /** A dictionary entry, resolved. Works on a stream's dictionary too. */
  at(container: PdfValue, ...path: string[]): PdfValue {
    let node: PdfValue = container;
    for (const key of path) {
      const dict = node instanceof PdfStream ? node.dict : node;
      if (!(dict instanceof Map)) return null;
      node = this.resolve(dict.get(key));
    }
    return node;
  }

  get catalog(): PdfDict {
    const root = this.resolve(this.trailer.get('Root'));
    return root instanceof Map ? root : new Map();
  }

  /** Every page dictionary, in order, following the page tree. */
  get pages(): PdfDict[] {
    const out: PdfDict[] = [];
    const seen = new Set<PdfDict>();
    const walk = (node: PdfValue, depth: number) => {
      if (depth > 64 || !(node instanceof Map) || seen.has(node)) return;
      seen.add(node);
      const type = this.resolve(node.get('Type'));
      const kids = this.resolve(node.get('Kids'));
      if (Array.isArray(kids)) {
        for (const kid of kids) walk(this.resolve(kid), depth + 1);
        return;
      }
      if (type instanceof PdfName && type.name === 'Pages') return;
      out.push(node);
    };
    walk(this.at(this.catalog, 'Pages'), 0);
    return out;
  }

  /** A stream's bytes, decompressed. Only Flate is understood. */
  decode(stream: PdfStream): Uint8Array {
    const filters = this.filterNames(stream);
    let data = stream.raw;
    const parmsRaw = this.resolve(stream.dict.get('DecodeParms') ?? stream.dict.get('DP'));
    const parmsList = Array.isArray(parmsRaw) ? parmsRaw : [parmsRaw];
    filters.forEach((name, i) => {
      if (name === 'FlateDecode' || name === 'Fl') {
        data = this.inflate(data);
        const parms = this.resolve(parmsList[i] ?? null);
        if (parms instanceof Map) data = this.unpredict(data, parms);
      } else if (name === 'ASCIIHexDecode' || name === 'AHx') {
        data = asciiHexDecode(data);
      } else {
        throw new PdfError(`Unsupported stream filter /${name}`);
      }
    });
    return data;
  }

  filterNames(stream: PdfStream): string[] {
    const f = this.resolve(stream.dict.get('Filter'));
    if (f instanceof PdfName) return [f.name];
    if (Array.isArray(f)) return f.map((x) => (this.resolve(x) as PdfName)?.name).filter(Boolean);
    return [];
  }

  /** PNG and TIFF predictors, which Acrobat uses on cross reference streams. */
  private unpredict(data: Uint8Array, parms: PdfDict): Uint8Array {
    const predictor = Number(this.resolve(parms.get('Predictor')) ?? 1);
    if (predictor <= 1) return data;
    const colors = Number(this.resolve(parms.get('Colors')) ?? 1);
    const bpc = Number(this.resolve(parms.get('BitsPerComponent')) ?? 8);
    const columns = Number(this.resolve(parms.get('Columns')) ?? 1);
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
    const rowLength = Math.ceil((colors * bpc * columns) / 8);
    if (predictor === 2) {
      if (bpc !== 8) return data;
      for (let r = 0; r + rowLength <= data.length; r += rowLength) {
        for (let i = bpp; i < rowLength; i++) data[r + i] = (data[r + i]! + data[r + i - bpp]!) & 0xff;
      }
      return data;
    }
    // PNG predictors: each row is preceded by its filter type.
    const rows = Math.floor(data.length / (rowLength + 1));
    const out = new Uint8Array(rows * rowLength);
    let prev = new Uint8Array(rowLength);
    for (let r = 0; r < rows; r++) {
      const type = data[r * (rowLength + 1)]!;
      const src = data.subarray(r * (rowLength + 1) + 1, (r + 1) * (rowLength + 1));
      const row = out.subarray(r * rowLength, (r + 1) * rowLength);
      row.set(src);
      for (let i = 0; i < rowLength; i++) {
        const a = i >= bpp ? row[i - bpp]! : 0;
        const b = prev[i]!;
        const c = i >= bpp ? prev[i - bpp]! : 0;
        switch (type) {
          case 0: break;
          case 1: row[i] = (row[i]! + a) & 0xff; break;
          case 2: row[i] = (row[i]! + b) & 0xff; break;
          case 3: row[i] = (row[i]! + ((a + b) >> 1)) & 0xff; break;
          case 4: {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            row[i] = (row[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
            break;
          }
          default: break;
        }
      }
      prev = row;
    }
    return out;
  }
}

function asciiHexDecode(data: Uint8Array): Uint8Array {
  let hex = '';
  for (const b of data) {
    const c = String.fromCharCode(b);
    if (c === '>') break;
    if (/[0-9a-fA-F]/.test(c)) hex += c;
  }
  if (hex.length % 2) hex += '0';
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
