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

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { detectDocx } from '@/domain/docx';
import { detectPdf, readPdfFacts } from '@/domain/pdfDetect';
import { triagePdf, type Tier } from '@/domain/triage';
import { applyPdfDecisions, remediatePdf } from '@/domain/pdfRemediate';
import type { PdfValue } from '@/domain/pdf';
import { findingKey, isOpen, summarise, type Decision, type Finding } from '@/domain/findings';
import type { NoImage } from '@/domain/alt';
import { imageForFinding, imagesForFindings, type FigureResult } from './figures';
import { reviewerName, type Format, type Job } from '@/domain/job';
import { open as unseal, openText, seal, sealText } from './crypto';
import { deleteAfter as deleteAfterFor, expired } from '@/domain/retention';
import { scrubJob } from '@/domain/scrub';
import type { Owner } from '@/domain/viewer';
import { applyDecisions, remediateDocx } from '@/domain/remediate';
import { readDocxParts, writeDocx } from './docx';
import { readPdf, writePdf } from './pdf';

const ROOT = process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), 'documents');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function dirFor(id: string): string {
  if (!ID.test(id)) throw new Error('Invalid job id');
  return path.join(ROOT, id);
}

/**
 * Detection for whichever format the job is. The one place the two paths
 * meet, and now also where a PDF's tier is established — the tier decides
 * what the service may promise and therefore what it may charge, so it is
 * settled once, at intake, and stored on the record rather than recomputed
 * by whoever needs it next.
 */
function detect(format: Format, bytes: Uint8Array): { findings: Finding[]; tier?: Tier } {
  if (format !== 'pdf') return { findings: detectDocx(readDocxParts(bytes)) };
  const doc = readPdf(bytes);
  const findings = detectPdf(doc);
  return { findings, tier: triagePdf(readPdfFacts(doc), findings).tier };
}

/**
 * Store a document. The owner is required rather than optional: a job with
 * nobody's name on it is the bearer-URL this whole change exists to end,
 * and the type is the only thing that reliably stops one being written.
 */
export async function createJob(
  filename: string,
  format: Format,
  bytes: Uint8Array,
  options: { cui?: boolean; owner: Owner },
): Promise<Job> {
  // Detect before writing anything, so a document the reader rejects is
  // never stored.
  const { findings, tier } = detect(format, bytes);
  const job: Job = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    filename,
    format,
    status: 'detected',
    findings,
  };
  if (tier) job.tier = tier;
  if (options.cui) job.cui = true;
  if ('account' in options.owner) job.account = options.owner.account;
  else job.visitor = options.owner.visitor;
  const dir = dirFor(job.id);
  await mkdir(dir, { recursive: true });
  await writeBlob(job.id, `original.${format}`, bytes);
  await writeRecord(job);
  return job;
}

export async function getJob(id: string): Promise<Job | null> {
  if (!ID.test(id)) return null;
  const job = await readRecord(id);
  if (!job) return null;
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
  if (job.format === 'pdf' && !job.tier) return false;
  return job.findings.every((f) => typeof f.kind === 'string');
}

async function redetect(job: Job): Promise<Job> {
  const bytes = await readBlob(job.id, `original.${job.format}`);
  if (!bytes) return job;
  // Whichever format the job is. This read the Word parts unconditionally
  // until the tier made PDFs repairable too, which would have thrown on the
  // first PDF record an older build had written.
  const { findings, tier } = detect(job.format, bytes);
  const repaired: Job = { ...job, findings };
  if (tier) repaired.tier = tier;
  await writeRecord(repaired);
  return repaired;
}

/**
 * Hand a browser's jobs to the account that browser just signed in to.
 *
 * Somebody uploads, reads the free assessment, decides to keep the work and
 * makes an account. Without this their document is stranded behind a cookie
 * that no longer decides anything. Claiming is a deliberate write and not a
 * side effect of reading: `mayOpen` already lets a signed-in person *see* a
 * job their own browser uploaded, so nothing is urgent about the transfer
 * and nothing is lost if it never happens.
 *
 * Only a job still owned by that visitor moves. A job already owned by an
 * account is never reassigned by this path — a cookie is not evidence about
 * who an account is.
 */
export async function claimJobs(visitor: string, account: string): Promise<number> {
  let ids: string[];
  try {
    ids = await readdir(ROOT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  let claimed = 0;
  for (const id of ids) {
    if (!ID.test(id)) continue;
    let job: Job;
    try {
      const found = await readRecord(id);
      if (!found) continue;
      job = found;
    } catch {
      // A directory without a readable record is not a job to claim.
      continue;
    }
    if (job.account || job.visitor !== visitor) continue;
    delete job.visitor;
    job.account = account;
    await writeRecord(job);
    claimed += 1;
  }
  return claimed;
}


/**
 * Every read and write of a customer's bytes goes through these four
 * functions, and nothing else in this file touches the filesystem for one.
 *
 * That is what makes encryption at rest a property of the store rather than
 * a thing nine call sites each remember, and it is the seam an object store
 * slides into when this stops being local disk. The job id is passed as
 * associated data on every seal, so a record or a document cannot be moved
 * into another job's directory and still open — without that, moving files
 * around is a way to read somebody else's document.
 */
async function writeRecord(job: Job): Promise<void> {
  await writeFile(path.join(dirFor(job.id), 'job.json'), sealText(JSON.stringify(job, null, 2), job.id));
}

async function readRecord(id: string): Promise<Job | null> {
  try {
    const stored = new Uint8Array(await readFile(path.join(dirFor(id), 'job.json')));
    return JSON.parse(openText(stored, id)) as Job;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeBlob(id: string, name: string, bytes: Uint8Array): Promise<void> {
  await writeFile(path.join(dirFor(id), name), seal(bytes, id));
}

async function readBlob(id: string, name: string): Promise<Uint8Array | null> {
  try {
    return unseal(new Uint8Array(await readFile(path.join(dirFor(id), name))), id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
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
    const bytes = await readBlob(id, `${which}.${job.format}`);
    if (!bytes) return null;
    return { bytes, filename: deliveredName(job.filename, which), format: job.format };
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
  const original = (await readBlob(job.id, `original.${job.format}`)) ?? new Uint8Array();
  if (job.format === 'pdf') return rebuildPdf(job, original);
  const parts = readDocxParts(original);
  const auto = remediateDocx(parts, { fallbackTitle: stem(job.filename) });
  const reviewed = applyDecisions(auto.parts, job.findings);
  const remediated = writeDocx(original, reviewed.parts);
  const after = detect(job.format, remediated).findings;

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
  await writeBlob(job.id, `remediated.${job.format}`, remediated);
  await writeRecord(updated);
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
  await writeRecord(job);
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
    const original = (await readBlob(job.id, `original.${job.format}`)) ?? new Uint8Array();
    return imagesForFindings(original, job.format, job.findings);
  } catch {
    // A document that cannot be reopened is a broken job, not a broken
    // page: the queue still lists the findings and the reviewer still works.
    return new Map();
  }
}

/**
 * One figure's bytes, for the route that shows it — drawing it first if the
 * document holds paths rather than a picture.
 *
 * The drawing happens here, one figure at a time, rather than in
 * `figureImages`. A submission with 76 vector figures would otherwise
 * render all 76 before the review page painted a single pixel; this way the
 * page draws immediately and the browser fetches the images the way it
 * fetches any other, in parallel and as they are needed.
 */
export async function figureImage(id: string, findingKeyValue: string): Promise<FigureResult> {
  const found = (await figureImages(id)).get(findingKeyValue) ?? { ok: false, reason: 'not-found' as const };
  if (found.ok || !found.render) return found;

  const job = await getJob(id);
  if (!job) return { ok: false, reason: 'not-found' };

  // Loaded through `await import` for the same reason `vision.ts` is: the
  // renderer takes npm dependencies, this store is in the test suite's
  // import graph, and `npm test` runs with nothing installed.
  const { renderFigure } = await import('./render');
  const original = await readBlob(job.id, `original.${job.format}`);
  if (!original) return { ok: false, reason: 'not-found' };
  return renderFigure(original, found.render);
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

  const original = (await readBlob(job.id, `original.${job.format}`)) ?? new Uint8Array();
  const found = imageForFinding(original, job.format, target);

  // Vector artwork is drawn before it is described. The crop is what makes
  // that allowed: one figure leaves, never the page it sits on.
  let image;
  if (found.ok) {
    image = found.image;
  } else if (found.render) {
    const { renderFigure } = await import('./render');
    const drawn = await renderFigure(original, found.render);
    if (!drawn.ok) return { ok: false, reason: drawn.reason };
    image = drawn.image;
  } else {
    return { ok: false, reason: found.reason };
  }

  let draft;
  try {
    draft = await draftAltText(image);
  } catch (error) {
    // Nothing about the document goes into this path: the shape of the
    // failure is all that is kept.
    if (error instanceof VisionUnavailableError) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'refused' };
  }
  if (draft.refused || !draft.text) return { ok: false, reason: 'refused' };

  target.proposal = { text: draft.text, at: new Date().toISOString() };
  await writeRecord(job);
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
  await writeRecord(job);
  return job;
}

export async function unconfirm(id: string, criterion: string): Promise<Job | null> {
  const job = await getJob(id);
  if (!job?.confirmations?.[criterion]) return null;
  const { [criterion]: _gone, ...rest } = job.confirmations;
  void _gone;
  job.confirmations = rest;
  job.status = statusOf(job);
  await writeRecord(job);
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
  await writeBlob(job.id, `remediated.${job.format}`, remediated);
  await writeRecord(updated);
  return updated;
}

function key(f: Finding): string {
  return `${f.kind}|${f.location}`;
}

function stem(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}


/**
 * The customer has the delivered file. Two things happen, and they are the
 * two halves of the Chairman's retention decision:
 *
 * 1. **The clock starts.** Seven days, from now, not from upload — a
 *    conformance review does not finish on a schedule, and a clock started
 *    at upload deletes the file in the middle of the job.
 * 2. **The record is scrubbed.** The detectors write the customer's own
 *    sentences into nearly every finding, and deleting the document in
 *    seven days while keeping a record that quotes it is a deletion policy
 *    in name only.
 *
 * Idempotent: downloading twice does not restart the clock, because the
 * seven days run from when the customer first had what they came for.
 */
export async function markDelivered(id: string): Promise<Job | null> {
  const job = await readRecord(id);
  if (!job || job.deleteAfter) return job;

  const now = new Date().toISOString();
  const delivered: Job = { ...scrubJob(job, now), deleteAfter: deleteAfterFor(now) };
  await writeRecord(delivered);
  return delivered;
}

/**
 * Remove the documents whose time is up, and keep their records.
 *
 * The record outlives the file on purpose. A conformance statement is a
 * claim somebody may have to answer for years later, and an audit log that
 * names a job id which resolves to nothing turns a record of what happened
 * into a record that something happened. What goes is the customer's
 * document and everything made from it; what stays is the finding list with
 * the customer's words already taken out of it.
 *
 * Nothing calls this on a timer yet. It is a function so that whatever ends
 * up calling it — a cron, a queue, a request — calls the same one.
 */
export async function sweepExpired(now = Date.now()): Promise<string[]> {
  let ids: string[];
  try {
    ids = await readdir(ROOT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const swept: string[] = [];
  for (const id of ids) {
    if (!ID.test(id)) continue;
    const job = await readRecord(id);
    if (!job || job.deletedAt || !expired(job, now)) continue;

    for (const name of [`original.${job.format}`, `remediated.${job.format}`]) {
      await rm(path.join(dirFor(id), name), { force: true });
    }
    await writeRecord({ ...job, deletedAt: new Date(now).toISOString() });
    swept.push(id);
  }
  return swept;
}
