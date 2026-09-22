/**
 * The job store: where a customer's document and its findings live between
 * upload and delivery.
 *
 * This is the local-disk implementation, under `documents/` next to the
 * project (gitignored as a whole folder), or wherever `DOCUMENTS_DIR` points.
 * It is right for development and for the first jobs run by hand on one
 * machine. It is wrong for Vercel, whose filesystem is ephemeral, and it
 * will be replaced by object storage once the Chairman has decided retention
 * (standup, 2026-09-17). Every caller goes through `createJob` and `getJob`
 * so that swap is one file.
 *
 * Two rules the invariant in CLAUDE.md turns into code here. The job id is
 * the only thing that becomes a path – the customer's filename is stored in
 * the record and never joined into one – and no error raised here carries
 * document content, so whatever logs it cannot leak it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { detectDocx } from '@/domain/docx';
import { detectPdf } from '@/domain/pdfDetect';
import { applyPdfDecisions, remediatePdf } from '@/domain/pdfRemediate';
import type { PdfValue } from '@/domain/pdf';
import { findingKey, isOpen, summarise, type Decision, type Finding } from '@/domain/findings';
import type { NoImage } from '@/domain/alt';
import { imageForFinding, imagesForFindings, type FigureResult } from './figures';
import { reviewerName, type Format, type Job } from '@/domain/job';
import { applyDecisions, remediateDocx } from '@/domain/remediate';
import { readDocxParts, writeDocx } from './docx';
import { readPdf, writePdf } from './pdf';

const ROOT = process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), 'documents');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function dirFor(id: string): string {
  if (!ID.test(id)) throw new Error('Invalid job id');
  return path.join(ROOT, id);
}

/** Detection for whichever format the job is. The one place the two paths meet. */
function detect(format: Format, bytes: Uint8Array): Finding[] {
  return format === 'pdf' ? detectPdf(readPdf(bytes)) : detectDocx(readDocxParts(bytes));
}

export async function createJob(
  filename: string,
  format: Format,
  bytes: Uint8Array,
  options: { cui?: boolean } = {},
): Promise<Job> {
  // Detect before writing anything, so a document the reader rejects is
  // never stored.
  const findings = detect(format, bytes);
  const job: Job = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    filename,
    format,
    status: 'detected',
    findings,
  };
  if (options.cui) job.cui = true;
  const dir = dirFor(job.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `original.${format}`), bytes);
  await writeFile(path.join(dir, 'job.json'), JSON.stringify(job, null, 2));
  return job;
}

export async function getJob(id: string): Promise<Job | null> {
  if (!ID.test(id)) return null;
  let job: Job;
  try {
    const raw = await readFile(path.join(dirFor(id), 'job.json'), 'utf8');
    job = JSON.parse(raw) as Job;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return isCurrent(job) ? job : redetect(job);
}

/**
 * A record written by an earlier build may lack fields the page now needs –
 * the first time was `kind`, added after the first jobs had already been
 * stored. Detection is deterministic and the original document is kept
 * beside the record, so the honest repair is to run detection again and
 * rewrite the record, not to guess at the missing fields. The one thing this
 * cannot preserve is review state on findings, which no build has written
 * yet; when one does, this check grows to carry it across.
 */
function isCurrent(job: Job): boolean {
  return job.findings.every((f) => typeof f.kind === 'string');
}

async function redetect(job: Job): Promise<Job> {
  const bytes = await readFile(path.join(dirFor(job.id), `original.${job.format}`));
  const findings = detectDocx(readDocxParts(new Uint8Array(bytes)));
  const repaired: Job = { ...job, findings };
  await writeFile(path.join(dirFor(job.id), 'job.json'), JSON.stringify(repaired, null, 2));
  return repaired;
}

export type JobFile = 'original' | 'remediated';

/** The bytes of a job's document, or null if the job or the file does not exist. */
export async function getJobFile(
  id: string,
  which: JobFile,
): Promise<{ bytes: Uint8Array; filename: string; format: Job['format'] } | null> {
  const job = await getJob(id);
  if (!job) return null;
  if (which === 'remediated' && !job.remediatedAt) return null;
  try {
    const bytes = await readFile(path.join(dirFor(id), `${which}.${job.format}`));
    return { bytes: new Uint8Array(bytes), filename: deliveredName(job.filename, which), format: job.format };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** "report.docx" comes back as "report (remediated).docx", so the two never overwrite each other on the customer's disk. */
export function deliveredName(filename: string, which: JobFile): string {
  if (which === 'original') return filename;
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? `${filename.slice(0, dot)} (remediated)${filename.slice(dot)}` : `${filename} (remediated)`;
}

/**
 * Runs automatic remediation on the original, stores the result, and
 * re-detects it. A finding is marked remediated when it is absent from the
 * re-detection – not when a fix claims to have handled it – so the record
 * describes the delivered document and nothing else. Findings the output
 * still has stay open; anything new the output has (there should be
 * nothing) is added, so a fix that broke something cannot hide.
 */
export async function remediateJob(id: string): Promise<Job | null> {
  const job = await getJob(id);
  if (!job) return null;
  return rebuild(job);
}

/**
 * The delivered document is a pure function of the original and the
 * record: automatic remediation, then the reviewer's applied decisions, then
 * re-detection to say what is really fixed. Every change to the record
 * comes back through here, so there is one path and it always starts from
 * the original.
 */
async function rebuild(job: Job): Promise<Job> {
  const original = new Uint8Array(await readFile(path.join(dirFor(job.id), `original.${job.format}`)));
  if (job.format === 'pdf') return rebuildPdf(job, original);
  const parts = readDocxParts(original);
  const auto = remediateDocx(parts, { fallbackTitle: stem(job.filename) });
  const reviewed = applyDecisions(auto.parts, job.findings);
  const remediated = writeDocx(original, reviewed.parts);
  const after = detect(job.format, remediated);

  const still = new Set(after.map(key));
  const findings: Finding[] = job.findings.map((f) => ({ ...f, remediated: !still.has(key(f)) }));
  const known = new Set(findings.map(key));
  for (const f of after) if (!known.has(key(f))) findings.push(f);

  const updated: Job = {
    ...job,
    findings,
    applied: [...auto.applied, ...reviewed.applied],
    remediatedAt: new Date().toISOString(),
  };
  updated.status = statusOf(updated);
  await writeFile(path.join(dirFor(job.id), `remediated.${job.format}`), remediated);
  await writeFile(path.join(dirFor(job.id), 'job.json'), JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Delivered when nothing is open and nothing waits on a reviewer; in review
 * once a person has decided or confirmed anything; remediated after the
 * button and before a person; detected before that.
 */
function statusOf(job: Job): Job['status'] {
  const confirmed = new Set(Object.keys(job.confirmations ?? {}));
  if (summarise(job.findings, job.format, confirmed).conforms) return 'delivered';
  const touched = job.findings.some((f) => f.decision) || confirmed.size > 0;
  if (touched) return 'in-review';
  return job.remediatedAt ? 'remediated' : 'detected';
}

/**
 * Who is reviewing this job. The name is asked once, stored here, and read
 * from here by every decision – it is never carried in the form that makes
 * the decision. A name in a hidden field is a second copy of the same fact,
 * and the two copies going out of step would put the wrong person's name
 * beside a decision on a federal conformance statement.
 *
 * Changing it does not touch decisions already made: each one recorded the
 * name it was made under, and rewriting those would be forging a signature.
 */
export async function setReviewer(id: string, name: string): Promise<Job | null> {
  const job = await getJob(id);
  if (!job) return null;
  const clean = reviewerName(name);
  if (!clean) return null;
  job.reviewer = clean;
  await writeFile(path.join(dirFor(id), 'job.json'), JSON.stringify(job, null, 2));
  return job;
}

/**
 * Which of a job's figures the reviewer can actually be shown, answered for
 * all of them from one opening of the document.
 *
 * The review page needs this before it draws anything: a reviewer cannot
 * check a description against a figure they cannot see, and an `img` that
 * 404s is worse than an honest sentence saying the artwork is vector.
 */
export async function figureImages(id: string): Promise<Map<string, FigureResult>> {
  const job = await getJob(id);
  if (!job) return new Map();
  try {
    const original = new Uint8Array(await readFile(path.join(dirFor(job.id), `original.${job.format}`)));
    return imagesForFindings(original, job.format, job.findings);
  } catch {
    // A document that cannot be reopened is a broken job, not a broken
    // page: the queue still lists the findings and the reviewer still works.
    return new Map();
  }
}

/** One figure's bytes, for the route that shows it. */
export async function figureImage(id: string, findingKeyValue: string): Promise<FigureResult> {
  return (await figureImages(id)).get(findingKeyValue) ?? { ok: false, reason: 'not-found' };
}

export type ProposeResult =
  | { ok: true; job: Job }
  | { ok: false; reason: NoImage | 'cui' | 'refused' | 'unavailable' | 'not-found' };

/**
 * Draft a description for one figure, for the reviewer to edit or throw
 * away. It is stored as a proposal and changes nothing in the document: a
 * wrong description is a finding, not a fix, and only a named person can
 * turn one into a decision.
 *
 * Refuses outright for a document the customer marked CUI. That is the
 * Chairman's retention decision composed with his CUI decision, and it is
 * enforced here rather than in the page, because a page is a thing a person
 * can navigate around.
 */
export async function propose(id: string, findingKeyValue: string): Promise<ProposeResult> {
  const job = await getJob(id);
  if (!job) return { ok: false, reason: 'not-found' };
  if (job.cui) return { ok: false, reason: 'cui' };

  // Loaded here rather than at the top of the file, and that is not a
  // style choice: `vision.ts` is the one module in `src/server/` that takes
  // an npm dependency, this store is imported by the test suite, and
  // `npm test` has to run with nothing installed. A static import put the
  // SDK in the test suite's import graph and CI caught it on the first
  // push – which is the guarantee working, and the reason it is stated as
  // "no file any test imports may take a dependency" rather than as a
  // claim about one file.
  const { draftAltText, VisionUnavailableError, visionConfigured } = await import('./vision');
  if (!visionConfigured()) return { ok: false, reason: 'unavailable' };

  const target = job.findings.find((f) => findingKey(f) === findingKeyValue);
  if (!target || !isOpen(target) || target.kind !== 'image-alt') return { ok: false, reason: 'not-found' };

  const original = new Uint8Array(await readFile(path.join(dirFor(job.id), `original.${job.format}`)));
  const found = imageForFinding(original, job.format, target);
  if (!found.ok) return { ok: false, reason: found.reason };

  let draft;
  try {
    draft = await draftAltText(found.image);
  } catch (error) {
    // Nothing about the document goes into this path: the shape of the
    // failure is all that is kept.
    if (error instanceof VisionUnavailableError) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'refused' };
  }
  if (draft.refused || !draft.text) return { ok: false, reason: 'refused' };

  target.proposal = { text: draft.text, at: new Date().toISOString() };
  await writeFile(path.join(dirFor(job.id), 'job.json'), JSON.stringify(job, null, 2));
  return { ok: true, job };
}

/** A reviewer's decision on one finding, then a rebuild. Returns null for an unknown job or finding. */
export async function decide(id: string, findingKeyValue: string, decision: Decision): Promise<Job | null> {
  const job = await getJob(id);
  if (!job) return null;
  const target = job.findings.find((f) => findingKey(f) === findingKeyValue);
  if (!target || !isOpen(target)) return null;
  target.decision = decision;
  job.reviewer = decision.by;
  return rebuild(job);
}

export async function undecide(id: string, findingKeyValue: string): Promise<Job | null> {
  const job = await getJob(id);
  if (!job) return null;
  const target = job.findings.find((f) => findingKey(f) === findingKeyValue);
  if (!target?.decision) return null;
  delete target.decision;
  return rebuild(job);
}

export async function confirm(id: string, criterion: string, by: string): Promise<Job | null> {
  const job = await getJob(id);
  if (!job) return null;
  job.confirmations = { ...(job.confirmations ?? {}), [criterion]: { by, at: new Date().toISOString() } };
  job.reviewer = by;
  job.status = statusOf(job);
  await writeFile(path.join(dirFor(id), 'job.json'), JSON.stringify(job, null, 2));
  return job;
}

export async function unconfirm(id: string, criterion: string): Promise<Job | null> {
  const job = await getJob(id);
  if (!job?.confirmations?.[criterion]) return null;
  const { [criterion]: _gone, ...rest } = job.confirmations;
  void _gone;
  job.confirmations = rest;
  job.status = statusOf(job);
  await writeFile(path.join(dirFor(id), 'job.json'), JSON.stringify(job, null, 2));
  return job;
}

/**
 * The PDF path of `rebuild`, with the same contract: the delivered file is
 * a pure function of the original and the record, and a finding counts as
 * fixed only when re-detection no longer finds it.
 */
async function rebuildPdf(job: Job, original: Uint8Array): Promise<Job> {
  const doc = readPdf(original);
  const auto = remediatePdf(doc, { fallbackTitle: stem(job.filename) });
  const reviewed = applyPdfDecisions(doc, job.findings);
  const trailerExtras = new Map<string, PdfValue>([...auto.trailerExtras, ...reviewed.trailerExtras]);
  const remediated = writePdf(doc, [...auto.edits, ...reviewed.edits], trailerExtras);
  const after = detectPdf(readPdf(remediated));

  const still = new Set(after.map(key));
  const findings: Finding[] = job.findings.map((f) => ({ ...f, remediated: !still.has(key(f)) }));
  const known = new Set(findings.map(key));
  for (const f of after) if (!known.has(key(f))) findings.push(f);

  const updated: Job = {
    ...job,
    findings,
    applied: [...auto.applied, ...reviewed.applied],
    remediatedAt: new Date().toISOString(),
  };
  updated.status = statusOf(updated);
  await writeFile(path.join(dirFor(job.id), `remediated.${job.format}`), remediated);
  await writeFile(path.join(dirFor(job.id), 'job.json'), JSON.stringify(updated, null, 2));
  return updated;
}

function key(f: Finding): string {
  return `${f.kind}|${f.location}`;
}

function stem(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}
