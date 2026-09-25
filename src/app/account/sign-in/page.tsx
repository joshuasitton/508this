import type { Metadata } from 'next';
import Link from 'next/link';

import { MIN_PASSWORD } from '@/domain/account';
import { signInAction } from '../actions';
import { describeProblem } from '../problems';
import styles from '../page.module.css';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Two fields and no JavaScript, like every other form here: the browser
 * posts, the action redirects, and anything that went wrong comes back as a
 * query parameter rendered in a live region.
 *
 * `autocomplete` is set on both fields because a password manager is the
 * single biggest improvement available to a person's passphrase, and a form
 * that fights one is a form that talks people into typing something they
 * can remember.
 */
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string; email?: string }>;
}) {
  const { problem, email } = await searchParams;
  const message = describeProblem(problem);

  return (
    <div className={styles.page}>
      <h1>Sign in</h1>
      <p className={styles.lede}>
        An account is what puts a name on a conformance statement, and what a document marked Controlled
        Unclassified Information needs before it can be uploaded at all.
      </p>

      {message && (
        <p className={styles.problem} role="alert">
          {message}
        </p>
      )}

      <form action={signInAction} className={styles.form}>
        <label className={styles.label} htmlFor="email">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={email ?? ''}
          required
          className={styles.field}
        />

        <label className={styles.label} htmlFor="password">
          Passphrase
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={styles.field}
        />

        <button type="submit" className={styles.button}>
          Sign in
        </button>
      </form>

      <p className={styles.note}>
        No account yet? <Link href="/account/sign-up">Create one</Link>. A passphrase is at least {MIN_PASSWORD}{' '}
        characters and nothing else is required of it.
      </p>
      <p className={styles.note}>
        <Link href="/account/forgot">Forgotten your passphrase?</Link>
      </p>
    </div>
  );
}
