import { buildAcr } from '@/domain/acr';
import { acrFilename } from '@/domain/acrDocx';
import { acrDocx } from '@/server/acr';
import { openJobToChange } from '@/server/access';
import { DOCX_TYPE, attachment } from '@/server/download';

/**
 * The conformance statement as a Word file. Built on demand rather than
 * stored, because it is a function of the job and the job is what changes:
 * a reviewer confirms a criterion, and the statement that was a draft a
 * minute ago is a deliverable. Storing it would mean two records of the same
 * assessment and a way for them to disagree.
 *
 * The timestamp written into the file is the job's, not the clock's, so
 * downloading the same statement twice gives the same bytes and a customer
 * comparing two copies is not told they differ.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await openJobToChange(id);
  if (!job) return new Response('Not found', { status: 404 });

  const acr = buildAcr(job);
  const bytes = acrDocx(acr, job.remediatedAt ?? job.createdAt);
  return attachment(bytes, acrFilename(job.filename), DOCX_TYPE);
}
