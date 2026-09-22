import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { getAccount } from '@/server/accounts';
import { viewer } from '@/server/access';
import { signOutAction } from './account/actions';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '508This',
    template: '%s – 508This',
  },
  description:
    'Section 508 remediation. Send a PDF, Word or PowerPoint document; get back one that conforms, with the report to prove it.',
};

/**
 * The skip link is the first focusable thing on every page. It is WCAG 2.0
 * 2.4.1 Bypass Blocks, which the product's own site owes even though the
 * documents it remediates do not (E205.4). A remediation service that fails
 * its own first criterion has nothing to sell.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Who is signed in, for the header. A visitor is not named here: there is
  // nothing to name, and "signed in as a cookie" would be a claim about
  // identity that a cookie cannot support.
  const who = await viewer();
  const account = who.kind === 'account' ? await getAccount(who.account) : null;

  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <header className="site-header">
          <Link className="wordmark" href="/" aria-label="508This home">
            508This
          </Link>
          <nav className="site-nav" aria-label="Account">
            {account ? (
              <>
                <span className="site-who">{account.email}</span>
                <form action={signOutAction}>
                  <button type="submit" className="site-link">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link href="/account/sign-in">Sign in</Link>
                <Link href="/account/sign-up">Create an account</Link>
              </>
            )}
          </nav>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <p>
            Conformance is measured against the Revised Section 508 Standards, which incorporate WCAG 2.0 Level A and
            AA.
          </p>
        </footer>
      </body>
    </html>
  );
}
