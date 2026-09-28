/**
 * A job is one document through the service: received, findings detected,
 * reviewed by a person, delivered. It is the unit everything else hangs off,
 * so its shape is decided here and nowhere else.
 */

import type { Finding } from './findings';
import type { Kind } from './kinds';
import type { Tier } from './triage';

export type JobStatus = 'received' | 'detected' | 'remediated' | 'in-review' | 'delivered';

export type Format = 'docx' | 'pdf';

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
  /**
   * The account this job belongs to. Exactly one of `account` and
   * `visitor` is set on every job written since ownership existed; a
   * record with neither is one from before it, and `mayOpen` refuses it.
   */
  account?: string;
  /**
   * The browser this job belongs to, as a SHA-256 digest of the cookie
   * rather than the cookie itself — a leaked record must not hand over the
   * thing that opens it. A visitor's reach stops at their own free
   * assessment; see `src/domain/viewer.ts`.
   */
  visitor?: string;
  /**
   * Which of the four PDF tiers this document landed in, established at
   * intake and stored because the price depends on it. Absent for a Word
   * file, which has no tier — the four-way split is a fact about PDFs.
   */
  tier?: Tier;
  /**
   * When the document and everything made from it are deleted. Set the
   * moment the customer downloads the delivered file, because that is the
   * only point at which the service can be sure they no longer need the
   * original here. See `src/domain/retention.ts`.
   */
  deleteAfter?: string;
  /** When the document's own words were taken out of this record. */
  scrubbedAt?: string;
  /** When the files were actually removed. The record outlives them. */
  deletedAt?: string;
  /** Criteria a reviewer has confirmed, by whom and when. */
  confirmations?: Record<string, { by: string; at: string }>;
  /** The reviewer named on the statement. Set the first time a person decides anything. */
  reviewer?: string;
  /**
   * The customer marked this document Controlled Unclassified Information
   * at intake. Nothing about it goes to a third-party model – zero data
   * retention is a storage commitment and not a FedRAMP authorisation – so
   * every description in it is written by a person.
   */
  cui?: boolean;
  /**
   * What the tagged PDF export came to, last time it was built.
   *
   * It is a record of a *check*, not a second copy of the findings: only the
   * criterion numbers the exported PDF still has anything open on, because the
   * findings themselves quote the document and a second copy of the customer's
   * words in this record is a second thing to scrub at delivery. Empty
   * `criteria` is the answer the service hopes for and can state — the export
   * was run through the same detector a customer's own PDF goes through, and it
   * came back clean.
   *
   * `refused` is the other outcome. Some documents cannot be exported at all,
   * and saying which and why is better than an empty download.
   */
  exported?: PdfExportRecord;
}

export interface PdfExportRecord {
  at: string;
  pages?: number;
  /** Criteria still open in the exported PDF. Absent when it was refused. */
  criteria?: string[];
  /**
   * Whether the pass that draws each page ran. It answers 1.4.3, 3.1.2 and
   * 1.3.2, it times out rather than throwing, and an empty finding list from a
   * pass that never ran looks exactly like a clean one — so which it was is
   * recorded, and the page says so rather than claiming the wider check.
   */
  rendered?: boolean;
  refused?: 'unsupported-characters' | 'unsupported-figure' | 'not-a-document';
  /**
   * The characters, or the figures, that refused it — so a reviewer can act
   * rather than guess. It comes from the document, so `scrubJob` takes it out
   * at delivery along with every other quotation.
   */
  detail?: string[];
}

/** One change remediation made, in the customer's words. */
export interface Applied {
  kind: Kind;
  location: string;
  description: string;
}

export const ACCEPTED: Record<Format, { extension: string; mime: string; label: string; signature: number[] }> = {
  docx: {
    extension: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word (.docx)',
    // "PK\x03\x04" – a .docx is a zip.
    signature: [0x50, 0x4b, 0x03, 0x04],
  },
  pdf: {
    extension: '.pdf',
    mime: 'application/pdf',
    label: 'PDF (.pdf)',
    // "%PDF"
    signature: [0x25, 0x50, 0x44, 0x46],
  },
};

/**
 * 25 MB. Federal documents run long but a .docx is compressed text and a
 * PDF's bulk is usually images; the ones over this are almost always
 * embedded video or a very long scan. The Next.js action limit is set just
 * above this so the friendlier message here fires first.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function formatFor(filename: string): Format | null {
  const lower = filename.toLowerCase();
  for (const [format, spec] of Object.entries(ACCEPTED) as [Format, (typeof ACCEPTED)[Format]][]) {
    if (lower.endsWith(spec.extension)) return format;
  }
  return null;
}

export type UploadCheck = { ok: true; format: Format } | { ok: false; reason: UploadProblem };

export type UploadProblem = 'no-file' | 'unsupported-format' | 'too-large' | 'not-a-document' | 'cui-needs-account';

/**
 * Checked in this order because it is the order a person can act on: pick a
 * file, pick the right kind, pick a smaller one. The signature check last
 * catches a file whose name lies about it – a renamed .doc, a PDF saved as
 * .docx, an HTML error page with the wrong extension – before it reaches a
 * reader that would fail with something unhelpful.
 */
export function checkUpload(filename: string, size: number, head: Uint8Array): UploadCheck {
  if (!filename || size === 0) return { ok: false, reason: 'no-file' };
  const format = formatFor(filename);
  if (!format) return { ok: false, reason: 'unsupported-format' };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: 'too-large' };
  if (!ACCEPTED[format].signature.every((b, i) => head[i] === b)) return { ok: false, reason: 'not-a-document' };
  return { ok: true, format };
}

/** The sentence shown to the person, one per problem. */
export function describeUploadProblem(reason: UploadProblem): string {
  switch (reason) {
    case 'no-file':
      return 'Choose a document to upload.';
    case 'unsupported-format':
      return 'Only Word documents (.docx) and PDFs are accepted for now. PowerPoint is coming.';
    case 'too-large':
      return 'That document is over 25 MB. Remove embedded video or send it in parts.';
    case 'not-a-document':
      return 'That file is not what its name says it is. Open it in Word or Acrobat and save it again in the right format.';
    case 'cui-needs-account':
      return 'A document marked Controlled Unclassified Information needs an account. Identification and authentication is what the standard asks for, and a browser cookie is neither. Sign in, or create an account, and upload it again — nothing was stored.';
  }
}

/**
 * The longest a reviewer's name may be. It is printed in a table cell of
 * the conformance statement beside every decision they made, so it has to
 * fit on a line; it is not a security boundary.
 */
export const MAX_REVIEWER = 120;

/**
 * A reviewer's name, as it will appear on the statement.
 *
 * It is normalised in one place because it is written into two documents
 * that are not the same kind of thing – the Word conformance report and the
 * job record – and a name that differed between them would put two people's
 * signatures on one assurance. Control characters go because Word rejects
 * them outright in a text run; runs of whitespace collapse because a name
 * pasted out of a signature block arrives with newlines in it.
 *
 * Returns the empty string for anything that is not a usable name, and the
 * caller treats that as "no name given" rather than storing a blank.
 */
export function reviewerName(raw: string): string {
  const clean = raw
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, MAX_REVIEWER).trim();
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

/**
 * What the PDF export is, in the customer's words.
 *
 * Two sentences the page has to be able to say and cannot fudge. The first is
 * what the export *is*: a conformant reading copy, not a photograph of the Word
 * file, because the fonts are the standard fourteen and the lines are broken by
 * this service rather than by Word. A customer who expects a replica and gets a
 * reading copy has been misled by silence.
 *
 * The second is what the check came back with. "We checked it" is worth nothing
 * unless it says with what and what it found, so the criteria are named when
 * any are open — and when none are, that is stated plainly, because it is the
 * strongest true thing the service can say about a file it wrote itself.
 */
export const PDF_EXPORT_IS =
  'A reading copy, not a copy of the layout: the headings, lists, tables, links and figure descriptions with a reading order, set in standard fonts, so pages break where this service breaks them and not where Word did. Where the look matters more, use Word’s own “Save as PDF” on the remediated file.';

export function describeExport(record: PdfExportRecord | undefined): string | null {
  if (!record) return null;
  switch (record.refused) {
    case 'unsupported-characters':
      return `This document cannot be exported as a PDF here: it uses characters the export’s fonts cannot set${
        record.detail?.length ? ` (${record.detail.slice(0, 8).join(' ')})` : ''
      }. The export refuses rather than replacing them with something the document does not say. Word’s own “Save as PDF” on the remediated document handles it.`;
    case 'unsupported-figure':
      return `This document cannot be exported as a PDF here: one of its pictures is in a format the export cannot read${
        record.detail?.length ? ` (${record.detail.slice(0, 4).join(', ')})` : ''
      }. Rather than deliver a document with a figure silently missing, the export refuses. Word’s own “Save as PDF” handles it.`;
    case 'not-a-document':
      return 'The remediated document could not be reopened to export it. Nothing is wrong with the document you downloaded; the export is what failed.';
    default:
      break;
  }
  const pages = record.pages ? `${record.pages} ${record.pages === 1 ? 'page' : 'pages'}, checked` : 'Checked';
  const how = record.rendered
    ? 'with the same detector this service checks a customer’s PDF with'
    : 'against its tag tree — the pass that draws each page to measure contrast and reading order could not run, so those stay a reviewer’s';
  if (!record.criteria || record.criteria.length === 0) {
    return `${pages} ${how}: nothing is open in the exported PDF.`;
  }
  const list = record.criteria.join(', ');
  return `${pages} ${how}. ${
    record.criteria.length === 1 ? 'One criterion is' : `${record.criteria.length} criteria are`
  } still open in the exported PDF: ${list} — the same ${record.criteria.length === 1 ? 'one' : 'ones'} the document itself still owes.`;
}
