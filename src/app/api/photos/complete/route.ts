import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { MAX_PHOTO_BYTES, OPEN_SUBMISSION_STATUSES } from "@/lib/photos";
import { statObject } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

const completeSchema = z.object({
  submissionId: z.number().int().positive(),
  storageKey: z.string().min(1).max(500),
  thumbnailKey: z.string().min(1).max(500),
  contentType: z.literal("image/jpeg"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "worker" || !profile.worker_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = completeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  const body = parsed.data;

  // Both keys must sit under this worker's own submission prefix. submissionId is
  // schema-checked as a positive integer before it reaches this template, so it
  // cannot smuggle path segments into the prefix it is compared against.
  const prefix = `tenants/${profile.tenant_id}/workers/${profile.worker_id}/submissions/${body.submissionId}/`;
  if (!body.storageKey.startsWith(prefix) || !body.thumbnailKey.startsWith(prefix)) {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

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

  // Ask R2 what actually landed instead of trusting the browser's claim. This
  // rejects a photo row for an object that was never uploaded, and records the
  // true byte count rather than a self-reported one.
  const [stored, storedThumbnail] = await Promise.all([
    statObject(body.storageKey),
    statObject(body.thumbnailKey),
  ]);
  if (!stored || !storedThumbnail) {
    return NextResponse.json({ error: "Upload was not found in storage" }, { status: 409 });
  }
  if (stored.size > MAX_PHOTO_BYTES || storedThumbnail.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "That photo is too large" }, { status: 413 });
  }

  const { error } = await supabase.from("completion_photo").insert({
    tenant_id: profile.tenant_id,
    completion_submission_id: body.submissionId,
    storage_key: body.storageKey,
    thumbnail_key: body.thumbnailKey,
    content_type: body.contentType,
    size_bytes: stored.size,
    width: body.width,
    height: body.height,
    uploaded_by: profile.id,
  });

  return error
    ? NextResponse.json({ error: "Could not record photo" }, { status: 400 })
    : NextResponse.json({ ok: true });
}
