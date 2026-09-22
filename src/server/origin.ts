/**
 * Where 508This is, as far as a link in an email is concerned.
 *
 * This is configuration and never the request's own `Host` header. A header
 * is whatever the client sent; a reset link built from one is a credential
 * mailed to the right person pointing at somebody else's server, and the
 * person who clicks it hands over their account without ever seeing
 * anything wrong. Host-header poisoning of password-reset mail is an old
 * bug and it is still the commonest way this feature is broken.
 *
 * So: one environment variable, read on the server, never a
 * `NEXT_PUBLIC_` one. In development it falls back to localhost, which is
 * where development is.
 */

export class NoOriginError extends Error {
  constructor() {
    super('PUBLIC_BASE_URL must be set in production: links in mail are built from it, never from a request header.');
  }
}

export function origin(): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return new URL(configured).origin;
  if (process.env.NODE_ENV === 'production') throw new NoOriginError();
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
