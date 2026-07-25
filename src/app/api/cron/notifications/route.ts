import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { brandNotificationBody } from "@/lib/brand";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/redact";
import { createAdminClient } from "@/lib/supabase/admin";

const BATCH_LIMIT = 50;

type ClaimedNotification = {
  id: number;
  channel: "in_app" | "email" | "sms";
  subject: string;
  body_redacted: string;
  attempts: number;
  recipient_email: string | null;
  recipient_phone: string | null;
};

function authorised(request: Request, secret: string) {
  const actual = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function POST(request: Request) {
  const env = getServerEnv();
  if (!env.CRON_SECRET || !authorised(request, env.CRON_SECRET))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();

  // Claim before sending. A plain select-then-send let two overlapping runs pick
  // up the same rows and deliver them twice; claim_notifications locks and stamps
  // each row so only one dispatcher owns it.
  const { data, error: claimError } = await admin.rpc("claim_notifications", {
    p_limit: BATCH_LIMIT,
  });
  if (claimError) {
    logger.error("notification.claim_failed", claimError);
    return NextResponse.json({ error: "Could not claim notifications" }, { status: 500 });
  }
  const claimed = (data ?? []) as ClaimedNotification[];

  let sent = 0;
  for (const item of claimed) {
    try {
      let externalId: string | null = null;
      const body = brandNotificationBody(item.body_redacted);
      if (item.channel === "email") {
        if (!env.RESEND_API_KEY || !env.RESEND_FROM || !item.recipient_email)
          throw new Error("Email provider is not configured");
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.RESEND_FROM,
            to: [item.recipient_email],
            subject: item.subject,
            text: body,
          }),
        });
        if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
        externalId = ((await response.json()) as { id?: string }).id ?? null;
      } else if (item.channel === "sms") {
        if (
          !env.TWILIO_ACCOUNT_SID ||
          !env.TWILIO_AUTH_TOKEN ||
          !env.TWILIO_FROM ||
          !item.recipient_phone
        )
          throw new Error("SMS provider is not configured");
        const form = new URLSearchParams({
          To: item.recipient_phone,
          From: env.TWILIO_FROM,
          Body: body,
        });
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form,
          },
        );
        if (!response.ok) throw new Error(`SMS provider returned ${response.status}`);
        externalId = ((await response.json()) as { sid?: string }).sid ?? null;
      }
      await admin
        .from("notification")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          external_id: externalId,
          attempts: item.channel === "in_app" ? item.attempts : item.attempts + 1,
          last_error: null,
        })
        .eq("id", item.id);
      sent += 1;
    } catch (error) {
      logger.error("notification.dispatch_failed", error);
      // The row keeps its claimed_at, so the lease window doubles as retry
      // backoff rather than this failing again on the very next run.
      await admin
        .from("notification")
        .update({
          status: "failed",
          attempts: item.attempts + 1,
          last_error: error instanceof Error ? error.message.slice(0, 240) : "Dispatch failed",
        })
        .eq("id", item.id);
    }
  }

  // A full batch means there is very likely more waiting. Say so rather than
  // letting a silent cap look like an empty queue.
  const truncated = claimed.length === BATCH_LIMIT;
  if (truncated) logger.info("notification.batch_truncated", { limit: BATCH_LIMIT });

  return NextResponse.json({ processed: claimed.length, sent, truncated });
}
