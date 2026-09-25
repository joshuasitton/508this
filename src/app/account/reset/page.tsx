import type { Metadata } from 'next';
import Link from 'next/link';

import { MAX_PASSWORD, MIN_PASSWORD } from '@/domain/account';
import { describeResetProblem } from '@/domain/reset';
import { inspect } from '@/server/resets';
import { resetAction } from '../actions';
import { describeProblem } from '../problems';
import styles from '../page.module.css';

export const metadata: Metadata = { title: 'Set a new passphrase' };

/**
 * The page a reset link opens.
 *
 * The link's state is checked before the form is drawn, so somebody holding
 * a spent or expired one is told so rather than typing a passphrase into a
 * box that was never going to work. Nothing here says whose account the
 * link belongs to: whoever is holding it already had it, and if they should
 * not have it, naming the account would be handing them the second half.
 */
export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; problem?: string }>;
}) {
  const { token, problem } = await searchParams;
  const state = await inspect(token ?? '');
  const message = describeProblem(problem);

  if (state !== 'good') {
    return (
      <div className={styles.page}>
        <h1>That link does not work</h1>
        <p className={styles.problem} role="alert">
          {describeResetProblem(state)}
        </p>
        <p className={styles.note}>
          <Link href="/account/forgot">Ask for another</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1>Set a new passphrase</h1>
      <p className={styles.lede}>
        This link works once. Using it signs you out of 508This everywhere else, which is the point of resetting.
      </p>

      {message && (
        <p className={styles.problem} role="alert">
          {message}
        </p>
      )}

      <form action={resetAction} className={styles.form}>
        <input type="hidden" name="token" value={token ?? ''} />

        <label className={styles.label} htmlFor="password">
          New passphrase
        </label>
        <p id="password-hint" className={styles.hint}>
          At least {MIN_PASSWORD} characters, up to {MAX_PASSWORD}. No capitals, digits or symbols are required and
          it never expires.
        </p>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-describedby="password-hint"
          required
          className={styles.field}
        />

        <button type="submit" className={styles.button}>
          Set it
        </button>
      </form>
    </div>
  );
}
