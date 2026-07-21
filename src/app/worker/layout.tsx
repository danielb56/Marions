import { WorkerShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("worker");
  const supabase = await createClient();
  const { count } = await supabase.from("notification").select("id", { count: "exact", head: true }).eq("recipient_user_id", profile.id).is("read_at", null);
  return <WorkerShell profile={profile} unread={count ?? 0}>{children}</WorkerShell>;
}
