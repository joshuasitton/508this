/**
 * Getting a letter out of the building, with no npm package to do it.
 *
 * SMTP by hand is a week of work and a security surface; a hosted mail API
 * is one `fetch`, and `fetch` is in Node. So this is an HTTPS POST and a
 * bearer token, and `src/server/` keeps its rule — the Anthropic SDK stays
 * the one dependency, reached through `await import` from a file no test
 * imports.
 *
 * The shape below is Resend's (`POST /emails`, `{from,to,subject,text}`,
 * `Authorization: Bearer`). Naming a provider in code is not a commitment:
 * `post` is six lines, and moving to Postmark or SES means rewriting those
 * six and nothing else. Being concrete beats an abstraction over one case.
 *
 * ## The outbox
 *
 * With no token configured, mail goes to `accounts/outbox/` as a file
 * instead of to a person. That is how the reset flow is developed and
 * tested without sending anything to anybody, and it is **refused outright
 * in production**: a service that silently writes password-reset links to
 * local disk because somebody forgot an environment variable is worse than
 * one that cannot send mail at all, because it looks like it is working.
 *
 * This is the last thing in the service still written to a local path, and
 * it stays there on purpose. `ACCOUNTS_DIR` names the outbox and nothing
 * else now — accounts, sessions and reset tokens are all on the store.
 * These files hold **live reset links**, and they exist only in
 * development; putting credentials on the shared store to tidy a folder
 * would be moving them somewhere more exposed for no reason.
 *
 * ## What is never recorded
 *
 * No message body reaches a log, an error or an audit record — a reset mail
 * *is* a credential. A failed send is recorded as the shape of the failure
 * and the account it concerned, and nothing else.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { Message } from '@/domain/mail';

const ROOT = process.env.ACCOUNTS_DIR ?? path.join(process.cwd(), 'accounts');
const OUTBOX = path.join(ROOT, 'outbox');

const ENDPOINT = process.env.MAIL_ENDPOINT ?? 'https://api.resend.com/emails';

/** The address letters come from. Never a `NEXT_PUBLIC_` variable, like the token. */
function from(): string {
  return process.env.MAIL_FROM ?? '508This <no-reply@508this.example>';
}

export function mailConfigured(): boolean {
  return Boolean(process.env.MAIL_TOKEN && process.env.MAIL_FROM);
}

/** Where a letter would go if one were sent right now. */
export function transport(): 'https' | 'outbox' | 'none' {
  if (mailConfigured()) return 'https';
  return process.env.NODE_ENV === 'production' ? 'none' : 'outbox';
}

export type SendResult = { ok: true; via: 'https' | 'outbox' } | { ok: false; reason: 'unconfigured' | 'refused' };

/**
 * Send one letter. Returns rather than throws, because every caller has to
 * answer the person the same way whether or not the send worked — telling
 * them otherwise is how a form starts revealing which addresses have
 * accounts.
 */
export async function send(message: Message): Promise<SendResult> {
  const via = transport();
  if (via === 'none') return { ok: false, reason: 'unconfigured' };
  if (via === 'outbox') return writeToOutbox(message);

  try {
    const response = await post(message);
    return response ? { ok: true, via: 'https' } : { ok: false, reason: 'refused' };
  } catch {
    // The error is not rethrown and not inspected: whatever it carries, it
    // was carrying a message body a moment ago.
    return { ok: false, reason: 'refused' };
  }
}

async function post(message: Message): Promise<boolean> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MAIL_TOKEN}`,
    },
    body: JSON.stringify({ from: from(), to: message.to, subject: message.subject, text: message.text }),
  });
  return response.ok;
}

async function writeToOutbox(message: Message): Promise<SendResult> {
  try {
    await mkdir(OUTBOX, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.txt`;
    const body = [`To: ${message.to}`, `From: ${from()}`, `Subject: ${message.subject}`, '', message.text, ''];
    await writeFile(path.join(OUTBOX, name), body.join('\n'), 'utf8');
    return { ok: true, via: 'outbox' };
  } catch {
    return { ok: false, reason: 'refused' };
  }
}
