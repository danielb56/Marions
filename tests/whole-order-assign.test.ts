import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const migration = read("supabase/migrations/0020_whole_order_assign_and_cancel_cascade.sql");
const sql = migration.replace(/\s+/g, " ");
const actions = read("src/actions/work-orders.ts").replace(/\s+/g, " ");

// The live whole-order path is assign_and_schedule_whole_order. assign_whole_order
// was unreachable from 0015 onward, which is why an earlier pass optimised the
// wrong function.
describe("whole-order assign is set-based", () => {
  it("resolves the target tasks once, in sort order", () => {
    expect(sql).toContain("array_agg(t.id order by t.sort_order, t.id)");
    expect(sql).toContain("into target_ids");
  });

  it("inserts every assignment in one statement", () => {
    expect(sql).toContain("from unnest(target_ids) as t(id)");
  });

  it("inserts every schedule entry in one statement", () => {
    expect(sql).toContain("from unnest(target_ids) with ordinality as ordered(task_id, seq)");
  });

  it("updates every task status in one statement", () => {
    expect(sql).toContain(
      "update public.task set status = 'scheduled', revised_since_viewed = true where id = any(target_ids)",
    );
  });

  it("no longer loops task by task", () => {
    expect(sql).not.toContain("for task_row in");
  });

  it("removes the unreachable predecessor", () => {
    expect(sql).toContain(
      "drop function if exists public.assign_whole_order(bigint, bigint, boolean)",
    );
  });

  it("keeps the sixteen-tasks-per-day ceiling and the date bounds", () => {
    expect(sql).toContain("A day can hold at most 16 one-hour tasks");
    expect(sql).toContain("Choose between 1 and 62 schedule dates");
  });

  it("guards the slot divisor so an all-thin-days split cannot divide by zero", () => {
    expect(sql).toContain("greatest(base_per_day, 1)");
  });
});

describe("assignment notifications are batched", () => {
  it("groups per worker per work order", () => {
    expect(sql).toContain("group by w.user_id, wo.id, wo.work_order_number");
  });

  it("fires once per statement rather than once per row", () => {
    expect(sql).toContain("referencing new table as inserted_assignment");
    expect(sql).toContain("for each statement");
    expect(sql).not.toMatch(
      /assignment_queue_notification after insert on public\.assignment for each row/,
    );
  });

  it("links a multi-task assignment to the job, not one arbitrary task", () => {
    expect(sql).toContain("'/worker/jobs/' || notice.work_order_id");
    expect(sql).toContain("'/worker/tasks/' || notice.first_task_id");
  });

  it("drops the superseded per-row function", () => {
    expect(sql).toContain("drop function if exists public.notify_new_assignment()");
  });

  it("still respects the per-worker and per-tenant SMS opt-in", () => {
    expect(sql).toContain("(w.sms_opt_in and tn.sms_enabled)");
  });
});

describe("cancelling a work order withdraws the work", () => {
  it("cancels the order's active tasks", () => {
    expect(sql).toContain("update public.task set status = 'cancelled'");
  });

  it("clears schedule entries for the cancelled order", () => {
    expect(sql).toContain("delete from public.schedule_entry");
  });

  it("notifies each affected worker once and records who was told", () => {
    expect(sql).toContain("'Work order cancelled'");
    expect(sql).toContain("affected_worker_ids, notification_count > 0");
  });

  it("writes an audit event", () => {
    expect(sql).toContain("'work_order.cancelled'");
  });

  it("cancels the order after its tasks so the roll-up cannot override it", () => {
    expect(sql.indexOf("update public.task set status = 'cancelled'")).toBeLessThan(
      sql.indexOf("set status = 'cancelled', cancelled_at = now()"),
    );
  });

  it("is called from the action instead of a direct table update", () => {
    expect(actions).toContain('supabase.rpc("cancel_work_order"');
    expect(actions).not.toContain('.from("work_order") .update({ status: "cancelled"');
  });
});

describe("cancelled work stops reaching workers", () => {
  it("excludes cancelled orders from both worker views", () => {
    expect(sql).toContain(
      "join public.work_order wo on wo.id = t.work_order_id and wo.status <> 'cancelled'",
    );
    expect(sql).toContain(
      "where wo.status <> 'cancelled' and public.worker_can_access_work_order(wo.id)",
    );
  });

  it("checks task status before accepting a completion submission", () => {
    expect(sql).toContain("This task cannot be submitted from its current status");
    expect(sql).toContain("status in ('in_progress', 'changes_requested', 'blocked')");
  });
});
