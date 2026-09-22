'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { checkEmail, checkPassword } from '@/domain/account';
import { minutesLeft } from '@/domain/session';
import { authenticate, createAccount } from '@/server/accounts';
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
    // `taken` lands here with the others and is deliberately not told
    // apart: see the note at the top of this file.
    redirect('/account/check-your-mail');
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
