'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { remediate } from '@/server/access';

/**
 * The button. One job, one run; running it again is harmless because every
 * fix is idempotent and re-detection decides what is remediated, not the
 * button. Nothing about the document is logged on either path.
 */
export async function remediateAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const job = await remediate(id);
  if (!job) redirect('/start?problem=no-file');
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
}
