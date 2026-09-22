import type { Metadata } from 'next';
import Link from 'next/link';

import styles from '../page.module.css';

export const metadata: Metadata = { title: 'Check your mail' };

/**
 * Where a sign-up lands when the account was not created — which today
 * means the address was already taken.
 *
 * This page is the cost of not telling a stranger who has an account here.
 * A form that answers "that address is taken" is a tool for enumerating
 * 508This's customers, and they are federal contractors; the only channel
 * that can safely tell the truth is the address itself. **508This cannot
 * send mail yet**, so this page says plainly that the message it describes
 * has not arrived, rather than leaving somebody waiting for one. It is an
 * honest dead end and it is temporary.
 */
export default function CheckYourMail() {
  return (
    <>
      <h1>Check your mail</h1>
      <p className={styles.lede}>
        If that address can have an account, there is now a message on the way to it.
      </p>
      <p className={styles.note}>
        We answer this the same way whether or not the address already had an account, because a form that says
        &ldquo;that one is taken&rdquo; is a way of finding out who our customers are. The address itself is the
        only place it is safe to say which.
      </p>
      <p className={styles.note}>
        <strong>Being straight with you: 508This cannot send mail yet</strong>, so no message is actually on its
        way. If you already had an account, <Link href="/account/sign-in">sign in</Link>. If you did not, this is a
        dead end until the mail channel is built, and it is the next thing after this.
      </p>
    </>
  );
}
