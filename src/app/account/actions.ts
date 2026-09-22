'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { checkEmail, checkPassword } from '@/domain/account';
import { minutesLeft } from '@/domain/session';
import { authenticate, createAccount } from '@/server/accounts';
import { origin } from '@/server/origin';
import { consume, request, tellTaken } from '@/server/resets';
import { claimJobs } from '@/server/jobs';
import { COOKIE, COOKIE_OPTIONS, endSession, startSession } from '@/server/sessions';
import { VISITOR_COOKIE, visitorDigest } from '@/server/access';

/**
 * Sign in, sign up, sign out.
 *
 * Two rules run through all of it. Nothing here tells anybody whether an
 * address has an account: a failed sign-in gets `SIGN_IN_FAILED` whatever
 * went wrong, and a sign-up against an address already taken is answered
 * exactly as a successful one is. The second is uncomfortable and it is
 * correct — a form that says "that address already has an account" is a
 * tool for finding out who 508This's customers are, and they are federal
 * contractors. The person who really owns the address finds out by mail;
 * that channel does not exist yet, and until it does the page says so.
 *
 * Nothing about a passphrase reaches a log, an error or a redirect. The
 * only thing that travels back to the form is a code naming which sentence
 * to show.
 */

function back(where: 'in' | 'up', problem: string, email?: string): never {
  const query = new URLSearchParams({ problem });
  // The address is carried back so the person does not retype it. The
  // passphrase is not, and there is no branch here where it could be.
  if (email) query.set('email', email);
  redirect(`/account/sign-${where}?${query}`);
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const result = await authenticate(email, password);
  if (!result.ok) {
    if (result.reason === 'locked') back('in', `locked:${minutesLeft(result.until, Date.now())}`, email);
    back('in', 'no', email);
  }

  await establish(result.account.id);
  redirect('/');
}

export async function signUpAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const emailCheck = checkEmail(email);
  if (!emailCheck.ok) back('up', `email:${emailCheck.reason}`, email);
  const passwordCheck = checkPassword(password, emailCheck.email);
  if (!passwordCheck.ok) back('up', `password:${passwordCheck.reason}`, email);

  const made = await createAccount(email, password);
  if (!made.ok) {
    // The address is already in use. The person at the form is told what a
    // successful sign-up is told; the person who owns the address is told
    // the truth, on the address, which is the only channel where that is
    // safe. `tellTaken` answers the same way whether or not it worked.
    if (made.reason === 'taken') await tellTaken(email, origin());
    if (made.reason === 'taken') redirect('/account/check-your-mail');
    // The form already checked these, so reaching here means the two checks
    // disagree — which is a bug, and is shown rather than swallowed.
    back('up', made.reason === 'bad-email' ? 'email:malformed' : 'password:too-short', email);
  }

  await establish(made.account.id);
  redirect('/');
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  await endSession(jar.get(COOKIE)?.value);
  jar.delete(COOKIE);
  redirect('/');
}

/**
 * Start the session and bring this browser's earlier uploads with it.
 *
 * The claim happens here, at the one moment both facts are in hand: which
 * browser this is, and which account it just became. A signed-in person can
 * already *see* a job their own browser uploaded, so nothing breaks if the
 * claim does not happen — but the cookie expires in thirty days and the
 * account does not.
 */
async function establish(account: string): Promise<void> {
  const jar = await cookies();
  const visitor = jar.get(VISITOR_COOKIE)?.value;
  if (visitor) await claimJobs(visitorDigest(visitor), account);
  jar.set(COOKIE, await startSession(account), COOKIE_OPTIONS);
}


/**
 * Ask for a reset link. Always redirects to the same page with the same
 * sentence: "sent", "no such account" and "mail is down" are three
 * different answers, and three different answers is a way to find out which
 * addresses have accounts here.
 */
export async function forgotAction(formData: FormData): Promise<void> {
  await request(String(formData.get('email') ?? ''), origin());
  redirect('/account/forgot?sent=1');
}

/**
 * Spend a link and set the new passphrase. The token travels in the form
 * rather than being read again from the URL, so that what is spent is the
 * link the person actually opened.
 */
export async function resetAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');

  const result = await consume(token, password);
  if (result.ok) redirect('/account/sign-in?problem=reset-done');

  const query = new URLSearchParams({ problem: `reset:${result.reason}` });
  // The token goes back only when the link is still worth another go. A
  // spent or expired one is not, and putting it back in the URL would
  // invite somebody to keep trying it.
  if (result.reason === 'bad-password') query.set('token', token);
  redirect(`/account/reset?${query}`);
}
