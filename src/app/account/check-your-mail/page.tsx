import type { Metadata } from 'next';
import Link from 'next/link';

import { transport } from '@/server/mail';
import styles from '../page.module.css';

export const metadata: Metadata = { title: 'Check your mail' };

/**
 * Where a sign-up lands when the account was not created — which today
 * means the address was already taken.
 *
 * This page is the cost of not telling a stranger who has an account here.
 * A form that answers "that address is taken" is a tool for enumerating
 * 508This's customers, and they are federal contractors; the only channel
 * that can safely tell the truth is the address itself.
 *
 * That channel now exists, so the page no longer has to apologise for a
 * message that was never coming. What it will not do is claim more than the
 * server can deliver: if this build has no mail transport it says so, in
 * those words, rather than leaving somebody refreshing an inbox.
 */
export default function CheckYourMail() {
  const via = transport();

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
      {via === 'outbox' && (
        <p className={styles.note}>
          <strong>Development build:</strong> no mail went anywhere. The letter was written to{' '}
          <code>accounts/outbox/</code> on this machine.
        </p>
      )}
      {via === 'none' && (
        <p className={styles.note}>
          <strong>This server cannot send mail.</strong> No letter went out, so if the address already had an
          account nobody has been told. That is a fault in the service and it is worth telling somebody about.
        </p>
      )}
      <p className={styles.note}>
        If you already had an account and have forgotten the passphrase, the letter has a reset link in it — or{' '}
        <Link href="/account/forgot">ask for one here</Link>. If you did not, you can{' '}
        <Link href="/account/sign-in">sign in</Link> once the account is set up.
      </p>
    </>
  );
}
