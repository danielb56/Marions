import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AU_STATES, workOrderInputSchema } from "@/lib/domain";
import { parseWorkOrder } from "@/lib/pdf/parse-work-order";

const validOrder = {
  clientName: "Bentino Pty Ltd",
  streetAddress: "12 Example Street",
  suburb: "Saratoga",
  postcode: "2251",
  workOrderNumber: "123456-01",
  totalCents: 220000,
  tasks: [{ trade: "Painting", description: "Prepare walls", quantity: 6, unit: "m2" }],
};

describe("Australian state validation", () => {
  // SA, WA and NT are two characters. A fixed length(3) rule silently made three
  // of the eight options in the form unsaveable.
  it.each([...AU_STATES])("accepts %s, which the form offers", (state) => {
    const result = workOrderInputSchema.safeParse({ ...validOrder, state });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.state).toBe(state);
  });

  it("offers exactly the states the form renders", () => {
    const form = readFileSync(join(process.cwd(), "src/components/work-order-form.tsx"), "utf8");
    // The form must map over the shared constant rather than repeat the list.
    expect(form).toContain("AU_STATES.map(");
    expect(form).not.toMatch(/\[\s*"NSW"\s*,/);
  });

  it("normalises case and surrounding space", () => {
    const result = workOrderInputSchema.safeParse({ ...validOrder, state: " wa " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.state).toBe("WA");
  });

  it("falls back to NSW when no state is supplied", () => {
    const result = workOrderInputSchema.safeParse({ ...validOrder, state: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.state).toBe("NSW");
  });

  it("rejects a value that is not a state", () => {
    expect(workOrderInputSchema.safeParse({ ...validOrder, state: "ZZZ" }).success).toBe(false);
  });
});

describe("state extraction from a PDF address", () => {
  const order = (address: string) =>
    parseWorkOrder(
      [
        "Bentino Pty Ltd",
        "Work Order - Scope",
        "Work Order Number: 123456-01",
        `Site Address: ${address}`,
        "Painting",
        "Prepare walls 6/m2",
        "Total $2,200.00",
      ].join("\n"),
    );

  it("reads a two-letter state", () => {
    expect(order("12 Example Street, Fremantle, WA 6160").fields.state).toBe("WA");
  });

  it("reads a three-letter state", () => {
    expect(order("12 Example Street, Saratoga, NSW 2251").fields.state).toBe("NSW");
  });

  // A short word before the postcode is not a state. Leaving it blank lets the
  // form default apply instead of failing validation when the manager saves.
  it("ignores a non-state word before the postcode", () => {
    const parsed = order("12 Example Street, Some Place, Rd 2251");
    expect(parsed.fields.state).toBe("NSW");
    expect(parsed.fields.postcode).toBe("2251");
  });
});
