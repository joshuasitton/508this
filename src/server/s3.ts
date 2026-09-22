/**
 * S3, signed by hand, with `node:crypto` and `fetch` and no package.
 *
 * The AWS SDK is 400-odd transitive dependencies to do four verbs — PUT,
 * GET, DELETE and LIST — and this service holds federal records. Every
 * package in that path is a package that can read a customer's document on
 * its way past. Signature Version 4 is an HMAC chain and a canonical
 * string; it is about eighty lines, it is specified precisely, and it is
 * testable against AWS's own published vector.
 *
 * That last part is the argument. Hand-rolled crypto is usually a mistake
 * because it cannot be checked. This can: AWS publishes a worked example
 * with a fixed key, a fixed timestamp and the exact signature it must
 * produce, and a test here reproduces it byte for byte. A second
 * implementation, written independently from the specification, agrees with
 * it as well.
 *
 * ## What this is not
 *
 * No multipart upload, no retries, no connection pooling beyond what
 * `fetch` does, no presigned URLs. A remediation job's document is under 25
 * MB by the upload limit, which is a single PUT, and adding the rest before
 * anything needs it is how four verbs become a library.
 *
 * ## Addressing
 *
 * With `S3_ENDPOINT` set, path style (`endpoint/bucket/key`), which is what
 * MinIO, Cloudflare R2 and every S3-compatible store speak. Without it,
 * virtual-hosted style against AWS (`bucket.s3.region.amazonaws.com/key`),
 * which is what AWS requires for buckets made since 2020.
 */

import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** For MinIO, R2 and the like. Absent means AWS. */
  endpoint?: string;
  /** For instance-role credentials, which carry one. */
  sessionToken?: string;
}

export class S3Error extends Error {
  readonly status: number;
  readonly method: string;

  // Written out rather than as constructor parameter properties: those are
  // TypeScript that has to be compiled rather than stripped, and this
  // repository runs its tests through Node's strip-only mode.
  constructor(status: number, method: string) {
    // No key, no bucket, no body. A key names a customer's job, and an
    // error is a thing that ends up in a log.
    super(`S3 ${method} failed with status ${status}.`);
    this.status = status;
    this.method = method;
  }
}

export function s3Config(): S3Config | null {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.S3_REGION ?? 'us-east-1',
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    ...(process.env.S3_SESSION_TOKEN ? { sessionToken: process.env.S3_SESSION_TOKEN } : {}),
  };
}

/**
 * Percent-encoding to RFC 3986, which is not what `encodeURIComponent`
 * does: it leaves `!'()*` alone and AWS does not. A signature computed over
 * a differently encoded path is a signature that does not match, and the
 * error AWS returns for that says nothing useful about why.
 */
function uriEncode(value: string, keepSlashes = false): string {
  let out = '';
  for (const character of value) {
    if (/[A-Za-z0-9\-._~]/.test(character)) {
      out += character;
    } else if (character === '/' && keepSlashes) {
      out += '/';
    } else {
      for (const byte of new TextEncoder().encode(character)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}

const sha256 = (data: Uint8Array | string): string =>
  createHash('sha256')
    .update(typeof data === 'string' ? data : Buffer.from(data))
    .digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

/** `20150830T123600Z` and `20150830`, the two forms AWS wants. */
function stamps(now: Date): { long: string; short: string } {
  const long = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { long, short: long.slice(0, 8) };
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * The whole of Signature Version 4, in one function, so it can be read
 * against the specification side by side and tested against AWS's vector.
 *
 * Exported because that test is the reason to trust any of this.
 */
export function sign(
  config: S3Config,
  service: string,
  method: string,
  host: string,
  path: string,
  query: Record<string, string>,
  payload: Uint8Array,
  now: Date,
): SignedRequest {
  const { long, short } = stamps(now);
  const hashedPayload = sha256(payload);

  const headers: Record<string, string> = { host, 'x-amz-date': long };
  // S3 requires the payload hash as a header; the other services in AWS's
  // published test suite do not send it, and the service is a parameter
  // precisely so those vectors can be reproduced here.
  if (service === 's3') headers['x-amz-content-sha256'] = hashedPayload;
  if (config.sessionToken) headers['x-amz-security-token'] = config.sessionToken;

  // Canonical headers are sorted by lower-cased name, values trimmed, one
  // per line, and the list of names repeated separately.
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]?.trim()}\n`).join('');
  const signedHeaders = names.join(';');

  // Query parameters are sorted by encoded name, and both name and value
  // are encoded — including the slashes inside a prefix.
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(query[key] ?? '')}`)
    .join('&');

  const canonicalRequest = [
    method,
    uriEncode(path, true),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  const scope = `${short}/${config.region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, long, scope, sha256(canonicalRequest)].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, short), config.region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers['Authorization'] =
    `${ALGORITHM} Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const search = canonicalQuery ? `?${canonicalQuery}` : '';
  return { url: `https://${host}${uriEncode(path, true)}${search}`, headers };
}

/** Where a key lives: path style behind an endpoint, virtual-hosted on AWS. */
function locate(config: S3Config, key: string): { host: string; path: string; scheme: string } {
  if (config.endpoint) {
    const endpoint = new URL(config.endpoint);
    return {
      host: endpoint.host,
      path: `/${config.bucket}/${key}`,
      scheme: endpoint.protocol.replace(':', ''),
    };
  }
  return { host: `${config.bucket}.s3.${config.region}.amazonaws.com`, path: `/${key}`, scheme: 'https' };
}

async function call(
  config: S3Config,
  method: string,
  key: string,
  query: Record<string, string>,
  payload: Uint8Array,
  contentType?: string,
): Promise<Response> {
  const { host, path, scheme } = locate(config, key);
  const signed = sign(config, 's3', method, host, path, query, payload, new Date());

  const headers: Record<string, string> = { ...signed.headers };
  // Content-Type is deliberately outside the signature: it is not in the
  // signed header list, so adding it here cannot invalidate anything, and
  // S3 records it on the object either way.
  if (contentType) headers['content-type'] = contentType;

  return fetch(signed.url.replace(/^https:/, `${scheme}:`), {
    method,
    headers,
    ...(method === 'PUT' ? { body: Buffer.from(payload) } : {}),
  });
}

export async function s3Put(config: S3Config, key: string, bytes: Uint8Array): Promise<void> {
  // Everything stored here is already sealed by `crypto.ts`, so the type is
  // deliberately opaque: S3 is told it holds bytes, not that it holds a
  // Word document.
  const response = await call(config, 'PUT', key, {}, bytes, 'application/octet-stream');
  if (!response.ok) throw new S3Error(response.status, 'PUT');
}

/** The bytes, or null if there is no such object. */
export async function s3Get(config: S3Config, key: string): Promise<Uint8Array | null> {
  const response = await call(config, 'GET', key, {}, new Uint8Array());
  if (response.status === 404) return null;
  if (!response.ok) throw new S3Error(response.status, 'GET');
  return new Uint8Array(await response.arrayBuffer());
}

/** Gone, or never there. S3 treats both as success and so does this. */
export async function s3Delete(config: S3Config, key: string): Promise<void> {
  const response = await call(config, 'DELETE', key, {}, new Uint8Array());
  if (!response.ok && response.status !== 404) throw new S3Error(response.status, 'DELETE');
}

/**
 * Every key under a prefix, following the continuation token.
 *
 * The XML is read with a regular expression rather than a parser, which is
 * usually a mistake and is not one here: `ListObjectsV2` returns exactly
 * one shape, the keys inside it are ours and are hex and hyphens by
 * construction, and adding an XML parser to read four elements would undo
 * the reason this file has no dependencies.
 */
export async function s3List(config: S3Config, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const query: Record<string, string> = { 'list-type': '2', prefix };
    if (token) query['continuation-token'] = token;

    const response = await call(config, 'GET', '', query, new Uint8Array());
    if (!response.ok) throw new S3Error(response.status, 'LIST');
    const xml = await response.text();

    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
      if (match[1]) keys.push(decodeEntities(match[1]));
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? (/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? undefined)
      : undefined;
  } while (token);

  return keys;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
