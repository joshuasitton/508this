import type { Metadata } from 'next';

import { ACCEPTED, MAX_UPLOAD_BYTES, describeUploadProblem, type UploadProblem } from '@/domain/job';
import { startJob } from './actions';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'Start a remediation' };

const PROBLEMS = new Set<string>(['no-file', 'unsupported-format', 'too-large', 'not-a-document']);

/**
 * One form, one file. No JavaScript is needed to submit it and none is
 * shipped for it: the browser posts, the action redirects, and a problem
 * comes back as a query parameter rendered in a live region. That keeps the
 * form working for every assistive technology, and keeps the page honest
 * about what happens to the file.
 */
export default async function Start({ searchParams }: { searchParams: Promise<{ problem?: string }> }) {
  const { problem } = await searchParams;
  const message = problem && PROBLEMS.has(problem) ? describeUploadProblem(problem as UploadProblem) : null;
  const accept = Object.values(ACCEPTED)
    .map((a) => `${a.extension},${a.mime}`)
    .join(',');

  return (
    <>
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

      <form action={startJob} className={styles.form} encType="multipart/form-data">
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
        <button type="submit" className={styles.button}>
          Check the document
        </button>
      </form>

      <p className={styles.note}>
        The file stays on this server. It is read once to find issues, kept only for this job, and its contents
        are never written to a log.
      </p>
    </>
  );
}
