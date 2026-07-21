import { NextResponse } from "next/server";
import { assertRole } from "@/lib/auth";
import { signDownload } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await assertRole("manager");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("attachment").select("storage_key,visibility,deleted_at").eq("id", Number(id)).single();
  if (!data || data.deleted_at) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = await signDownload(data.storage_key, 120);
  return NextResponse.redirect(url, 302);
}
