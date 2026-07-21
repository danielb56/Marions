import { describe, expect, it } from "vitest";
import { assertWorkerSafe, deriveWorkOrderStatus, parseTaskLines } from "@/lib/domain";
import { calculateGst, toCents } from "@/lib/utils";

describe("Australian work-order money", () => {
  it("round-trips the supplied work order totals as integer cents", () => {
    const result = calculateGst(toCents("$2,000.00")!, 0.1);
    expect(result).toEqual({ subtotalCents: 200000, gstCents: 20000, totalCents: 220000 });
  });
  it("never creates floating point cent fragments", () => expect(toCents("19.99")).toBe(1999));
});

describe("task paste helper", () => {
  it("groups recognised lines and ignores the Material artefact", () => {
    const tasks = parseTaskLines("Painting Material\nMaterial\nPrepare walls 6/m2\nCarpentry\nReplace skirting 3/lm");
    expect(tasks).toMatchObject([{ trade: "Painting", description: "Prepare walls", quantity: 6, unit: "m2" }, { trade: "Carpentry", description: "Replace skirting", quantity: 3, unit: "lm" }]);
  });
});

describe("status roll-up", () => {
  it("prioritises blocked work", () => expect(deriveWorkOrderStatus(["completed", "blocked"])).toBe("blocked"));
  it("signs off when every active task is complete", () => expect(deriveWorkOrderStatus(["completed", "cancelled"])).toBe("signed_off"));
});

describe("worker response assertion", () => {
  it("accepts operational data", () => expect(assertWorkerSafe({ description: "Paint wall", quantity: 2, unit: "m2" })).toBeTruthy());
  it.each(["unit_rate", "line_total", "subtotal", "gst_cents", "total_cents", "work_order_totals"])("blocks %s", (key) => expect(() => assertWorkerSafe({ [key]: 10 })).toThrow("Unsafe worker response blocked"));
});
