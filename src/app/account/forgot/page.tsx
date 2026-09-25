import type { Metadata } from 'next';
import Link from 'next/link';

import { RESET_REQUESTED } from '@/domain/reset';
import { transport } from '@/server/mail';
import { forgotAction } from '../actions';
import styles from '../page.module.css';

export const metadata: Metadata = { title: 'Forgotten passphrase' };

/**
 * One field, and one answer whatever happens.
 *
 * "Sent", "no such account" and "mail is down" are three different answers,
 * and three different answers is a way for a stranger to find out which
 * addresses have accounts here. So the page says the same sentence every
 * time, and the audit log carries what really happened.
 *
 * The two notes below are the exception, and they are not an exception to
 * that rule: they say something about *this server* rather than about the
 * address, and a person who has just been told a letter is coming deserves
 * to know when the service cannot send one.
 */
export default async function Forgot({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  const via = transport();

  return (
    <div className={styles.page}>
      <h1>Forgotten passphrase</h1>

      {sent ? (
        <>
          <p className={styles.problem} role="status">
            {RESET_REQUESTED}
          </p>
          {via === 'outbox' && (
            <p className={styles.note}>
              <strong>Development build:</strong> no mail went anywhere. The letter was written to{' '}
              <code>accounts/outbox/</code> on this machine.
            </p>
          )}
          {via === 'none' && (
            <p className={styles.note}>
              <strong>This server cannot send mail.</strong> No letter went out. That is a fault in the service
              rather than anything you did, and it is worth telling somebody about.
            </p>
          )}
          <p className={styles.note}>
            <Link href="/account/sign-in">Back to sign in</Link>
          </p>
        </>
      ) : (
        <>
          <p className={styles.lede}>
            Give the address the account uses. If it has one, a link comes back that works once and lasts thirty
            minutes.
          </p>

          <form action={forgotAction} className={styles.form}>
            <label className={styles.label} htmlFor="email">
              Email address
            </label>
            <input id="email" name="email" type="email" autoComplete="username" required className={styles.field} />
            <button type="submit" className={styles.button}>
              Send a link
            </button>
          </form>

          <p className={styles.note}>
            We answer this the same way whether or not the address has an account, because a form that answers
            differently is a way of finding out who our customers are.
          </p>
        </>
      )}
    </div>
  );
}
