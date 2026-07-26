import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const sql = read("supabase/migrations/0023_cancel_releases_workers.sql").replace(/\s+/g, " ");
const calendar = read("src/app/manager/calendar/page.tsx").replace(/\s+/g, " ");
const dashboard = read("src/app/manager/page.tsx").replace(/\s+/g, " ");

describe("cancelling releases the workers", () => {
  // 0020 cancelled the tasks but never touched assignment, so every query that
  // filters on status <> 'reassigned' still saw the work as assigned.
  it("retires the assignments of the cancelled tasks", () => {
    expect(sql).toContain("update public.assignment set status = 'reassigned'");
    expect(sql).toContain("reassigned_reason = 'Work order cancelled: ' || trim(p_reason)");
  });

  it("leaves completed tasks' assignments alone", () => {
    expect(sql).toContain("and task_id = any(cancelled_task_ids) and status <> 'reassigned'");
    expect(sql).toContain("t.status not in ('cancelled', 'completed')");
  });

  it("clears the order's lead worker", () => {
    expect(sql).toContain("lead_worker_id = null");
  });

  it("clears every date for the order, not only the cancelled tasks'", () => {
    expect(sql).toContain(
      "delete from public.schedule_entry where tenant_id = tenant_key and (work_order_id = p_work_order_id or task_id = any(all_task_ids))",
    );
  });

  it("reports what it released", () => {
    expect(sql).toContain("'releasedAssignments', released_assignments");
  });

  it("still cancels tasks before the order so the roll-up cannot override it", () => {
    expect(sql.indexOf("update public.task set status = 'cancelled'")).toBeLessThan(
      sql.indexOf("set status = 'cancelled', cancelled_at = now()"),
    );
  });
});

describe("backfill for orders cancelled before this migration", () => {
  it("targets cancelled orders that still hold live state", () => {
    expect(sql).toContain("where wo.status = 'cancelled'");
    expect(sql).toContain("wo.lead_worker_id is not null");
  });

  it("cancels their leftover tasks and releases the assignments", () => {
    expect(sql).toContain(
      "update public.task set status = 'cancelled', revised_since_viewed = true where id = any(stale_task_ids)",
    );
    expect(sql).toContain("where task_id = any(stale_task_ids) and status <> 'reassigned'");
  });

  // These cancellations already happened; notifying now would be noise.
  it("records the repair without notifying anyone", () => {
    expect(sql).toContain("'work_order.cancellation_repaired'");
    expect(sql).toContain("'{}'::bigint[], false");
    const backfill = sql.slice(sql.indexOf("Backfill: repair orders"));
    expect(backfill).not.toContain("queue_notification");
  });
});

describe("cancelled orders leave the manager queues", () => {
  it("filters them out of the calendar's task query at the database", () => {
    expect(calendar).toContain("work_order:work_order_id!inner(");
    expect(calendar).toContain('.neq("work_order.status", "cancelled")');
  });

  it("covers all three queues, since they all derive from that one query", () => {
    expect(calendar).toContain("const assignedButUnscheduled = taskRows.filter(");
    expect(calendar).toContain("const scheduled = taskRows");
    expect(calendar).toContain("const unassigned = taskRows.filter(");
  });

  it("guards the week grid against a stray schedule row", () => {
    expect(calendar).toContain(
      '(item.task?.work_order ?? item.work_order)?.status !== "cancelled"',
    );
  });

  it("keeps them out of the dashboard tiles and today's schedule", () => {
    expect(dashboard).toContain('.neq("work_order.status", "cancelled")');
    expect(dashboard).toContain('(row.task?.work_order ?? row.work_order)?.status !== "cancelled"');
  });
});
