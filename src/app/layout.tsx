import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
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
export default function RootLayout({ children }: { children: ReactNode }) {
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
