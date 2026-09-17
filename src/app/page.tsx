import Link from 'next/link';

import { CRITERIA, DOCUMENT_EXEMPT, type Principle } from '@/domain/criteria';
import styles from './page.module.css';

const PRINCIPLES: Principle[] = ['Perceivable', 'Operable', 'Understandable', 'Robust'];

/**
 * The landing page renders the catalogue straight from the domain. That is
 * partly so it is true – the list a customer reads is the list the report is
 * built from – and partly to prove, on the first page, that the domain layer
 * has no idea React exists.
 */
export default function Home() {
  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-title">
        <h1 id="hero-title">Send us the document. Get it back conformant.</h1>
        <p className={styles.lede}>
          508This remediates PDF, Word and PowerPoint documents to the Revised Section 508 Standards and returns
          them with an Accessibility Conformance Report you can hand to a federal buyer.
        </p>
        <Link href="/start" className={styles.cta}>
          Start a remediation
        </Link>
      </section>

      <section className={styles.catalogue} aria-labelledby="catalogue-title">
        <h2 id="catalogue-title">What conformant means</h2>
        <p>
          Section 508 incorporates WCAG 2.0 Level A and AA by reference: {CRITERIA.length} success criteria. Four
          of them are about navigating a set of web pages, and the standard exempts non-web documents from those.
          They are marked below.
        </p>
        {PRINCIPLES.map((principle) => (
          <table key={principle} className={styles.table}>
            <caption>{principle}</caption>
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">Level</th>
                <th scope="col">Applies to documents</th>
              </tr>
            </thead>
            <tbody>
              {CRITERIA.filter((c) => c.principle === principle).map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    {c.id} {c.name}
                  </th>
                  <td>{c.level}</td>
                  <td>{DOCUMENT_EXEMPT.has(c.id) ? 'No – E205.4 exception' : 'Yes'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </section>
    </>
  );
}
