"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/actions/types";

export async function startTask(formData: FormData) {
  await assertRole("worker");
  const taskId = Number(formData.get("taskId"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("worker_start_task", { p_task_id: taskId });
  if (error) throw new Error(error.message);
  revalidatePath(`/worker/tasks/${taskId}`); revalidatePath("/worker");
}

export async function submitCompletion(_: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole("worker");
  const taskId = Number(formData.get("taskId"));
  const notes = String(formData.get("notes") ?? "");
  const cannotComplete = formData.get("cannotComplete") === "on";
  const problemReport = String(formData.get("problemReport") ?? "");
  if (!taskId) return { error: "Task not found." };
  if (cannotComplete && !problemReport.trim()) return { error: "Describe what stopped the work." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("worker_submit_completion", { p_task_id: taskId, p_notes: notes, p_cannot_complete: cannotComplete, p_problem_report: problemReport });
  if (error) return { error: error.message };
  revalidatePath("/worker"); revalidatePath(`/worker/tasks/${taskId}`);
  redirect(`/worker/tasks/${taskId}?submitted=${data}`);
}

export async function addWorkerNote(_: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await assertRole("worker");
  const taskId = Number(formData.get("taskId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!taskId || !body) return { error: "Write a note first." };
  const supabase = await createClient();
  const { error } = await supabase.from("note").insert({ tenant_id: profile.tenant_id, parent_type: "task", parent_id: taskId, author_user_id: profile.id, body, visibility: "worker_visible", note_type: "general" });
  if (error) return { error: "The note could not be saved." };
  revalidatePath(`/worker/tasks/${taskId}`);
  return { ok: true, message: "Note added." };
}

export async function updateWorkerProfile(_: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole("worker");
  const name = String(formData.get("displayName") ?? "");
  const phone = String(formData.get("phone") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", { p_display_name: name, p_phone: phone });
  if (error) return { error: error.message };
  revalidatePath("/worker/profile");
  return { ok: true, message: "Profile updated." };
}
