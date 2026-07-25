import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { MAX_PHOTO_BYTES, OPEN_SUBMISSION_STATUSES } from "@/lib/photos";
import { signUpload } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

// Both sizes are required because both objects are signed: the signature binds
// the exact byte count, so the browser has to declare the thumbnail up front too.
const presignSchema = z.object({
  submissionId: z.number().int().positive(),
  contentType: z.literal("image/jpeg"),
  size: z.number().int().positive().max(MAX_PHOTO_BYTES),
  thumbnailSize: z.number().int().positive().max(MAX_PHOTO_BYTES),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "worker" || !profile.worker_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = presignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  const body = parsed.data;

  // The submission must belong to this worker and still be open for evidence.
  const supabase = await createClient();
  const { data: submission } = await supabase
    .from("completion_submission")
    .select("id,status")
    .eq("id", body.submissionId)
    .eq("worker_id", profile.worker_id)
    .single();
  if (!submission) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!OPEN_SUBMISSION_STATUSES.includes(submission.status)) {
    return NextResponse.json({ error: "That submission is closed" }, { status: 409 });
  }

  const token = crypto.randomUUID();
  const prefix = `tenants/${profile.tenant_id}/workers/${profile.worker_id}/submissions/${body.submissionId}`;
  const storageKey = `${prefix}/${token}.jpg`;
  const thumbnailKey = `${prefix}/${token}-thumb.jpg`;

  return NextResponse.json(
    {
      storageKey,
      thumbnailKey,
      uploadUrl: await signUpload(storageKey, "image/jpeg", body.size),
      thumbnailUploadUrl: await signUpload(thumbnailKey, "image/jpeg", body.thumbnailSize),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
