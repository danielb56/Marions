import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// This suite asserts on the shape of the detail page's queries by reading its
// source. Prettier breaks longer builder chains across lines and leaves shorter
// ones inline, so normalise whitespace (including around the dots) first. The
// assertions then describe the code's intent rather than the formatter's choices.
const source = readFileSync(
  join(process.cwd(), "src/app/manager/work-orders/[id]/page.tsx"),
  "utf8",
)
  .replace(/\s+/g, " ")
  .replace(/\s*\.\s*/g, ".");

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
