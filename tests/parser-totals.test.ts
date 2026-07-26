import { describe, expect, it } from "vitest";
import { assertWorkerSafe } from "@/lib/domain";
import { parseWorkOrder } from "@/lib/pdf/parse-work-order";

const order = (...body: string[]) =>
  parseWorkOrder(
    [
      "Bentino Pty Ltd",
      "Work Order - Scope",
      "Work Order Number: 123456-01",
      "Site Address: 12 Example Street, Saratoga, NSW 2251",
      "Painting",
      ...body,
    ].join("\n"),
  );

describe("work order total extraction", () => {
  it("reads the total from the totals block", () => {
    const parsed = order("Prepare walls 6/m2", "Totals", "Subtotal $2,000.00", "Total $2,200.00");
    expect(parsed.totals.totalCents).toBe(220000);
  });

  // The previous version took the first match anywhere in the document, so a
  // figure inside a task description won over the real total.
  it("ignores a dollar figure quoted in a task description", () => {
    const parsed = order(
      "Make good after Total $99.00 variation 6/m2",
      "Totals",
      "Total $2,200.00",
    );
    expect(parsed.totals.totalCents).toBe(220000);
  });

  it("prefers the last total when a document repeats one per page", () => {
    const parsed = order("Prepare walls 6/m2", "Total $1,000.00", "Total $2,200.00");
    expect(parsed.totals.totalCents).toBe(220000);
  });

  it("does not mistake Subtotal for Total", () => {
    const parsed = order("Prepare walls 6/m2", "Totals", "Subtotal $2,000.00");
    expect(parsed.totals.totalCents).toBe(200000);
  });

  it("falls back to subtotal plus GST when no total is printed", () => {
    const parsed = order("Prepare walls 6/m2", "Totals", "Subtotal $2,000.00", "GST $200.00");
    expect(parsed.totals.totalCents).toBe(220000);
  });

  it("reports zero when the document carries no money at all", () => {
    expect(order("Prepare walls 6/m2").totals.totalCents).toBe(0);
  });
});

describe("worker response assertion", () => {
  it("still blocks a real pricing key, and names it", () => {
    expect(() => assertWorkerSafe({ total_cents: 220000 })).toThrow(
      "Unsafe worker response blocked: total_cents",
    );
  });

  it("finds a pricing key nested inside arrays and objects", () => {
    expect(() => assertWorkerSafe({ tasks: [{ pricing: { unit_rate: 12 } }] })).toThrow(
      "unit_rate",
    );
  });

  // The old regex tested serialised JSON, so this description crashed the page.
  it("allows a description that merely mentions a forbidden key", () => {
    const payload = { description: 'Client asked about "subtotal": see quote', quantity: 2 };
    expect(assertWorkerSafe(payload)).toBe(payload);
  });

  it("passes ordinary operational data through unchanged", () => {
    const payload = { description: "Paint wall", quantity: 2, unit: "m2" };
    expect(assertWorkerSafe(payload)).toEqual(payload);
  });

  it("tolerates null and primitive values", () => {
    expect(assertWorkerSafe(null)).toBeNull();
    expect(assertWorkerSafe(42)).toBe(42);
  });
});
