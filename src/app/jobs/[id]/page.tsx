import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { assessAll, describeAssessment, describeFinding, progress } from '@/domain/findings';
import { describeStatus } from '@/domain/job';
import { getJob } from '@/server/jobs';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Job' };

/**
 * The job page is the conformance report, before and after remediation.
 * The same functions that will fill the delivered Accessibility Conformance
 * Report render this page, so what the customer sees on screen and what
 * they hand to a buyer cannot say different things.
 */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  const done = progress(job.findings);
  const open = job.findings.filter((f) => !f.remediated);
  const assessments = assessAll(job.findings, 'document');
  const owed = assessments.filter((a) => a.status !== 'Not Applicable');

  return (
    <>
      <h1>{job.filename}</h1>
      <p className={styles.status}>{describeStatus(job.status)}</p>

      <section aria-labelledby="findings-title">
        <h2 id="findings-title">
          {open.length === 0 ? 'No open issues' : `${open.length} open ${open.length === 1 ? 'issue' : 'issues'}`}
        </h2>
        <p className={styles.progress}>
          {done.remediated} of {done.total} fixed.
        </p>
        {job.findings.length > 0 && (
          <ol className={styles.findings}>
            {job.findings.map((f, i) => (
              <li key={i} className={f.remediated ? styles.fixed : undefined}>
                {describeFinding(f)}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="report-title">
        <h2 id="report-title">Conformance report</h2>
        <p className={styles.note}>
          Every criterion this document owes under Section 508, as it stands now. The four criteria the standard
          exempts for documents are omitted.
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">Conformance</th>
            </tr>
          </thead>
          <tbody>
            {owed.map((a) => (
              <tr key={a.criterion}>
                <th scope="row">{describeAssessment(a)}</th>
                <td>{a.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
