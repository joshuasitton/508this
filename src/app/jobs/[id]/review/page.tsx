import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { coverageOf, labelFor } from '@/domain/criteria';
import { assessAll, describeSummary, findingKey, isOpen, summarise, type Finding } from '@/domain/findings';
import { KINDS, REVIEW_INPUT } from '@/domain/kinds';
import { getJob } from '@/server/jobs';
import { confirmAction, decideAction, unconfirmAction, undoAction } from './actions';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Review' };

const PROBLEMS: Record<string, string> = {
  name: 'Enter your name first. It goes on the conformance statement.',
  value: 'Write the text to apply, or choose another action.',
  note: 'A dismissal needs a reason. It goes in the report.',
  action: 'Choose an action.',
};

/**
 * The review queue: everything a person has to decide, one item at a time,
 * with the place, the quotation and the reason beside each. No client
 * JavaScript; every button is a form. The reviewer's name is asked once and
 * carried in each form, because it goes on the statement and a statement
 * with nobody's name on it is not an assurance.
 *
 * Deciding writes into the document (alt text, link wording, decorative)
 * or into the record (a dismissal with its reason). Either way the job is
 * rebuilt from the original and re-detected, so what the reviewer sees
 * afterwards is what re-detection says, not what the button claimed.
 */
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ problem?: string }>;
}) {
  const { id } = await params;
  const { problem } = await searchParams;
  const job = await getJob(id);
  if (!job) notFound();

  const confirmed = new Set(Object.keys(job.confirmations ?? {}));
  const summary = summarise(job.findings, job.format, confirmed);
  const verdict = describeSummary(summary);
  const toDecide = job.findings.filter((f) => isOpen(f) && !f.decision);
  const decided = job.findings.filter((f) => f.decision);
  const reviewCriteria = assessAll(job.findings, job.format, confirmed).filter(
    (a) => coverageOf(a.criterion, job.format)?.coverage === 'reviewer' && a.status !== 'Not Applicable',
  );
  const reviewer = job.reviewer ?? '';
  const message = problem ? PROBLEMS[problem] : undefined;

  return (
    <>
      <p className={styles.kicker}>
        <Link href={`/jobs/${job.id}`}>Back to the report</Link>
      </p>
      <h1 className={styles.title}>Review: {job.filename}</h1>
      <p className={styles.status}>
        {toDecide.length} {toDecide.length === 1 ? 'finding' : 'findings'} to decide,{' '}
        {reviewCriteria.filter((a) => a.status === 'Needs Review').length} criteria to confirm. {verdict.headline}.
      </p>

      {message && (
        <p className={styles.problem} role="alert">
          {message}
        </p>
      )}

      {!job.remediatedAt && job.format === 'docx' && (
        <p className={styles.note}>
          Automatic remediation has not run yet. Run it from the report first so the queue holds only what needs a
          person.
        </p>
      )}

      <section className={styles.who} aria-labelledby="who-title">
        <h2 id="who-title" className={styles.h2}>
          Reviewer
        </h2>
        <p className={styles.note}>
          Your name goes on the conformance statement beside every decision you make. Type it once; each button below
          carries it.
        </p>
        <p className={styles.reviewerLine}>
          <label htmlFor="reviewer-name">Name</label>{' '}
          <input id="reviewer-name" form="none" defaultValue={reviewer} className={styles.input} readOnly={!!reviewer} />
          {reviewer && <span className={styles.muted}> (set on your first decision)</span>}
        </p>
      </section>

      <section aria-labelledby="decide-title">
        <h2 id="decide-title" className={styles.h2}>
          To decide
        </h2>
        {toDecide.length === 0 && <p className={styles.note}>Nothing waits on a decision.</p>}
        {toDecide.map((f) => (
          <ReviewItem key={findingKey(f)} f={f} jobId={job.id} reviewer={reviewer} />
        ))}
      </section>

      <section aria-labelledby="confirm-title">
        <h2 id="confirm-title" className={styles.h2}>
          To confirm
        </h2>
        <p className={styles.note}>
          These criteria have no open findings but can only be vouched for by a person. The screened sentences, if
          any, are in the decisions above. Confirming one moves it from “Needs Review” to “Supports” in the statement,
          under your name.
        </p>
        <ul className={styles.criteria}>
          {reviewCriteria.map((a) => {
            const c = job.confirmations?.[a.criterion];
            return (
              <li key={a.criterion} className={styles.criterion}>
                <div>
                  <strong>{labelFor(a.criterion)}</strong>
                  <span className={styles.remark}>{coverageOf(a.criterion, job.format)?.remark}</span>
                  {a.open.length > 0 && (
                    <span className={styles.remark}>
                      {a.open.length} open {a.open.length === 1 ? 'finding' : 'findings'} must be decided first.
                    </span>
                  )}
                </div>
                {c ? (
                  <form action={unconfirmAction} className={styles.inline}>
                    <input type="hidden" name="id" value={job.id} />
                    <input type="hidden" name="criterion" value={a.criterion} />
                    <span className={styles.confirmed}>Confirmed by {c.by}</span>
                    <button type="submit" className={styles.linkButton}>
                      Undo
                    </button>
                  </form>
                ) : (
                  <form action={confirmAction} className={styles.inline}>
                    <input type="hidden" name="id" value={job.id} />
                    <input type="hidden" name="criterion" value={a.criterion} />
                    <ReviewerField reviewer={reviewer} />
                    <button type="submit" className={styles.button} disabled={a.open.length > 0}>
                      Confirm
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {decided.length > 0 && (
        <section aria-labelledby="decided-title">
          <h2 id="decided-title" className={styles.h2}>
            Decided
          </h2>
          <ul className={styles.decided}>
            {decided.map((f) => (
              <li key={findingKey(f)} className={styles.decidedItem}>
                <div>
                  <strong>{capitalise(f.location)}.</strong> {describeDecision(f)}
                </div>
                <form action={undoAction} className={styles.inline}>
                  <input type="hidden" name="id" value={job.id} />
                  <input type="hidden" name="key" value={findingKey(f)} />
                  <button type="submit" className={styles.linkButton}>
                    Undo
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.conforms && (
        <p className={styles.done}>
          Nothing is open and nothing waits on a reviewer. The{' '}
          <Link href={`/jobs/${job.id}/report`}>conformance statement</Link> now says “Conforms to Section 508”, under{' '}
          {job.reviewer}’s name.
        </p>
      )}
    </>
  );
}

function ReviewerField({ reviewer }: { reviewer: string }) {
  return reviewer ? (
    <input type="hidden" name="reviewer" value={reviewer} />
  ) : (
    <label className={styles.nameField}>
      <span>Your name</span>
      <input name="reviewer" required className={styles.input} />
    </label>
  );
}

function ReviewItem({ f, jobId, reviewer }: { f: Finding; jobId: string; reviewer: string }) {
  const info = KINDS[f.kind];
  const input = REVIEW_INPUT[f.kind];
  const key = findingKey(f);
  const base = (
    <>
      <input type="hidden" name="id" value={jobId} />
      <input type="hidden" name="key" value={key} />
      <ReviewerField reviewer={reviewer} />
    </>
  );
  return (
    <article className={styles.item} aria-labelledby={`item-${slug(key)}`}>
      <h3 id={`item-${slug(key)}`} className={styles.itemTitle}>
        {info.title}
      </h3>
      <p className={styles.place}>
        <strong>{capitalise(f.location)}.</strong> {f.description}
      </p>
      <p className={styles.why}>{info.why}</p>

      {input === 'alt' && (
        <div className={styles.forms}>
          <form action={decideAction} className={styles.form}>
            {base}
            <input type="hidden" name="action" value="apply" />
            <label className={styles.field}>
              <span>Alternative text – what the image shows, for someone who cannot see it</span>
              <textarea name="value" rows={2} required className={styles.textarea} />
            </label>
            <button type="submit" className={styles.button}>
              Write it into the document
            </button>
          </form>
          <form action={decideAction} className={styles.form}>
            {base}
            <input type="hidden" name="action" value="decorative" />
            <button type="submit" className={styles.secondary}>
              Mark decorative – it carries no information
            </button>
          </form>
        </div>
      )}

      {input === 'text' && (
        <form action={decideAction} className={styles.form}>
          {base}
          <input type="hidden" name="action" value="apply" />
          <label className={styles.field}>
            <span>New link text – say where it goes</span>
            <input name="value" required className={styles.input} />
          </label>
          <button type="submit" className={styles.button}>
            Write it into the document
          </button>
        </form>
      )}

      <form action={decideAction} className={styles.form}>
        {base}
        <input type="hidden" name="action" value="dismiss" />
        <label className={styles.field}>
          <span>Not a failure – say why. The reason goes in the report.</span>
          <input name="note" required className={styles.input} />
        </label>
        <button type="submit" className={styles.secondary}>
          Dismiss
        </button>
      </form>
    </article>
  );
}

function describeDecision(f: Finding): string {
  const d = f.decision!;
  switch (d.action) {
    case 'apply':
      return `${d.by} wrote “${d.value}”.${f.remediated ? ' Applied.' : ' Not applied – re-detection still finds this.'}`;
    case 'decorative':
      return `${d.by} marked it decorative.${f.remediated ? ' Applied.' : ''}`;
    case 'dismiss':
      return `${d.by} dismissed it: ${d.note}`;
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}
