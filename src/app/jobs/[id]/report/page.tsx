import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { COLUMNS, buildAcr } from '@/domain/acr';
import { openJob } from '@/server/access';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Conformance statement' };

/**
 * The conformance statement on screen: one page, printable, in the layout of
 * an Accessibility Conformance Report.
 *
 * Every word on it comes from `buildAcr`, which is also the whole of what
 * goes into the Word file. The page decides nothing — not a status, not a
 * remark, not the date — because the customer will hand the file to a
 * contracting officer and read the page themselves, and the two saying
 * different things about the same document is the failure this product
 * cannot survive.
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await openJob(id);
  if (!job) notFound();
  const acr = buildAcr(job);

  return (
    <article className={styles.report}>
      <p className={styles.tools}>
        <Link href={`/jobs/${job.id}`}>Back to the job</Link>
        {' · '}
        <a href={`/jobs/${job.id}/report/download`}>Download this statement as a Word file</a>
      </p>
      <header className={styles.head}>
        <p className={styles.kicker}>Section 508 conformance statement</p>
        <h1 className={styles.title}>{acr.filename}</h1>
        {!acr.complete && (
          <p className={styles.draft}>
            <strong>Draft — not a deliverable.</strong> {acr.pending}{' '}
            {acr.pending === 1 ? 'criterion has' : 'criteria have'} not yet been confirmed by a reviewer.
          </p>
        )}
        <dl className={styles.meta}>
          {acr.facts.map((fact) => (
            <Fragment key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </Fragment>
          ))}
        </dl>
      </header>

      <section className={styles.verdict} aria-labelledby="statement">
        <h2 id="statement">{acr.verdict.headline}</h2>
        <p>{acr.verdict.detail}</p>
      </section>

      {acr.sections.map((section) => (
        <table key={section.principle} className={styles.table}>
          <caption>{section.principle}</caption>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.criterion} className={row.pending ? styles.review : undefined}>
                <th scope="row">{row.label}</th>
                <td>{row.level}</td>
                <td className={styles.nowrap}>{row.status}</td>
                <td>{row.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      {acr.notes.map((note) => (
        <p key={note} className={styles.footnote}>
          {note}
        </p>
      ))}
    </article>
  );
}
