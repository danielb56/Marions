import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/app/manager/work-orders/[id]/page.tsx"),
  "utf8",
);

describe("work order detail queries", () => {
  it("loads polymorphic attachments separately from the work order relation", () => {
    const workOrderQuery = source.slice(
      source.indexOf('supabase.from("work_order")'),
      source.indexOf('supabase.from("worker")'),
    );

    expect(workOrderQuery).not.toContain("attachment(");
    expect(source).toContain('supabase.from("attachment")');
    expect(source).toContain('.eq("owner_type", "work_order")');
    expect(source).toContain('.eq("owner_id", workOrderId)');
  });
});
