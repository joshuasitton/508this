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
import type { Format, Job } from '@/domain/job';
import { readDocxParts } from './docx';

const ROOT = process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), 'documents');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function dirFor(id: string): string {
  if (!ID.test(id)) throw new Error('Invalid job id');
  return path.join(ROOT, id);
}

export async function createJob(filename: string, format: Format, bytes: Uint8Array): Promise<Job> {
  // Detect before writing anything, so a document the reader rejects is
  // never stored.
  const findings = detectDocx(readDocxParts(bytes));
  const job: Job = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    filename,
    format,
    status: 'detected',
    findings,
  };
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
