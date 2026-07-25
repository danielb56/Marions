import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const route = read("src/app/api/cron/notifications/route.ts").replace(/\s+/g, " ");
const migration = read("supabase/migrations/0019_dispatch_claim_and_statement_rollup.sql");
const sql = migration.replace(/\s+/g, " ");

describe("notification dispatch claims before sending", () => {
  // Selecting then sending let two overlapping five-minute runs deliver the same
  // message twice. The claim has to happen in the database, not the route.
  it("claims through the RPC rather than selecting the queue directly", () => {
    expect(route).toContain('admin.rpc("claim_notifications"');
    expect(route).not.toContain('.from("notification") .select(');
  });

  it("locks rows and skips ones another dispatcher already holds", () => {
    expect(sql).toContain("for update skip locked");
  });

  it("stamps a claim so a second caller cannot see the same row", () => {
    expect(sql).toContain("set claimed_at = now()");
  });

  it("lets a crashed dispatcher's rows become claimable again", () => {
    expect(sql).toContain("make_interval(secs => p_lease_seconds)");
  });

  it("keeps the five-attempt ceiling", () => {
    expect(sql).toContain("n.attempts < 5");
  });

  it("keeps dispatch off the public API surface", () => {
    expect(sql).toContain(
      "revoke all on function public.claim_notifications(integer, integer) from public",
    );
    expect(sql).toContain(
      "grant execute on function public.claim_notifications(integer, integer) to service_role",
    );
  });

  it("reports a truncated batch instead of hiding the backlog", () => {
    expect(route).toContain("truncated");
    expect(route).toContain("notification.batch_truncated");
  });

  it("no longer exposes the dispatcher over GET", () => {
    expect(route).not.toContain("export const GET");
  });
});

describe("status roll-up runs once per statement", () => {
  it("uses transition tables at statement level", () => {
    expect(sql).toContain("referencing old table as previous_task new table as changed_task");
    expect(sql).toContain("for each statement");
  });

  it("still only recomputes when a status actually changed", () => {
    expect(sql).toContain("changed.status is distinct from previous.status");
  });

  it("drops the superseded row-level helper", () => {
    expect(sql).toContain("drop function if exists public.recompute_parent_after_task()");
  });
});

describe("whole-order assignment is set-based", () => {
  it("resolves the target tasks into one array instead of looping", () => {
    expect(sql).toContain("into target_ids");
    expect(sql).toContain("from unnest(target_ids) as t(id)");
  });

  it("preserves the count returned to callers", () => {
    expect(sql).toContain("return array_length(target_ids, 1)");
  });

  it("schedules every date in one insert", () => {
    expect(sql).toContain("from unnest(p_dates) with ordinality as d(planned_date, seq)");
  });

  it("avoids position as a column alias, which is reserved", () => {
    expect(sql).not.toMatch(/as d\(planned_date, position\)/);
  });
});
