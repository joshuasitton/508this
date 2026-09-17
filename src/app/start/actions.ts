'use server';

import { redirect } from 'next/navigation';

import { checkUpload, type UploadProblem } from '@/domain/job';
import { NotADocxError } from '@/server/docx';
import { createJob } from '@/server/jobs';

/**
 * The upload. Validation runs in the order a person can act on, and every
 * failure returns them to the form with one sentence. Nothing about the
 * document – not its name, not its size, not a byte of it – is logged on
 * either path; the invariant in CLAUDE.md is a rule about this function
 * before it is a rule about anything else.
 */
export async function startJob(formData: FormData): Promise<void> {
  const entry = formData.get('document');
  const file = entry instanceof File ? entry : null;
  if (!file) return back('no-file');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(file.name, bytes.byteLength, bytes.subarray(0, 4));
  if (!check.ok) return back(check.reason);

  let id: string;
  try {
    const job = await createJob(file.name, check.format, bytes);
    id = job.id;
  } catch (error) {
    if (error instanceof NotADocxError) return back('not-a-document');
    // A parse error in the detector is a bug or a hostile file, and either
    // way the person gets the same honest sentence. The error itself is not
    // rethrown with the document attached.
    return back('not-a-document');
  }
  redirect(`/jobs/${id}`);
}

function back(problem: UploadProblem): never {
  redirect(`/start?problem=${problem}`);
}
