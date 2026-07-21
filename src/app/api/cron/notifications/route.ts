import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/redact";

function authorised(request: Request, secret: string) {
  const actual = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function POST(request: Request) {
  const env = getServerEnv();
  if (!env.CRON_SECRET || !authorised(request, env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: queued } = await admin.from("notification").select("id,channel,subject,body_redacted,attempts,recipient:recipient_user_id(email,phone)").in("status", ["queued", "failed"]).lt("attempts", 5).order("created_at").limit(50);
  let sent = 0;
  for (const item of queued ?? []) {
    const recipient = item.recipient as unknown as { email: string; phone: string | null } | null;
    try {
      let externalId: string | null = null;
      if (item.channel === "email") {
        if (!env.RESEND_API_KEY || !env.RESEND_FROM || !recipient?.email) throw new Error("Email provider is not configured");
        const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.RESEND_FROM, to: [recipient.email], subject: item.subject, text: item.body_redacted }) });
        if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
        externalId = (await response.json() as { id?: string }).id ?? null;
      } else if (item.channel === "sms") {
        if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM || !recipient?.phone) throw new Error("SMS provider is not configured");
        const form = new URLSearchParams({ To: recipient.phone, From: env.TWILIO_FROM, Body: item.body_redacted });
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
        if (!response.ok) throw new Error(`SMS provider returned ${response.status}`);
        externalId = (await response.json() as { sid?: string }).sid ?? null;
      }
      await admin.from("notification").update({ status: "sent", sent_at: new Date().toISOString(), external_id: externalId, attempts: item.channel === "in_app" ? item.attempts : item.attempts + 1, last_error: null }).eq("id", item.id);
      sent += 1;
    } catch (error) {
      logger.error("notification.dispatch_failed", error);
      await admin.from("notification").update({ status: "failed", attempts: item.attempts + 1, last_error: error instanceof Error ? error.message.slice(0, 240) : "Dispatch failed" }).eq("id", item.id);
    }
  }
  return NextResponse.json({ processed: queued?.length ?? 0, sent });
}

export const GET = POST;
