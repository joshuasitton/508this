import type { Metadata } from 'next';
import Link from 'next/link';

import { MAX_PASSWORD, MIN_PASSWORD } from '@/domain/account';
import { signUpAction } from '../actions';
import { describeProblem } from '../problems';
import styles from '../page.module.css';

export const metadata: Metadata = { title: 'Create an account' };

/**
 * The passphrase rules are stated on the page rather than enforced by a
 * strength meter that nobody believes. What they amount to is length: no
 * mixed case, no digit, no symbol, no expiry. Saying so is part of the
 * point — a person who has been trained to produce `Summer2026!` needs to
 * be told that four ordinary words is both allowed and better.
 */
export default async function SignUp({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string; email?: string }>;
}) {
  const { problem, email } = await searchParams;
  const message = describeProblem(problem);

  return (
    <>
      <h1>Create an account</h1>
      <p className={styles.lede}>
        Anything you have already uploaded in this browser comes with you. Nothing about those documents is sent
        anywhere by signing up.
      </p>

      {message && (
        <p className={styles.problem} role="alert">
          {message}
        </p>
      )}

      <form action={signUpAction} className={styles.form}>
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
        <p id="password-hint" className={styles.hint}>
          At least {MIN_PASSWORD} characters, up to {MAX_PASSWORD}. No capitals, digits or symbols are required and
          it never expires: four words you will remember beats eight characters you will not.
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
          Create the account
        </button>
      </form>

      <p className={styles.note}>
        Already have one? <Link href="/account/sign-in">Sign in</Link>.
      </p>
    </>
  );
}
