'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { Decision } from '@/domain/findings';
import { confirm, decide, getJob, propose, setReviewer, unconfirm, undecide } from '@/server/jobs';

/**
 * The reviewer's hands.
 *
 * Every decision is attributed, because the name goes on the conformance
 * statement and a statement with nobody's name on it is not an assurance.
 * The name is set once by `identifyAction` and read from the job record by
 * everything else; it is deliberately *not* a field on the decision forms.
 * It used to be, and that meant fifteen "Your name" boxes on one screen, a
 * promise at the top of the page that the page did not keep, and one fact
 * stored in two places that could go out of step.
 *
 * Nothing about the document is logged on any path.
 */
function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === 'string' ? v.trim() : '';
}

function back(id: string, problem?: string): never {
  revalidatePath(`/jobs/${id}`);
  revalidatePath(`/jobs/${id}/review`);
  revalidatePath(`/jobs/${id}/report`);
  redirect(`/jobs/${id}/review${problem ? `?problem=${problem}` : ''}`);
}

/** The name that goes on the statement, set once for the job. */
export async function identifyAction(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  if (!(await setReviewer(id, field(formData, 'reviewer')))) back(id, 'name');
  back(id);
}

async function reviewerOf(id: string): Promise<string> {
  return (await getJob(id))?.reviewer ?? '';
}

export async function decideAction(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  const key = field(formData, 'key');
  const by = await reviewerOf(id);
  const action = field(formData, 'action');
  const value = field(formData, 'value');
  const note = field(formData, 'note');
  if (!by) back(id, 'name');
  if (action !== 'apply' && action !== 'decorative' && action !== 'dismiss') back(id, 'action');
  if (action === 'apply' && !value) back(id, 'value');
  if (action === 'dismiss' && !note) back(id, 'note');
  const decision: Decision = { action, by, at: new Date().toISOString() };
  if (value) decision.value = value;
  if (note) decision.note = note;
  await decide(id, key, decision);
  back(id);
}

/**
 * Draft a description for one figure. It fills the box the reviewer was
 * going to type in and changes nothing in the document; only the button
 * beneath it, pressed by a named person, does that.
 */
export async function proposeAction(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  const result = await propose(id, field(formData, 'key'));
  if (!result.ok) back(id, `draft-${result.reason}`);
  back(id);
}

export async function undoAction(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  await undecide(id, field(formData, 'key'));
  back(id);
}

export async function confirmAction(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  const by = await reviewerOf(id);
  if (!by) back(id, 'name');
  await confirm(id, field(formData, 'criterion'), by);
  back(id);
}

export async function unconfirmAction(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  await unconfirm(id, field(formData, 'criterion'));
  back(id);
}
