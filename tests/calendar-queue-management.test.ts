import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const migration = source("supabase/migrations/0016_calendar_queue_and_auto_schedule.sql");

describe("whole-order automatic task scheduling", () => {
  it("keeps task order and balances work across the selected dates", () => {
    expect(migration).toContain("order by t.sort_order, t.id");
    expect(migration).toContain("base_tasks_per_day := task_count / date_count");
    expect(migration).toContain("extra_days := task_count % date_count");
    expect(migration).toContain("day_capacity := base_tasks_per_day");
    expect(migration).toContain("if extra_days > 0 then");
    expect(migration).toContain("if date_index <= extra_days then");
    expect(migration).not.toMatch(/if [^\n]*\+ case/);
  });

  it("creates consecutive one-hour task bookings from 8:00am", () => {
    expect(migration).toContain("tenant_id, task_id, worker_id, planned_date, start_time");
    expect(migration).toContain("time '08:00' + slot_in_day * interval '1 hour'");
    expect(migration).toContain("1, date_index, auth.uid()");
    expect(migration).toContain("A day can hold at most 16 one-hour tasks");
  });

  it("remains manager-only and tenant-scoped", () => {
    const functionStart = migration.indexOf("create or replace function public.assign_and_schedule_whole_order");
    const firstInsert = migration.indexOf("insert into public.schedule_entry", functionStart);
    expect(migration.indexOf("if not public.is_manager()", functionStart)).toBeLessThan(firstInsert);
    expect(migration.slice(functionStart, firstInsert)).toContain("tenant_id = tenant_key");
  });
});

describe("calendar assignment queues", () => {
  it("shows assigned and unassigned sections with per-task unassignment", () => {
    const page = source("src/app/manager/calendar/page.tsx");
    expect(page).toContain("Assigned but unscheduled");
    expect(page).toContain("Unassigned jobs");
    expect(page).toContain("<UnassignTaskForm taskId={task.id} />");
    expect(page).toContain("<UnscheduleAllControl />");
    expect(page).toContain('assignment.status !== "reassigned"');
  });

  it("unassigns only planning-stage tasks and retains the manager reason in audit", () => {
    const start = migration.indexOf("create or replace function public.unassign_task");
    const end = migration.indexOf("create or replace function public.unschedule_all_upcoming");
    const unassign = migration.slice(start, end);
    expect(unassign).toContain("if not public.is_manager()");
    expect(unassign).toContain("t.id = p_task_id and t.tenant_id = tenant_key");
    expect(unassign).toContain("status = 'reassigned'");
    expect(unassign).toContain("set status = 'ready'");
    expect(unassign).toContain("'reason', trim(p_reason)");
    const notifications = unassign.slice(unassign.indexOf("for recipient in"), unassign.indexOf("update public.assignment"));
    expect(notifications).not.toContain("p_reason");
  });

  it("bulk-unschedules today and future work while preserving assignments", () => {
    const start = migration.indexOf("create or replace function public.unschedule_all_upcoming");
    const bulk = migration.slice(start);
    expect(bulk).toContain("se.planned_date >= current_date");
    expect(bulk).toContain("delete from public.schedule_entry");
    expect(bulk).toContain("then 'assigned'::public.task_status");
    expect(bulk).not.toContain("update public.assignment");
    expect(bulk).toContain("schedule_entry.bulk_unscheduled");
  });

  it("exposes both manager actions through guarded server actions", () => {
    const actions = source("src/actions/work-orders.ts");
    expect(actions).toContain("export async function unassignTask");
    expect(actions).toContain('supabase.rpc("unassign_task"');
    expect(actions).toContain("export async function unscheduleAllUpcoming");
    expect(actions).toContain('supabase.rpc("unschedule_all_upcoming"');
  });
});
