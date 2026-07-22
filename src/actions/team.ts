"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/actions/types";
import { assertRole } from "@/lib/auth";
import { APP_ROLES, type AppRole } from "@/lib/domain";
import { createAdminClient } from "@/lib/supabase/admin";

function isAppRole(value: string): value is AppRole {
  return APP_ROLES.some((role) => role === value);
}

export async function inviteTeamMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const manager = await assertRole("manager");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (displayName.length < 2 || displayName.length > 200) {
    return { error: "Enter a name between 2 and 200 characters." };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (phone.length > 40) {
    return { error: "The mobile number must be 40 characters or fewer." };
  }
  if (!isAppRole(role)) {
    return { error: "Choose a valid account type." };
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        tenant_id: manager.tenant_id,
        role,
        display_name: displayName,
        phone,
      },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback?next=/update-password&intent=invite`,
    });
    if (error) return { error: error.message };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The invitation could not be sent." };
  }

  revalidatePath("/manager/settings");
  revalidatePath("/manager/workers");
  return { ok: true, message: `Invitation sent to ${email}.` };
}
