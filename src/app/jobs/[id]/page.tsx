import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DOCUMENT_EXEMPT, labelFor } from '@/domain/criteria';
import { assessAll, describeRemarks, describeSummary, summarise, type Finding } from '@/domain/findings';
import { describeStatus } from '@/domain/job';
import { groupByKind } from '@/domain/kinds';
import { getJob } from '@/server/jobs';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Report' };

/**
 * The job page is the conformance report, before and after remediation, in
 * the order a customer asks the questions: does it conform, what is wrong,
 * why does that matter, what happens now. Every sentence on it comes from
 * the domain – the verdict, the group titles and explanations, the remarks –
 * so this page and the delivered report cannot say different things.
 *
 * The criteria the document already meets are still on the page, under a
 * disclosure, because the report is a claim about all 34 and a buyer may
 * want to see the ones that pass. They are not the news, so they are not
 * first.
 */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  const summary = summarise(job.findings, 'document');
  const verdict = describeSummary(summary);
  const groups = groupByKind(job.findings);
  const assessments = assessAll(job.findings, 'document');
  const short = assessments.filter((a) => a.status === 'Partially Supports' || a.status === 'Does Not Support');
  const met = assessments.filter((a) => a.status === 'Supports');
  const exempt = [...DOCUMENT_EXEMPT].map(labelFor);

  return (
    <>
      <p className={styles.kicker}>Report for</p>
      <h1 className={styles.title}>{job.filename}</h1>
      <p className={styles.status}>{describeStatus(job.status)}</p>

      <section className={summary.conforms ? styles.verdictGood : styles.verdict} aria-labelledby="verdict-title">
        <h2 id="verdict-title" className={styles.verdictTitle}>
          {verdict.headline}
        </h2>
        <p className={styles.verdictDetail}>{verdict.detail}</p>
      </section>

      {groups.length > 0 && (
        <section aria-labelledby="found-title">
          <h2 id="found-title">What we found</h2>
          {groups.map((g) => (
            <article key={g.kind} className={styles.group} aria-labelledby={`group-${g.kind}`}>
              <h3 id={`group-${g.kind}`} className={styles.groupTitle}>
                {g.info.title}
              </h3>
              <p className={styles.count}>
                {g.open === 0
                  ? 'All fixed'
                  : `${g.open} ${g.open === 1 ? 'place' : 'places'} to fix${g.blocking ? ', blocking' : ''}`}
              </p>
              <p className={styles.why}>{g.info.why}</p>
              <ul className={styles.places}>
                {g.findings.map((f, i) => (
                  <li key={i} className={f.remediated ? styles.placeFixed : styles.place}>
                    <span className={styles.state}>{stateOf(f)}</span>
                    <span className={styles.placeBody}>
                      <strong>{capitalise(f.location)}</strong>
                      <span className={styles.description}>{f.description}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className={styles.fix}>
                <strong>What we do.</strong> {g.info.fix}
              </p>
            </article>
          ))}
        </section>
      )}

      <section aria-labelledby="report-title">
        <h2 id="report-title">Conformance by criterion</h2>
        <p className={styles.note}>
          Section 508 scores a document against {summary.owed} criteria. The {short.length === 0 ? 'none' : short.length}{' '}
          {short.length === 1 ? 'it falls short on is' : 'it falls short on are'} listed first, in the wording a federal
          buyer expects; the rest it already meets.
        </p>
        {short.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">Conformance</th>
                <th scope="col">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {short.map((a) => (
                <tr key={a.criterion}>
                  <th scope="row">{labelFor(a.criterion)}</th>
                  <td className={styles.nowrap}>{a.status}</td>
                  <td>{describeRemarks(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <details className={styles.details}>
          <summary>
            {met.length} {met.length === 1 ? 'criterion' : 'criteria'} the document already meets
          </summary>
          <ul className={styles.metList}>
            {met.map((a) => (
              <li key={a.criterion}>
                {labelFor(a.criterion)} <span className={styles.muted}>Supports</span>
              </li>
            ))}
          </ul>
        </details>
        <p className={styles.footnote}>
          Four criteria are about navigating a set of web pages and do not apply to documents (E205.4):{' '}
          {exempt.join('; ')}.
        </p>
      </section>

      <section aria-labelledby="next-title">
        <h2 id="next-title">What happens next</h2>
        <ol className={styles.next}>
          <li>Each issue above goes to a reviewer, who confirms the fix before anything in the document changes.</li>
          <li>
            You get back the fixed document, a tagged PDF of it, and this report as an Accessibility Conformance
            Report.
          </li>
        </ol>
      </section>
    </>
  );
}

function stateOf(f: Finding): string {
  if (f.remediated) return 'Fixed';
  return f.severity === 'blocking' ? 'Blocking' : 'Open';
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
