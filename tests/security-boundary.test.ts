import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8");

describe("database security boundaries", () => {
  it("does not expose internal security-definer helpers as public RPCs", () => {
    expect(migration("0003_trade_category_seed.sql")).toContain(
      "revoke all on function public.seed_trade_categories(uuid) from public",
    );
    expect(migration("0007_status_history_triggers.sql")).toContain(
      "revoke all on function public.recompute_work_order_status(bigint) from public",
    );
    expect(migration("0010_notification_pdf_import_extraction.sql")).toContain(
      "revoke all on function public.queue_notification(uuid, public.notification_channel, text, text, text) from public",
    );
  });

  it("forces completion creation through the state-owning RPC", () => {
    const sql = migration("0008_completion_note_attachment_photo.sql");
    expect(sql).not.toContain("submission_worker_insert");
    expect(sql).not.toMatch(/grant\s+[^;]*insert[^;]*on\s+public\.completion_submission/i);
  });

  it("prevents workers from spoofing another note author", () => {
    const sql = migration("0008_completion_note_attachment_photo.sql");
    expect(sql).toContain("author_user_id = auth.uid()");
    expect(sql).toContain("note_type <> 'internal'");
  });

  it("checks task tenancy before an assignment mutation", () => {
    const sql = migration("0011_rls_pricing_leak_views.sql");
    const functionBody = sql.slice(sql.indexOf("public.assign_task"), sql.indexOf("public.schedule_task"));
    expect(functionBody.indexOf("Task not found")).toBeGreaterThan(-1);
    expect(functionBody.indexOf("Task not found")).toBeLessThan(functionBody.indexOf("update public.assignment"));
  });
});
