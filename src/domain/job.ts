/**
 * A job is one document through the service: received, findings detected,
 * reviewed by a person, delivered. It is the unit everything else hangs off,
 * so its shape is decided here and nowhere else.
 */

import type { Finding } from './findings';
import type { Kind } from './kinds';

export type JobStatus = 'received' | 'detected' | 'remediated' | 'in-review' | 'delivered';

export type Format = 'docx';

export interface Job {
  id: string;
  createdAt: string;
  /** The customer's filename, kept for the report; never used as a path. */
  filename: string;
  format: Format;
  status: JobStatus;
  findings: Finding[];
  /** What automatic remediation changed, in order. Absent until it has run. */
  applied?: Applied[];
  remediatedAt?: string;
  /** Criteria a reviewer has confirmed, by whom and when. */
  confirmations?: Record<string, { by: string; at: string }>;
  /** The reviewer named on the statement. Set the first time a person decides anything. */
  reviewer?: string;
}

/** One change remediation made, in the customer's words. */
export interface Applied {
  kind: Kind;
  location: string;
  description: string;
}

export const ACCEPTED: Record<Format, { extension: string; mime: string; label: string }> = {
  docx: {
    extension: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word (.docx)',
  },
};

/**
 * 25 MB. Federal documents run long but a .docx is compressed text; the ones
 * over this are almost always embedded video or an uncompressed scan, and a
 * scan is a different job. The Next.js action limit is set just above this
 * so the friendlier message here fires first.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

export function formatFor(filename: string): Format | null {
  const lower = filename.toLowerCase();
  for (const [format, spec] of Object.entries(ACCEPTED) as [Format, (typeof ACCEPTED)[Format]][]) {
    if (lower.endsWith(spec.extension)) return format;
  }
  return null;
}

export type UploadCheck = { ok: true; format: Format } | { ok: false; reason: UploadProblem };

export type UploadProblem = 'no-file' | 'unsupported-format' | 'too-large' | 'not-a-document';

/**
 * Checked in this order because it is the order a person can act on: pick a
 * file, pick the right kind, pick a smaller one. The signature check last
 * catches a .docx that is not a zip at all – a renamed .doc, or an HTML
 * error page saved with the wrong name – before it reaches the reader.
 */
export function checkUpload(filename: string, size: number, head: Uint8Array): UploadCheck {
  if (!filename || size === 0) return { ok: false, reason: 'no-file' };
  const format = formatFor(filename);
  if (!format) return { ok: false, reason: 'unsupported-format' };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: 'too-large' };
  if (!ZIP_SIGNATURE.every((b, i) => head[i] === b)) return { ok: false, reason: 'not-a-document' };
  return { ok: true, format };
}

/** The sentence shown to the person, one per problem. */
export function describeUploadProblem(reason: UploadProblem): string {
  switch (reason) {
    case 'no-file':
      return 'Choose a document to upload.';
    case 'unsupported-format':
      return 'Only Word documents (.docx) are accepted for now. PDF and PowerPoint are coming.';
    case 'too-large':
      return 'That document is over 25 MB. Remove embedded video or send it in parts.';
    case 'not-a-document':
      return 'That file is not a Word document, even though it is named like one. Open it in Word and save it as .docx.';
  }
}

/** Progress-to-delivery in the customer's words. */
export function describeStatus(status: JobStatus): string {
  switch (status) {
    case 'received':
      return 'Received. Checking the document.';
    case 'detected':
      return 'Checked. Every issue below has been found; nothing has been changed yet.';
    case 'remediated':
      return 'Fixed automatically where that is safe. What is left needs a person.';
    case 'in-review':
      return 'In review. A person is deciding what is left and confirming what only a person can.';
    case 'delivered':
      return 'Delivered. The remediated document and its conformance report are ready.';
  }
}
