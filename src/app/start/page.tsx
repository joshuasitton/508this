import type { Metadata } from 'next';

import { COLLECT_HOURS, RETENTION_DAYS } from '@/domain/retention';
import { ACCEPTED, MAX_UPLOAD_BYTES, describeUploadProblem, type UploadProblem } from '@/domain/job';
import { startJob } from './actions';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'Start a remediation' };

const PROBLEMS = new Set<string>([
  'no-file',
  'unsupported-format',
  'too-large',
  'not-a-document',
  'cui-needs-account',
]);

/**
 * One form, one file. No JavaScript is needed to submit it and none is
 * shipped for it: the browser posts, the action redirects, and a problem
 * comes back as a query parameter rendered in a live region. That keeps the
 * form working for every assistive technology, and keeps the page honest
 * about what happens to the file.
 *
 * The rail beside it is not decoration. What this service does with a
 * document is the thing a federal customer actually has to be satisfied
 * about before they upload anything, and burying it in a footnote under the
 * button was asking them to trust the paragraph they read last.
 */
export default async function Start({ searchParams }: { searchParams: Promise<{ problem?: string }> }) {
  const { problem } = await searchParams;
  const message = problem && PROBLEMS.has(problem) ? describeUploadProblem(problem as UploadProblem) : null;
  const accept = Object.values(ACCEPTED)
    .map((a) => `${a.extension},${a.mime}`)
    .join(',');

  return (
    <div className="layout">
      <div>
        <h1>Start a remediation</h1>
        <p className={styles.lede}>
          Upload the document. We check it against every Section 508 criterion it owes and show you what we found
          before anything is changed.
        </p>

        {message && (
          <p className={styles.problem} role="alert">
            {message}
          </p>
        )}

        <form action={startJob} className={`${styles.form} card`} encType="multipart/form-data">
          <div className={styles.formBody}>
            <label htmlFor="document" className={styles.label}>
              Document
            </label>
            <p id="document-hint" className={styles.hint}>
              {Object.values(ACCEPTED)
                .map((a) => a.label)
                .join(', ')}
              , up to {Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.
            </p>
            <input
              id="document"
              name="document"
              type="file"
              accept={accept}
              required
              aria-describedby="document-hint"
              className={styles.file}
            />

            <div className={styles.declare}>
              <label className={styles.declareLabel}>
                <input type="checkbox" name="cui" value="yes" /> This document is Controlled Unclassified
                Information.
              </label>
              <span className={styles.declareNote}>
                Tick this and no part of the document is ever sent outside 508This – every description is written by
                a person here. Leave it unticked and the image of a single figure may be sent to a model to draft a
                description, which a reviewer then edits or rejects. Nothing else about the document ever leaves, in
                either case.
              </span>
            </div>
          </div>

          <div className={styles.formFoot}>
            <button type="submit" className="btn btn-primary">
              Check the document
            </button>
            <span className={styles.formFootNote}>The assessment is free.</span>
          </div>
        </form>
      </div>

      <aside className="rail" aria-labelledby="handling-title">
        <div className={`${styles.handling} card`}>
          <h2 id="handling-title" className={styles.handlingTitle}>
            What happens to the file
          </h2>
          <ul className={styles.handlingList}>
            <li>
              <strong>It is encrypted the moment it lands</strong>, and it is read on this server. It is never
              written anywhere in the clear.
            </li>
            <li>
              <strong>Nothing about its contents reaches a log</strong> — not an error report, not an analytics
              event, not a support ticket.
            </li>
            <li>
              <strong>It is deleted on a clock.</strong> {COLLECT_HOURS} hours to collect the result, and{' '}
              {RETENTION_DAYS} days after you download it. You do not have to ask.
            </li>
            <li>
              <strong>Only a figure ever leaves, and only as a picture.</strong> One cropped image at a time, to
              draft a description a reviewer then edits. Never the text, never the file — and never at all if you
              mark it CUI.
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
