'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { Decision } from '@/domain/findings';
import { confirm, decide, unconfirm, undecide } from '@/server/jobs';

/**
 * The reviewer's hands. Every action needs a name, because the name goes on
 * the statement; a form without one goes back with the field marked. Nothing
 * about the document is logged on any path.
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

export async function decideAction(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  const key = field(formData, 'key');
  const by = field(formData, 'reviewer');
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

export async function undoAction(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  await undecide(id, field(formData, 'key'));
  back(id);
}

export async function confirmAction(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  const by = field(formData, 'reviewer');
  if (!by) back(id, 'name');
  await confirm(id, field(formData, 'criterion'), by);
  back(id);
}

export async function unconfirmAction(formData: FormData): Promise<void> {
  const id = field(formData, 'id');
  await unconfirm(id, field(formData, 'criterion'));
  back(id);
}
