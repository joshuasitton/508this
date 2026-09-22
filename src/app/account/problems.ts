/**
 * The sentence for whatever came back on the query string.
 *
 * Separate from `actions.ts` because that file is `'use server'` and may
 * export nothing but async functions — and separate from the domain because
 * the encoding (`password:too-short`) is this route's business and nobody
 * else's. Every sentence it returns comes from the domain; this only picks
 * which one.
 */

import {
  SIGN_IN_FAILED,
  describeEmailProblem,
  describePasswordProblem,
  type EmailProblem,
  type PasswordProblem,
} from '@/domain/account';
import { describeResetProblem } from '@/domain/reset';

const EMAIL = new Set<string>(['missing', 'malformed', 'too-long']);
const PASSWORD = new Set<string>(['missing', 'too-short', 'too-long', 'guessable', 'is-the-email']);

export function describeProblem(problem: string | undefined): string | null {
  if (!problem) return null;
  const [kind, rest = ''] = problem.split(':');

  if (kind === 'no') return SIGN_IN_FAILED;
  if (problem === 'reset-done') {
    return 'Your passphrase has been changed and every other session has been signed out. Sign in with the new one.';
  }
  if (kind === 'reset') {
    if (rest === 'bad-password') return describePasswordProblem('too-short');
    if (rest === 'used' || rest === 'expired' || rest === 'unknown') return describeResetProblem(rest);
    return null;
  }
  if (kind === 'locked') {
    const minutes = Number(rest);
    const count = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 15;
    return `Too many failed attempts. This account is not answering for another ${count} ${count === 1 ? 'minute' : 'minutes'}.`;
  }
  // Checked against the known sets rather than cast, because the query
  // string is whatever a stranger typed into the address bar.
  if (kind === 'email' && EMAIL.has(rest)) return describeEmailProblem(rest as EmailProblem);
  if (kind === 'password' && PASSWORD.has(rest)) return describePasswordProblem(rest as PasswordProblem);
  return null;
}
