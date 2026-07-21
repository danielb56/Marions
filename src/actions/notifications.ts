"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function markNotificationRead(formData: FormData) {
  await requireProfile();
  const id = Number(formData.get("notificationId"));
  const supabase = await createClient();
  await supabase.rpc("mark_notification_read", { p_notification_id: id });
  revalidatePath("/manager/notifications"); revalidatePath("/worker/notifications");
}
