import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const sql = read("supabase/migrations/0021_unassign_clears_schedule.sql").replace(/\s+/g, " ");
const actions = read("src/actions/work-orders.ts").replace(/\s+/g, " ");
const assignmentForm = read("src/components/assignment-form.tsx");
const queueActions = read("src/components/calendar-queue-actions.tsx").replace(/\s+/g, " ");
const calendarPage = read("src/app/manager/calendar/page.tsx");

describe("one definition of today", () => {
  // The page decided "upcoming" in Australia/Sydney while the RPCs compared
  // against current_date, which follows the database timezone. For about ten
  // hours a day they disagreed, so the queue listed jobs the RPC then skipped.
  it("adds a business_today helper in the operating timezone", () => {
    expect(sql).toContain("create or replace function public.business_today()");
    expect(sql).toContain("(now() at time zone 'Australia/Sydney')::date");
  });

  it("uses it for the bulk-unassign schedule check", () => {
    expect(sql).toContain("se.planned_date >= public.business_today()");
  });

  it("leaves no current_date comparison behind in the touched functions", () => {
    expect(sql).not.toContain("planned_date >= current_date");
  });

  it("matches the timezone the calendar page already renders in", () => {
    expect(calendarPage).toContain('timeZone: "Australia/Sydney"');
  });

  it("keeps the helper off the public API surface", () => {
    expect(sql).toContain("revoke all on function public.business_today() from public");
  });
});

describe("unassigning clears the schedule", () => {
  it("deletes every entry for a single unassigned task, not only upcoming ones", () => {
    expect(sql).toContain(
      "delete from public.schedule_entry where task_id = p_task_id and tenant_id = tenant_key;",
    );
  });

  it("deletes every entry for the bulk-unassigned tasks", () => {
    expect(sql).toContain(
      "delete from public.schedule_entry where tenant_id = tenant_key and task_id = any(candidate_task_ids)",
    );
  });

  it("counts what it removed", () => {
    expect(sql.match(/get diagnostics removed_entries = row_count/g)?.length).toBe(2);
  });

  it("records the removed dates in the audit event", () => {
    expect(sql.match(/'removedScheduleEntries', removed_entries/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("returns the count so the action can report it", () => {
    expect(actions).toContain("removedScheduleEntries?: number");
    expect(actions).toContain("scheduled date${clearedDates === 1");
    expect(actions).toContain("leftover scheduled date${clearedDates === 1");
  });

  it("says so in the confirmation copy", () => {
    expect(queueActions).toContain("clears any dates still on their calendar");
  });
});

describe("removing one scheduled date takes one press", () => {
  it("no longer demands a reason in the RPC", () => {
    expect(sql).toContain("reason_text is not null and length(reason_text) > 500");
    expect(sql).not.toMatch(
      /unschedule_entry[\s\S]{0,400}?Enter a reason between 2 and 500 characters/,
    );
  });

  it("stores a reason when one is supplied, and null when not", () => {
    expect(sql).toContain("reason_text text := nullif(trim(coalesce(p_reason, '')), '')");
    expect(sql).toContain("jsonb_build_object('reason', reason_text)");
  });

  it("drops the minimum-length check in the action", () => {
    const body = actions.slice(actions.indexOf("export async function unscheduleEntry"));
    const next = body.slice(0, body.indexOf("export async function unassignTask"));
    expect(next).not.toContain("reason.length < 2");
    expect(next).toContain("p_reason: reason || null");
  });

  it("renders a single submit button with no reason field", () => {
    const body = assignmentForm.slice(
      assignmentForm.indexOf("export function UnscheduleEntryForm"),
    );
    expect(body).not.toContain("<details");
    expect(body).not.toContain('name="reason"');
    expect(body).toContain('name="scheduleEntryId"');
    expect(body).toContain('pendingText="Removing..."');
  });

  // Bulk actions stay gated: they are destructive across many jobs at once.
  it("still requires a reason for both unassign paths", () => {
    expect(sql.match(/Enter a reason between 2 and 500 characters/g)?.length).toBe(2);
  });
});
