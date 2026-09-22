import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { coverageOf, labelFor } from '@/domain/criteria';
import { assessAll, describeSummary, findingKey, isOpen, summarise, type Finding } from '@/domain/findings';
import { describeNoImage, type NoImage } from '@/domain/alt';
import { MAX_REVIEWER } from '@/domain/job';
import { KINDS, REVIEW_INPUT } from '@/domain/kinds';
import { openFigureImages, openJobFor } from '@/server/access';
import { visionConfigured } from '@/server/vision';
import { describeSignInNeeded, mayReview } from '@/domain/viewer';
import { confirmAction, decideAction, identifyAction, proposeAction, unconfirmAction, undoAction } from './actions';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Review' };

const PROBLEMS: Record<string, string> = {
  name: 'Enter your name first. It goes on the conformance statement.',
  value: 'Write the text to apply, or choose another action.',
  note: 'A dismissal needs a reason. It goes in the report.',
  action: 'Choose an action.',
  'draft-cui': 'This document is marked Controlled Unclassified Information, so no part of it is sent anywhere. Describe the figure yourself.',
  'draft-unavailable': 'Drafting is not configured on this server. Describe the figure yourself.',
  'draft-refused': 'The model could not describe this figure. Describe it yourself.',
  ...Object.fromEntries(
    (['vector', 'not-found', 'unsupported-filter', 'unsupported-colour', 'too-large', 'no-anchor'] as NoImage[]).map(
      (reason) => [`draft-${reason}`, describeNoImage(reason)],
    ),
  ),
};

/**
 * The review queue: everything a person has to decide, one item at a time,
 * with the place, the quotation and the reason beside each. No client
 * JavaScript; every button is a form.
 *
 * The reviewer says who they are once, before anything can be decided, and
 * the name is then read from the job record rather than carried in each
 * form. Carrying it in each form is what this page used to do, and on a PDF
 * with four undescribed figures that was fifteen “Your name” boxes on one
 * screen under a heading promising the opposite. Asking first is also the
 * honest order: a decision nobody's name is on is not worth recording, so
 * there is nothing to decide with until there is a name.
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
  const { job, who } = await openJobFor(id);
  if (!job) notFound();

  const confirmed = new Set(Object.keys(job.confirmations ?? {}));
  const summary = summarise(job.findings, job.format, confirmed);
  const verdict = describeSummary(summary);
  const toDecide = job.findings.filter((f) => isOpen(f) && !f.decision);
  const decided = job.findings.filter((f) => f.decision);
  const reviewCriteria = assessAll(job.findings, job.format, confirmed).filter(
    (a) => coverageOf(a.criterion, job.format)?.coverage === 'reviewer' && a.status !== 'Not Applicable',
  );
  // A visitor may read their own assessment and may not decide anything in
   // it: a decision puts a named person on a federal conformance statement,
   // and a cookie is not a named person.
  const signedIn = mayReview(who);
  const reviewer = signedIn ? (job.reviewer ?? '') : '';
  const message = problem ? PROBLEMS[problem] : undefined;
  // A document the customer marked CUI never has any part of it sent
  // anywhere, so the button is not offered rather than offered and refused.
  const canDraft = signedIn && !job.cui && visionConfigured();
  // Asked once for the whole document rather than once per figure: a
  // submission with 76 of them would otherwise reopen and reparse the file
  // 76 times to draw one screen.
  const pictures = await openFigureImages(job.id);

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

      {!job.remediatedAt && (
        <p className={styles.note}>
          Automatic remediation has not run yet. Run it from the report first so the queue holds only what needs a
          person.
        </p>
      )}

      <section className={styles.who} aria-labelledby="who-title">
        <h2 id="who-title" className={styles.h2}>
          Reviewer
        </h2>
        {!signedIn ? (
          <>
            <p className={styles.note}>{describeSignInNeeded('review')}</p>
            <p className={styles.note}>
              <Link href="/account/sign-in">Sign in</Link> or{' '}
              <Link href="/account/sign-up">create an account</Link>. This document comes with you.
            </p>
          </>
        ) : reviewer ? (
          <>
            <p className={styles.reviewerLine}>
              Reviewing as <strong>{reviewer}</strong>. This name goes on the conformance statement beside every
              decision you make.
            </p>
            <details className={styles.swap}>
              <summary>Hand over to someone else</summary>
              <p className={styles.note}>
                Decisions already made keep the name they were made under. Changing this only affects what happens
                next.
              </p>
              <IdentifyForm jobId={job.id} label="New reviewer’s name" button="Hand over" />
            </details>
          </>
        ) : (
          <>
            <p className={styles.note}>
              Your name goes on the conformance statement beside every decision you make, so say who you are before
              deciding anything. You only type it once.
            </p>
            <IdentifyForm jobId={job.id} label="Your name" button="Start reviewing" />
          </>
        )}
      </section>

      <section aria-labelledby="decide-title">
        <h2 id="decide-title" className={styles.h2}>
          To decide
        </h2>
        {toDecide.length === 0 && <p className={styles.note}>Nothing waits on a decision.</p>}
        {toDecide.length > 0 && !reviewer && (
          <p className={styles.gate}>
            Read them here; enter your name above to decide them. Every decision is recorded under the name it was
            made under, so the statement can say who vouched for what.
          </p>
        )}
        {toDecide.map((f) => (
          <ReviewItem
            key={findingKey(f)}
            f={f}
            jobId={job.id}
            canDecide={signedIn && !!reviewer}
            canDraft={canDraft}
            picture={pictures.get(findingKey(f))}
          />
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
        {!reviewer && <p className={styles.gate}>Enter your name above to confirm these.</p>}
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
                    <button type="submit" className={styles.button} disabled={!reviewer || a.open.length > 0}>
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

/**
 * The one place a name is typed. Everything else reads it from the job, so
 * there is exactly one field on the page whatever the document turned up.
 */
function IdentifyForm({ jobId, label, button }: { jobId: string; label: string; button: string }) {
  return (
    <form action={identifyAction} className={styles.identify}>
      <input type="hidden" name="id" value={jobId} />
      <label className={styles.nameField}>
        <span>{label}</span>
        <input name="reviewer" required maxLength={MAX_REVIEWER} autoComplete="name" className={styles.input} />
      </label>
      <button type="submit" className={styles.button}>
        {button}
      </button>
    </form>
  );
}

function ReviewItem({
  f,
  jobId,
  canDecide,
  canDraft,
  picture,
}: {
  f: Finding;
  jobId: string;
  canDecide: boolean;
  canDraft: boolean;
  picture?: { ok: true } | { ok: false; reason: NoImage };
}) {
  const info = KINDS[f.kind];
  const input = REVIEW_INPUT[f.kind];
  const key = findingKey(f);
  const base = (
    <>
      <input type="hidden" name="id" value={jobId} />
      <input type="hidden" name="key" value={key} />
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

      {input === 'alt' && picture?.ok === true && (
        <figure className={styles.figure}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the bytes
              come from the customer's own document through a private route,
              not from a URL Next can optimise. */}
          <img
            src={`/jobs/${jobId}/figure?key=${encodeURIComponent(key)}`}
            alt="The figure as it appears in the document. It has no description yet; writing one is what this screen is for."
            className={styles.figureImage}
          />
        </figure>
      )}
      {input === 'alt' && picture?.ok === false && (
        <p className={styles.noFigure}>{describeNoImage(picture.reason)}</p>
      )}

      {canDecide && input === 'alt' && (
        <div className={styles.forms}>
          {f.proposal && (
            <p className={styles.drafted}>
              Drafted by a model, not by a person. Read it against the figure and edit it before you apply it.
            </p>
          )}
          <form action={decideAction} className={styles.form}>
            {base}
            <input type="hidden" name="action" value="apply" />
            <label className={styles.field}>
              <span>Alternative text – what the image shows, for someone who cannot see it</span>
              <textarea
                name="value"
                rows={2}
                required
                className={styles.textarea}
                defaultValue={f.proposal?.text ?? ''}
              />
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
          {canDraft && (
            <form action={proposeAction} className={styles.form}>
              {base}
              <button type="submit" className={styles.secondary}>
                {f.proposal ? 'Draft it again' : 'Draft a description to edit'}
              </button>
            </form>
          )}
        </div>
      )}

      {canDecide && input === 'text' && (
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

      {canDecide && (
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
      )}
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
