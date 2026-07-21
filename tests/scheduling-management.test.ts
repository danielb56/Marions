import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("manager schedule cancellation", () => {
  const migration = source("supabase/migrations/0014_unschedule_entry.sql");

  it("authorises and tenant-scopes the entry before deleting it", () => {
    expect(migration).toContain("if not public.is_manager()");
    expect(migration).toContain("id = p_schedule_entry_id and tenant_id = tenant_key");
    expect(migration.indexOf("if not public.is_manager()")).toBeLessThan(migration.indexOf("delete from public.schedule_entry"));
  });

  it("returns a task to assigned only after its last scheduled date is removed", () => {
    expect(migration).toContain("status = 'scheduled' and not exists");
    expect(migration).toContain("then 'assigned'::public.task_status");
  });

  it("keeps the manager reason out of worker notification bodies", () => {
    const notifications = migration.slice(migration.indexOf("if schedule_row.worker_id"), migration.indexOf("insert into public.audit_event"));
    expect(notifications).not.toContain("p_reason");
    expect(migration).toContain("jsonb_build_object('reason', trim(p_reason))");
  });
});

describe("total-only work order pricing", () => {
  it("does not collect or query per-task pricing", () => {
    const form = source("src/components/work-order-form.tsx");
    const detail = source("src/app/manager/work-orders/[id]/page.tsx");
    expect(form).not.toMatch(/unitRate|Rate <|subtotalDisplay|gstRate/);
    expect(detail).not.toMatch(/task_pricing|unit_rate_cents|line_total_cents/);
  });

  it("accepts one total cost and derives the legacy storage fields server-side", () => {
    const action = source("src/actions/work-orders.ts");
    expect(action).toContain("subtotalCents: parsed.data.totalCents");
    expect(action).toContain("gstCents: 0");
    expect(action).toContain("totalOverride: true");
  });
});
