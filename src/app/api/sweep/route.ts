import { timingSafeEqual } from 'node:crypto';

import { sweepExpired } from '@/server/jobs';

/**
 * The retention sweep, on a schedule.
 *
 * `sweepExpired` has existed and been tested since retention was decided;
 * nothing called it. That made "documents are deleted seven days after you
 * download them" true of the code and false of the service — the worst
 * shape for a promise to be in, because it reads as kept.
 *
 * A Vercel cron hits this once a day. Daily rather than hourly because the
 * promise is measured in days: an hourly sweep would delete a document
 * within an hour of its deadline instead of within a day of it, and buy
 * twenty-three extra runs to do it.
 *
 * ## Who may call it
 *
 * Deleting customer documents is not something an anonymous request may
 * start. Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled
 * invocations; this accepts that and nothing else, compared in constant
 * time. **With no `CRON_SECRET` set the route refuses every request**,
 * including in development — an unprotected deletion endpoint that works is
 * worse than one that does not, because only the second gets noticed.
 *
 * ## What it answers with
 *
 * A count. `sweepExpired` returns the job ids it swept, and a job id names a
 * customer's document — putting them in a response body puts them in
 * whatever logs the response. The count is what a person checking the cron
 * needs and is not about any document in particular.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response('Not found', { status: 404 });

  const offered = request.headers.get('authorization') ?? '';
  if (!matches(offered, `Bearer ${secret}`)) return new Response('Not found', { status: 404 });

  const swept = await sweepExpired();
  return new Response(JSON.stringify({ swept: swept.length }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Constant time, and length-safe. `timingSafeEqual` throws on a length
 * mismatch, which would otherwise be a way to learn the secret's length one
 * request at a time.
 */
function matches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still spend the comparison, so a wrong length is not faster than a
    // wrong value.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
