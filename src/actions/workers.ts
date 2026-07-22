"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/actions/types";

export async function inviteWorker(_: ActionState, formData: FormData): Promise<ActionState> {
  const manager = await assertRole("manager");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  if (displayName.length < 2 || !email.includes("@")) return { error: "Enter the worker's name and a valid email." };
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { tenant_id: manager.tenant_id, role: "worker", display_name: displayName, phone },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback?next=/update-password&intent=invite`,
    });
    if (error) return { error: error.message };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The invitation could not be sent." };
  }
  revalidatePath("/manager/workers");
  return { ok: true, message: `Invitation sent to ${email}.` };
}

export async function disableWorker(_: ActionState, formData: FormData): Promise<ActionState> {
  const manager = await assertRole("manager");
  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!userId || !reason) return { error: "A reason is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("user_profile").update({ is_active: false, disabled_at: new Date().toISOString(), disabled_reason: reason }).eq("id", userId).eq("tenant_id", manager.tenant_id).eq("role", "worker");
  if (error) return { error: "The worker could not be disabled." };
  const admin = createAdminClient();
  await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  revalidatePath("/manager/workers");
  return { ok: true, message: "Worker disabled. Their open work is flagged for reassignment." };
}
