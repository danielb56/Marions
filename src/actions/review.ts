"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/actions/types";

export async function reviewSubmission(_: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole("manager");
  const submissionId = Number(formData.get("submissionId"));
  const decision = String(formData.get("decision") ?? "");
  const notes = String(formData.get("reviewNotes") ?? "");
  if (!submissionId || !["approved", "changes_requested", "rejected"].includes(decision)) return { error: "Choose a review decision." };
  if (decision !== "approved" && !notes.trim()) return { error: "A note is required when returning or rejecting work." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("manager_review_submission", { p_submission_id: submissionId, p_decision: decision, p_review_notes: notes });
  if (error) return { error: error.message };
  revalidatePath("/manager/review"); revalidatePath("/manager"); revalidatePath("/manager/work-orders");
  return { ok: true, message: decision === "approved" ? "Completion approved." : "Work returned to the worker." };
}
