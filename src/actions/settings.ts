"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/actions/types";

export async function updateTenantSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  const manager = await assertRole("manager");
  const name = String(formData.get("name") ?? "").trim();
  const abn = String(formData.get("abn") ?? "").trim();
  const retention = Number(formData.get("retentionYears"));
  if (name.length < 2 || !Number.isInteger(retention)) return { error: "Check the company settings." };
  const supabase = await createClient();
  const { error } = await supabase.from("tenant").update({ name, abn: abn || null, retention_years: retention, sms_enabled: formData.get("smsEnabled") === "on", mfa_required_for_managers: formData.get("mfaRequired") === "on" }).eq("id", manager.tenant_id);
  if (error) return { error: error.message };
  revalidatePath("/manager/settings");
  return { ok: true, message: "Settings saved." };
}
