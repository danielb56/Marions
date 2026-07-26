import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const page = read("src/app/manager/calendar/page.tsx");
const flatPage = page.replace(/\s+/g, " ");
const queueActions = read("src/components/calendar-queue-actions.tsx");
const actions = read("src/actions/work-orders.ts").replace(/\s+/g, " ");
const sql = read("supabase/migrations/0022_unschedule_all_business_today.sql").replace(/\s+/g, " ");

describe("Scheduled queue", () => {
  it("renders a Scheduled section with its own count", () => {
    expect(flatPage).toContain('<h2 className="font-semibold">Scheduled</h2>');
    expect(flatPage).toContain('<Badge tone={scheduled.length ? "teal" : "green"}>');
  });

  it("lists every task with an upcoming date, not just the visible week", () => {
    expect(flatPage).toContain("planningStatuses.has(task.status) && hasUpcomingSchedule(task)");
    // hasUpcomingSchedule is built from the unbounded `>= today` query, whereas
    // the grid above is bounded to the displayed week.
    expect(flatPage).toContain('.gte("planned_date", today)');
  });

  it("orders the list by the next scheduled date", () => {
    expect(flatPage).toContain(
      '.sort((a, b) => (nextDateFor(a) ?? "").localeCompare(nextDateFor(b) ?? ""))',
    );
  });

  it("resolves a task's next date from its own entry or its whole-order entry", () => {
    expect(flatPage).toContain("nextDateByTask.get(task.id) ??");
    expect(flatPage).toContain("nextDateByOrder.get(task.work_order.id)");
  });

  it("names workers from the unfiltered rows so deactivated ones still resolve", () => {
    expect(flatPage).toContain("((workerData ?? []) as unknown as WorkerRow[]).map");
  });

  it("shows the control only when there is something to clear", () => {
    expect(flatPage).toContain("{scheduled.length > 0 && <UnscheduleAllControl />}");
  });

  it("keeps the other two queues", () => {
    expect(flatPage).toContain("Assigned but unscheduled");
    expect(flatPage).toContain("Unassigned jobs");
  });
});

describe("Unschedule all", () => {
  it("is wired to the existing bulk RPC", () => {
    expect(queueActions).toContain("export function UnscheduleAllControl()");
    expect(queueActions).toContain("useActionState(unscheduleAllUpcoming");
  });

  it("warns that assignments survive and the jobs move queues", () => {
    expect(queueActions.replace(/\s+/g, " ")).toContain(
      "The jobs stay assigned to their workers and move into Assigned but unscheduled",
    );
  });

  // Bulk and destructive across every worker, so it keeps the confirmation and
  // the mandatory reason that the single-date removal dropped.
  it("still requires a reason behind a confirmation", () => {
    const body = queueActions.slice(queueActions.indexOf("export function UnscheduleAllControl"));
    expect(body).toContain("<details");
    expect(body).toContain('name="reason"');
    expect(body).toContain("Confirm unschedule all");
  });

  it("tells the manager where the jobs went", () => {
    expect(actions).toContain("The jobs are now in Assigned but unscheduled.");
  });

  it("is no longer described as legacy compatibility", () => {
    expect(actions).not.toContain("Retained for compatibility with older clients");
    expect(actions).toContain("Backs the Unschedule all button");
  });
});

describe("unschedule_all_upcoming boundary", () => {
  it("uses business_today so it clears what the list above it shows", () => {
    expect(sql).toContain("boundary date := public.business_today()");
    expect(sql).toContain("se.planned_date >= boundary");
    expect(sql).not.toContain("planned_date >= current_date");
  });

  it("returns scheduled tasks to assigned rather than unassigning them", () => {
    expect(sql).toContain("then 'assigned'::public.task_status");
    expect(sql).not.toContain("update public.assignment");
  });

  it("still notifies each affected worker once and audits the change", () => {
    expect(sql).toContain("'Upcoming schedule cleared'");
    expect(sql).toContain("'schedule_entry.bulk_unscheduled'");
  });
});
