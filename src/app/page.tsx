import Link from 'next/link';

import { COVERAGE, CRITERIA, DOCUMENT_EXEMPT, type Coverage, type Principle } from '@/domain/criteria';
import styles from './page.module.css';

const PRINCIPLES: Principle[] = ['Perceivable', 'Operable', 'Understandable', 'Robust'];

/**
 * Who does the work on a criterion, said in the customer's terms rather than
 * the code's. `static` is the one that needs translating: it does not mean
 * "skipped", it means there is nothing in a document of this format that the
 * criterion could govern — no audio to caption, no keyboard to trap.
 */
const WHO: Record<Coverage, { label: string; badge: string }> = {
  checked: { label: 'By machine', badge: 'badge badge-pass' },
  static: { label: 'Nothing to check', badge: 'badge badge-off' },
  reviewer: { label: 'By a person', badge: 'badge badge-wait' },
};

const EXEMPT = { label: 'E205.4', badge: 'badge badge-off' };

function who(id: string, format: 'docx' | 'pdf') {
  if (DOCUMENT_EXEMPT.has(id)) return EXEMPT;
  const coverage = COVERAGE[format][id];
  return coverage ? WHO[coverage.coverage] : EXEMPT;
}

/** How many of the criteria a document owes are settled without a person. */
function tally(format: 'docx' | 'pdf') {
  const owed = CRITERIA.filter((c) => !DOCUMENT_EXEMPT.has(c.id));
  const reviewer = owed.filter((c) => COVERAGE[format][c.id]?.coverage === 'reviewer');
  return { owed: owed.length, reviewer: reviewer.length, settled: owed.length - reviewer.length };
}

/**
 * The landing page renders the catalogue straight from the domain. That is
 * partly so it is true – the list a customer reads is the list the report is
 * built from – and partly to prove, on the first page, that the domain layer
 * has no idea React exists.
 *
 * The counts in the hero are computed the same way, for the same reason. A
 * landing page that advertises a number the product does not actually hit is
 * the easiest lie in software to tell by accident, and the only defence is to
 * make the marketing read from the source.
 */
export default function Home() {
  const pdf = tally('pdf');
  const docx = tally('docx');

  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div>
          <p className={styles.eyebrow}>
            Revised Section 508 <span aria-hidden="true">·</span> WCAG 2.0 Level A and AA
          </p>
          <h1 id="hero-title">Send us the document. Get it back conformant.</h1>
          <p className={styles.lede}>
            508This remediates PDF, Word and PowerPoint documents to the Revised Section 508 Standards and returns
            them with an Accessibility Conformance Report you can hand to a federal buyer.
          </p>
          <p className={styles.ctas}>
            <Link href="/start" className="btn btn-primary">
              Start a remediation
            </Link>
            <Link href="#catalogue-title" className="btn btn-quiet">
              See what gets checked
            </Link>
          </p>
          <p className={styles.reassure}>
            The assessment is free. You see every issue in your document, and what it would cost to fix, before you
            pay anything.
          </p>
        </div>

        {/*
         * The right-hand card is the argument, not decoration: these are the
         * real counts out of `criteria.ts`, so the claim on the landing page
         * and the claim in the report are the same claim.
         */}
        <aside className={`${styles.proof} card`} aria-labelledby="proof-title">
          <h2 id="proof-title" className={styles.proofTitle}>
            What a PDF is measured against
          </h2>
          <dl className={styles.proofStats}>
            {(
              [
                ['In WCAG 2.0 Level A and AA', CRITERIA.length],
                ['A document owes, after E205.4', pdf.owed],
                ['Settled without a person', pdf.settled],
                ['A reviewer decides, and signs', pdf.reviewer],
              ] as const
            ).map(([label, count]) => (
              <div key={label} className={styles.proofRow}>
                <dt>{label}</dt>
                <dd className="stat-value">{count}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.proofNote}>
            A Word file is the same arithmetic: {docx.reviewer} criteria need a person, {docx.settled} do not. Nothing
            is marked conformant because a machine could not see it.
          </p>
        </aside>
      </section>

      <section className={styles.how} aria-labelledby="how-title">
        <h2 id="how-title" className={styles.sectionTitle}>
          How it goes
        </h2>
        <ol className={styles.steps}>
          <li className={`${styles.step} card`}>
            <p className={styles.stepNumber} aria-hidden="true">
              1
            </p>
            <h3 className={styles.stepTitle}>Send the document</h3>
            <p className={styles.stepBody}>
              One file. It is read, not stored anywhere else, and it is encrypted the moment it lands.
            </p>
          </li>
          <li className={`${styles.step} card`}>
            <p className={styles.stepNumber} aria-hidden="true">
              2
            </p>
            <h3 className={styles.stepTitle}>Read the assessment</h3>
            <p className={styles.stepBody}>
              Every issue, which criterion it touches, and an honest sentence about whether this service can fix it.
              Free, always.
            </p>
          </li>
          <li className={`${styles.step} card`}>
            <p className={styles.stepNumber} aria-hidden="true">
              3
            </p>
            <h3 className={styles.stepTitle}>Get the file and the report</h3>
            <p className={styles.stepBody}>
              The remediated document, and a conformance report a named reviewer has attested — as a web page and as
              the Word file a contracting officer files.
            </p>
          </li>
        </ol>
      </section>

      <section className={styles.catalogue} aria-labelledby="catalogue-title">
        <h2 id="catalogue-title" className={styles.sectionTitle}>
          What conformant means
        </h2>
        <p className={styles.catalogueLede}>
          Section 508 incorporates WCAG 2.0 Level A and AA by reference: {CRITERIA.length} success criteria. Four of
          them are about navigating a set of web pages, and the standard exempts non-web documents from those. Here is
          the whole list, and who settles each one.
        </p>

        <p className={styles.legend}>
          <span className="badge badge-pass">By machine</span>
          <span className="badge badge-wait">By a person</span>
          <span className="badge badge-off">Nothing to check</span>
          <span className={styles.legendNote}>
            &ldquo;Nothing to check&rdquo; means the criterion has no subject in a document of that format — no audio
            to caption, no keyboard to trap. &ldquo;E205.4&rdquo; means the standard does not ask for it at all.
          </span>
        </p>

        {PRINCIPLES.map((principle) => (
          <div key={principle} className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.tableCaption}>{principle}</caption>
              <thead>
                <tr>
                  <th scope="col">Criterion</th>
                  <th scope="col">Level</th>
                  <th scope="col">Word</th>
                  <th scope="col">PDF</th>
                </tr>
              </thead>
              <tbody>
                {CRITERIA.filter((c) => c.principle === principle).map((c) => (
                  <tr key={c.id} className={DOCUMENT_EXEMPT.has(c.id) ? styles.exemptRow : undefined}>
                    <th scope="row" className={styles.criterion}>
                      <span className={`${styles.criterionId} mono`}>{c.id}</span> {c.name}
                    </th>
                    <td className={styles.level}>{c.level}</td>
                    <td>
                      <span className={who(c.id, 'docx').badge}>{who(c.id, 'docx').label}</span>
                    </td>
                    <td>
                      <span className={who(c.id, 'pdf').badge}>{who(c.id, 'pdf').label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <p className={styles.close}>
          <Link href="/start" className="btn btn-primary">
            Start a remediation
          </Link>
        </p>
      </section>
    </>
  );
}
