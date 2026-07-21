import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { signDownload } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("completion_photo").select("storage_key,thumbnail_key").eq("id", Number(id)).single();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const key = request.nextUrl.searchParams.has("thumbnail") && data.thumbnail_key ? data.thumbnail_key : data.storage_key;
  return NextResponse.redirect(await signDownload(key, 120), 302);
}
