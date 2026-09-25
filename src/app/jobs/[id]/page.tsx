import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DOCUMENT_EXEMPT, labelFor } from '@/domain/criteria';
import { assessAll, describeRemarks, describeSummary, isOpen, stateOf, summarise } from '@/domain/findings';
import { describeStatus } from '@/domain/job';
import { groupByKind } from '@/domain/kinds';
import { describeSignInNeeded, mayReview } from '@/domain/viewer';
import { describeRetention } from '@/domain/retention';
import { encrypting } from '@/server/crypto';
import { storage } from '@/server/blobs';
import { describeScrub } from '@/domain/scrub';
import { bestOffer, describeOffer, labelFor as offerLabel, money, quoteAll, workFor } from '@/domain/pricing';
import { FIXABLE_KINDS } from '@/domain/remediate';
import { PDF_FIXABLE_KINDS } from '@/domain/pdfRemediate';
import { openJobFor } from '@/server/access';
import { remediateAction } from './actions';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Report' };

/**
 * The four states a finding can be in, and the four tints the palette has.
 * They line up one to one on purpose: "dismissed" is not a failure and should
 * not be red, and "open" is not yet a failure of the document — it is work
 * outstanding, which is what the waiting tint means everywhere else.
 */
const BADGE: Record<ReturnType<typeof stateOf>, string> = {
  Fixed: 'badge-pass',
  Dismissed: 'badge-off',
  Blocking: 'badge-fail',
  Open: 'badge-wait',
};



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
  const { job, who } = await openJobFor(id);
  if (!job) notFound();

  const confirmed = new Set(Object.keys(job.confirmations ?? {}));
  const summary = summarise(job.findings, job.format, confirmed);
  const verdict = describeSummary(summary);
  const groups = groupByKind(job.findings);
  const assessments = assessAll(job.findings, job.format, confirmed);
  const short = assessments.filter((a) => a.status === 'Partially Supports' || a.status === 'Does Not Support');
  const review = assessments.filter((a) => a.status === 'Needs Review');
  const met = assessments.filter((a) => a.status === 'Supports');
  const exempt = [...DOCUMENT_EXEMPT].map(labelFor);
  // Both formats have automatic remediation now; what each can fix differs,
  // so the count comes from that format's own list.
  const automatic = true;
  const canFix = job.format === 'pdf' ? PDF_FIXABLE_KINDS : (FIXABLE_KINDS as ReadonlySet<string>);
  const fixable = job.findings.filter((f) => !f.remediated && canFix.has(f.kind)).length;
  const signedIn = mayReview(who);
  const retention = describeRetention(job);
  const scrubbed = describeScrub(job);
  const work = workFor(job);
  const quotes = quoteAll(work);
  const best = bestOffer(work);

  return (
    <>
      <header className={styles.head}>
        <p className={styles.kicker}>Report for</p>
        <h1 className={styles.title}>{job.filename}</h1>
        <p className={styles.status}>{describeStatus(job.status)}</p>
      </header>

      <div className="layout">
        <div className={styles.column}>
          {/*
            The verdict states itself three ways — a badge, a headline and
            four counts — because it is the one thing on this page a customer
            came for, and because a sentence alone gave it no more weight than
            the footnote under it.
          */}
          <section
            className={`${summary.conforms ? styles.verdictGood : styles.verdict} card`}
            aria-labelledby="verdict-title"
          >
            <p className={summary.conforms ? 'badge badge-pass' : 'badge badge-fail'}>
              {summary.conforms ? 'Conforms' : 'Not yet'}
            </p>
            <h2 id="verdict-title" className={styles.verdictTitle}>
              {verdict.headline}
            </h2>
            <p className={styles.verdictDetail}>{verdict.detail}</p>
            <dl className={styles.verdictStats}>
              {(
                [
                  ['Criteria owed', summary.owed],
                  ['With open issues', summary.short],
                  ['Issues found', summary.blocking + summary.other],
                  ['Waiting on a reviewer', summary.review],
                ] as const
              ).map(([label, count]) => (
                <div key={label} className="stat">
                  <dt className="stat-label">{label}</dt>
                  <dd className="stat-value">{count}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles.offers} aria-labelledby="price-title">
            <h2 id="price-title" className={styles.sectionTitle}>
              What this costs
            </h2>
            <p className={styles.promise}>{quotes[0]?.available ? quotes[0].promise : null}</p>
            <ul className={styles.offerList}>
              {quotes.map((quote) => (
                <li key={quote.offer} className={`${quote.available ? styles.offer : styles.offerOut} card`}>
                  <h3 className={styles.offerTitle}>
                    {offerLabel(quote.offer)}
                    <span className={styles.price}>
                      {quote.available ? money(quote.cents) : 'Not sold for this document'}
                    </span>
                  </h3>
                  {quote.available ? (
                    <>
                      <p className={styles.offerBody}>{describeOffer(quote.offer)}</p>
                      {quote.lines.length > 1 && (
                        <p className={styles.muted}>
                          {quote.lines.map((l) => `${l.label} ${money(l.cents)}`).join(' + ')}
                        </p>
                      )}
                      {quote.caveat && <p className={styles.caveat}>{quote.caveat}</p>}
                    </>
                  ) : (
                    <p className={styles.offerBody}>{quote.because}</p>
                  )}
                </li>
              ))}
            </ul>
            <p className={styles.footnote}>
              {best === 'assessment'
                ? 'Nothing here is billable, and you have already had the part that is free.'
                : `Everything on this page is the free assessment. The ${offerLabel(best).toLowerCase()} is as far as this document can be taken, and nothing is charged until you ask for it.`}
            </p>
          </section>

          {groups.length > 0 && (
            <section aria-labelledby="found-title">
              <h2 id="found-title" className={styles.sectionTitle}>
                What we found
              </h2>
              {groups.map((g) => (
                <article key={g.kind} className={`${styles.group} card`} aria-labelledby={`group-${g.kind}`}>
                  <div className={styles.groupHead}>
                    <h3 id={`group-${g.kind}`} className={styles.groupTitle}>
                      {g.info.title}
                    </h3>
                    <p className={g.findings.filter(isOpen).length === 0 ? 'badge badge-pass' : g.blocking ? 'badge badge-fail' : 'badge badge-wait'}>
                      {g.findings.filter(isOpen).length === 0
                        ? 'All fixed or reviewed'
                        : `${g.findings.filter(isOpen).length} ${g.findings.filter(isOpen).length === 1 ? 'place' : 'places'} to fix${g.blocking ? ', blocking' : ''}`}
                    </p>
                  </div>
                  <p className={styles.why}>{g.info.why}</p>
                  <ul className={styles.places}>
                    {g.findings.map((f, i) => (
                      <li
                        key={i}
                        className={f.remediated || f.decision?.action === 'dismiss' ? styles.placeFixed : styles.place}
                      >
                        <span className={`badge ${BADGE[stateOf(f)]}`}>{stateOf(f)}</span>
                        <span className={styles.placeBody}>
                          <strong>{capitalise(f.location)}</strong>
                          <span className={styles.description}>{f.description}</span>
                          {f.decision?.action === 'dismiss' && (
                            <span className={styles.description}>
                              Reviewed by {f.decision.by}: {f.decision.note}
                            </span>
                          )}
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

          {job.applied && job.applied.length > 0 && (
            <details className={`${styles.details} card`}>
              <summary>
                What was changed ({job.applied.length} {job.applied.length === 1 ? 'change' : 'changes'})
              </summary>
              <ul className={styles.changes}>
                {job.applied.map((a, i) => (
                  <li key={i}>
                    <strong>{capitalise(a.location)}.</strong> {a.description}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <section aria-labelledby="report-title">
            <h2 id="report-title" className={styles.sectionTitle}>
              Conformance by criterion
            </h2>
            <p className={styles.note}>
              Section 508 scores a document against {summary.owed} criteria.{' '}
              {short.length === 0 ? 'None' : short.length} {short.length === 1 ? 'has' : 'have'} open issues
              {review.length > 0
                ? `, ${review.length} can only be confirmed by a reviewer, and the rest it already meets.`
                : ', and the rest it already meets.'}{' '}
              The full statement, criterion by criterion, is on the{' '}
              <Link href={`/jobs/${job.id}/report`}>conformance statement</Link>.
            </p>
            {short.length > 0 && (
              <div className={styles.tableWrap}>
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
                        <td className={styles.nowrap}>
                          <span className="badge badge-fail">{a.status}</span>
                        </td>
                        <td>{describeRemarks(a, job.format)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {review.length > 0 && (
              <details className={`${styles.details} card`}>
                <summary>
                  {review.length} {review.length === 1 ? 'criterion' : 'criteria'} waiting on a reviewer
                </summary>
                <ul className={styles.metList}>
                  {review.map((a) => (
                    <li key={a.criterion}>
                      {labelFor(a.criterion)}{' '}
                      <span className={styles.muted}>
                        {describeRemarks(a, job.format).replace(/^Waiting on a reviewer\.\s*/, '')}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <details className={`${styles.details} card`}>
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
            <h2 id="next-title" className={styles.sectionTitle}>
              What happens next
            </h2>
            <ol className={styles.next}>
              {!job.remediatedAt && (
                <li>Press the button in the panel. The issues with one right answer are fixed in the document.</li>
              )}
              <li>
                What is left goes to <Link href={`/jobs/${job.id}/review`}>the review queue</Link>, where a person
                decides each remaining finding and confirms the criteria only a person can judge.
              </li>
              <li>
                When nothing is open and nothing waits on a reviewer, the conformance statement says “Conforms to
                Section 508”, and not before.
              </li>
            </ol>
          </section>
        </div>

        {/*
          The rail carries what a customer does, not what they read. It stays
          on screen while they work down the findings, which is the whole
          reason the page has a second column: the old layout put the button
          at the top and then four screens of report between it and the
          evidence for pressing it.
        */}
        <aside className="rail">
          <section className={`${styles.railCard} card`} aria-labelledby="actions-title">
            <h2 id="actions-title" className={styles.railTitle}>
              {/* "Fix it" labels a button. With no button under it, it labels nothing. */}
              {!signedIn ? 'To fix it' : job.remediatedAt ? 'Your documents' : 'Fix it'}
            </h2>
            {/*
              A visitor gets the assessment and stops there. Everything below
              this line changes the document or produces a deliverable, which is
              the line pricing already draws and the line 800-171 needs drawn:
              a name on a conformance statement has to belong to somebody the
              service authenticated.
            */}
            {!signedIn && (
              <>
                <p className={styles.actionNote}>{describeSignInNeeded('review')}</p>
                <p className={styles.actionNote}>
                  <Link href="/account/sign-in">Sign in</Link> or{' '}
                  <Link href="/account/sign-up">create an account</Link> — this document comes with you, and nothing
                  about it is sent anywhere by signing up.
                </p>
              </>
            )}
            {signedIn && !job.remediatedAt && automatic && (
              <form action={remediateAction} className={styles.actionForm}>
                <input type="hidden" name="id" value={job.id} />
                <button type="submit" className="btn btn-primary" disabled={fixable === 0}>
                  Fix what can be fixed automatically
                </button>
                <p className={styles.actionNote}>
                  {fixable === 0
                    ? 'Nothing here can be fixed without a person. A reviewer takes it from here.'
                    : `${fixable} of the ${summary.blocking + summary.other} open ${summary.blocking + summary.other === 1 ? 'issue' : 'issues'} ${fixable === 1 ? 'has' : 'have'} one right answer and will be fixed in the document. The rest need a person. Nothing else in the document is changed.`}
                </p>
              </form>
            )}
            {signedIn && job.remediatedAt && !job.deleteAfter && (
              <p className={styles.warn}>
                <strong>Downloading the remediated document starts the seven-day countdown to deletion</strong>, and
                takes the quotations from your document out of this report. If you want the conformance statement
                with those quotations in it, take that first.
              </p>
            )}
            {signedIn && job.remediatedAt && (
              <ul className={styles.downloads}>
                <li>
                  <a href={`/jobs/${job.id}/download`} className="btn btn-primary">
                    Download the remediated document
                  </a>
                </li>
                <li>
                  <Link href={`/jobs/${job.id}/review`} className="btn btn-quiet">
                    {summary.conforms ? 'Review record' : 'Review what is left'}
                  </Link>
                  <span className={styles.muted}>
                    {summary.short + summary.review === 0
                      ? 'Complete.'
                      : 'Decide the open findings and confirm the reviewer criteria.'}
                  </span>
                </li>
                <li>
                  <Link href={`/jobs/${job.id}/report`}>Conformance statement</Link>
                  <span className={styles.muted}>Printable, in the layout a buyer expects.</span>
                </li>
                <li>
                  <a href={`/jobs/${job.id}/report/download`}>Conformance statement as a Word file</a>
                  <span className={styles.muted}>The copy a contracting officer files.</span>
                </li>
                <li>
                  <a href={`/jobs/${job.id}/download?which=original`}>Original as uploaded</a>
                </li>
              </ul>
            )}
          </section>

          {signedIn && (
            <section className={`${styles.railCard} card`} aria-labelledby="keeping-title">
              <h2 id="keeping-title" className={styles.railTitle}>
                How long we keep it
              </h2>
              <p className={styles.actionNote}>{retention}</p>
              {/*
                Said rather than implied. A customer entitled to ask where their
                federal document is kept and whether it is encrypted should not
                have to take it on trust from a marketing page, and a build that
                is not doing either of those things should not be able to look
                like one that is.
              */}
              <p className={styles.muted}>
                {storage() === 's3' ? 'Stored in object storage' : 'Stored on this server’s own disk'}
                {encrypting() ? ', encrypted at rest.' : ', unencrypted — this is a development build.'}
              </p>
              {scrubbed && <p className={styles.actionNote}>{scrubbed}</p>}
              {job.deletedAt && (
                <p className={styles.warn}>
                  <strong>The document has been deleted.</strong> This report and the conformance statement remain;
                  the file and the remediated copy do not.
                </p>
              )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
