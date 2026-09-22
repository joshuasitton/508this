'use server';

import { redirect } from 'next/navigation';

import { checkUpload, type UploadProblem } from '@/domain/job';
import { mayMarkCui } from '@/domain/viewer';
import { ownerForUpload } from '@/server/access';
import { NotADocxError } from '@/server/docx';
import { createJob } from '@/server/jobs';
import { record } from '@/server/audit';

/**
 * The upload. Validation runs in the order a person can act on, and every
 * failure returns them to the form with one sentence. Nothing about the
 * document – not its name, not its size, not a byte of it – is logged on
 * either path; the invariant in CLAUDE.md is a rule about this function
 * before it is a rule about anything else.
 *
 * The CUI declaration is taken here and nowhere else. A document marked
 * Controlled Unclassified Information never has any part of it sent to a
 * model, so the answer has to be recorded before the job exists rather than
 * asked for later when a reviewer is in a hurry.
 *
 * It is also the one declaration that needs an account. 800-171 asks for an
 * identified, authenticated user and a browser cookie is neither; the check
 * is here rather than further in because by the time the document is stored
 * it is stored under a promise the service cannot keep. Everything else can
 * be uploaded by a stranger, which is the Chairman's decision and the whole
 * reason the free assessment is worth having.
 */
export async function startJob(formData: FormData): Promise<void> {
  const entry = formData.get('document');
  const file = entry instanceof File ? entry : null;
  if (!file) return back('no-file');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(file.name, bytes.byteLength, bytes.subarray(0, 4));
  if (!check.ok) return back(check.reason);

  const cui = formData.get('cui') === 'yes';
  const { owner, who } = await ownerForUpload();
  if (cui && !mayMarkCui(who)) return back('cui-needs-account');

  let id: string;
  try {
    const job = await createJob(file.name, check.format, bytes, { cui, owner });
    await record('job.created', 'account' in owner ? owner.account : null, job.id);
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
