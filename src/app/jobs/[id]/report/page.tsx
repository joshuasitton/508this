import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CRITERIA, DOCUMENT_EXEMPT, labelFor } from '@/domain/criteria';
import { assessAll, describeRemarks, describeSummary, summarise } from '@/domain/findings';
import { getJob } from '@/server/jobs';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Conformance statement' };

const PRINCIPLES = ['Perceivable', 'Operable', 'Understandable', 'Robust'] as const;

/**
 * The conformance statement: one page, printable, in the layout of an
 * Accessibility Conformance Report. It says exactly what the job page says,
 * from the same functions, laid out the way a buyer reads it – every
 * criterion, its level, its conformance, its remark – with the honest
 * headline on top. A criterion that still waits on a reviewer says so in
 * its row; the statement never claims more than the record supports.
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  const confirmed = new Set(Object.keys(job.confirmations ?? {}));
  const summary = summarise(job.findings, 'document', confirmed);
  const verdict = describeSummary(summary);
  const byId = new Map(assessAll(job.findings, 'document', confirmed).map((a) => [a.criterion, a]));
  const fixed = job.findings.filter((f) => f.remediated).length;
  const date = new Date(job.remediatedAt ?? job.createdAt);

  return (
    <article className={styles.report}>
      <p className={styles.tools}>
        <Link href={`/jobs/${job.id}`}>Back to the job</Link>
      </p>
      <header className={styles.head}>
        <p className={styles.kicker}>Section 508 conformance statement</p>
        <h1 className={styles.title}>{job.filename}</h1>
        <dl className={styles.meta}>
          <dt>Standard</dt>
          <dd>Revised Section 508 Standards (36 CFR Part 1194), incorporating WCAG 2.0 Level A and AA</dd>
          <dt>Content</dt>
          <dd>Non-web document (Word)</dd>
          <dt>Evaluated</dt>
          <dd>{date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
          {job.reviewer && (
            <>
              <dt>Reviewer</dt>
              <dd>{job.reviewer}</dd>
            </>
          )}
          <dt>Method</dt>
          <dd>
            508This automated checks on the document as delivered
            {job.remediatedAt ? `, after remediation of ${fixed} ${fixed === 1 ? 'issue' : 'issues'}` : ''}
            {summary.review > 0 ? '; reviewer confirmation outstanding where stated' : `; confirmed by ${job.reviewer ?? 'the reviewer'} where stated`}
          </dd>
        </dl>
      </header>

      <section className={styles.verdict} aria-labelledby="statement">
        <h2 id="statement">{verdict.headline}</h2>
        <p>{verdict.detail}</p>
      </section>

      {PRINCIPLES.map((principle) => (
        <table key={principle} className={styles.table}>
          <caption>{principle}</caption>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">Level</th>
              <th scope="col">Conformance</th>
              <th scope="col">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {CRITERIA.filter((c) => c.principle === principle).map((c) => {
              const a = byId.get(c.id)!;
              return (
                <tr key={c.id} className={a.status === 'Needs Review' ? styles.review : undefined}>
                  <th scope="row">{labelFor(c.id)}</th>
                  <td>{c.level}</td>
                  <td className={styles.nowrap}>{a.status}</td>
                  <td>{describeRemarks(a)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}

      <p className={styles.footnote}>
        Under E205.4, non-web documents are not required to meet {[...DOCUMENT_EXEMPT].map(labelFor).join('; ')}.
        “Needs Review” is not a conformance level; it marks a criterion this statement does not yet vouch for.
      </p>
    </article>
  );
}
