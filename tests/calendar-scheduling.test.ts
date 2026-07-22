import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("multi-day scheduling UI", () => {
  it("uses the shared calendar for task and whole-order scheduling", () => {
    const form = source("src/components/assignment-form.tsx");
    expect(form.match(/<MultiDateCalendar/g)).toHaveLength(2);
    expect(form).not.toContain('placeholder="2026-');
  });

  it("marks today and exposes selected dates accessibly", () => {
    const calendar = source("src/components/multi-date-calendar.tsx");
    expect(calendar).toContain("date === today");
    expect(calendar).toContain('aria-pressed={selected}');
    expect(calendar).toContain('name={name}');
  });
});

describe("whole-order calendar scheduling", () => {
  const migration = source("supabase/migrations/0015_calendar_scheduling.sql");

  it("is manager-only, tenant-scoped and date-limited", () => {
    expect(migration).toContain("if not public.is_manager()");
    expect(migration).toContain("tenant_id = tenant_key");
    expect(migration).toContain("cardinality(p_dates) > 62");
  });

  it("creates whole-order schedule rows atomically with assignment", () => {
    expect(migration).toContain("assign_and_schedule_whole_order");
    expect(migration).toContain("tenant_id, work_order_id, worker_id, planned_date");
    expect(migration).toContain("schedule_order_worker_date_unique");
    expect(migration).toContain("perform public.recompute_work_order_status(p_work_order_id)");
  });

  it("routes whole-order dates to manager and worker calendars", () => {
    expect(source("src/app/manager/calendar/page.tsx")).toContain("work_order:work_order_id");
    expect(source("src/app/worker/page.tsx")).toContain("work_order_id,planned_date");
    expect(source("src/app/worker/upcoming/page.tsx")).toContain("schedule.work_order_id === task.work_order_id");
  });
});
