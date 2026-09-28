/**
 * Handing a file to a browser.
 *
 * Three routes serve a file the customer keeps — the document, its PDF export,
 * the statement — and a fourth serves all of them in an archive. The header
 * that names a download is fiddly in exactly one way, so it is written once
 * here: **the customer's filename never becomes a path and never goes into a
 * header unescaped**. `filename=` carries an ASCII fallback with quotes and
 * backslashes replaced, and `filename*=` carries the real name percent-encoded,
 * which is what a browser uses when it understands it.
 *
 * `no-store` is not caching advice. A document that has been deleted on its
 * retention clock must not still be sitting in a proxy, and a shared computer
 * must not hand the last customer's federal submission to the next person who
 * presses back.
 */
export function attachment(bytes: Uint8Array, filename: string, contentType: string): Response {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(filename);
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PDF_TYPE = 'application/pdf';
export const ZIP_TYPE = 'application/zip';
