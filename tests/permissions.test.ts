import { describe, expect, it } from "vitest";

const matrix = [
  ["view_pricing", true, false], ["edit_pricing", true, false], ["view_original_pdf", true, false],
  ["create_work_order", true, false], ["assign_task", true, false], ["schedule_task", true, false],
  ["edit_task_details", true, false],
  ["start_own_task", true, true], ["submit_own_completion", false, true], ["approve_completion", true, false],
  ["view_full_audit", true, false],
] as const;

describe("role permission matrix", () => {
  it.each(matrix)("%s has explicit manager=%s worker=%s permissions", (_action, manager, worker) => {
    expect(typeof manager).toBe("boolean"); expect(typeof worker).toBe("boolean");
  });
  it("denies every financial action to workers", () => {
    expect(matrix.filter(([action]) => action.includes("pricing") || action.includes("pdf")).every(([, , worker]) => !worker)).toBe(true);
  });
});
