import { describe, expect, it } from "vitest";
import { isScopeEndLine, parseWorkOrder } from "@/lib/pdf/parse-work-order";

// Text as produced by extractWorkOrderText() from the REME PAINTING sample:
// pages 1-2 only, stopping at the anti-slavery / "for your reference" marker.
const SAMPLE = [
  "Bentino Pty Ltd",
  "admin@bentino.com.au",
  "ABN: 53 633 992 328",
  "LIC: 341506c | 202341 | 15230048",
  "Work Order - 20299-29572",
  "Work Order Assigned REME PAINTING GROUP PTY LTD Supervisor Astafanos Kheir",
  "Supervisor",
  "Work Order Number 20299-29572",
  "Contact",
  "Job Number: 20299",
  "Client Reference 12201037101",
  "Customer Name: FRANCESCO AMATO",
  "Customer Phone: 0409735370",
  "Site Address: 4 IRWAN ST, Saratoga, NSW 2251",
  "Site Contacts:",
  "Start Date",
  "Completion Date",
  "Additional",
  "Notes/Instructions:",
  "20299-29572",
  "Carpentry Material",
  "General Works",
  "Supply & Install Temporary Containment Screens 6/m2",
  "Lounge",
  "Remove & Replace Skirting - Pine (standard size) 3/lm",
  "Cleaning Material",
  "General Works",
  "Builders Clean - Labour Rate 3/ea",
  "Insulation Material",
  "Lounge",
  "Remove & Replace Ceiling Insulation - Glasswool R4.0 Batts 1/m2",
  "Miscellaneous Material",
  "Miscallenous",
  "General: 1/ea",
  "-The conclusions reached in this report have been based on opinions derived from our observation at the time of",
  "inspection and our experience in understanding the causes of the building damage.",
  "Painting Material",
  "Lounge",
  "Prepare & Paint Stain block / bleed seal ceiling/walls 4/m2",
  "Prepare & Paint Internal Ceilings 30/m2",
  "Prepare & Paint Internal Walls 15/m2",
  "Prepare & Paint Internal Skirting 7/lm",
  "Plastering Material",
  "Lounge",
  "-Allowance for patching & sanding of all surfaces to be painted, to smooth down any pre-existing imperfections to 1/ea",
  "create a uniform smooth finish",
  "Plastering - Minimum Labour Charge 1/ea",
  "Remove & Replace Plasterboard Cornices 6/lm",
  "Preliminaries Material",
  "General Works",
  "Floor protection during construction (ramboard or equiv) 30/m2",
  "Furniture Removal - Labour Rate 4/ea",
  "Waste Removal Material",
  "General Works",
  "Waste Disposal - General (per m3) 2/ea",
  "Totals Totals",
  "Subtotal $2,000.00",
  "GST $200.00",
  "Total $2,200.00",
].join("\n");

describe("work-order PDF parser - header", () => {
  const draft = parseWorkOrder(SAMPLE);
  it("takes the client from the letterhead, not the assigned subcontractor", () => {
    expect(draft.fields.clientName).toBe("Bentino Pty Ltd");
    expect(draft.fields.assignedTo).toBe("REME PAINTING GROUP PTY LTD");
  });
  it("reads the reference block", () => {
    expect(draft.fields.workOrderNumber).toBe("20299-29572");
    expect(draft.fields.jobNumber).toBe("20299");
    expect(draft.fields.clientReference).toBe("12201037101");
    expect(draft.fields.supervisorName).toBe("Astafanos Kheir");
  });
  it("reads the customer and splits the site address", () => {
    expect(draft.fields.customerName).toBe("FRANCESCO AMATO");
    expect(draft.fields.customerPhone).toBe("0409735370");
    expect(draft.fields).toMatchObject({ streetAddress: "4 IRWAN ST", suburb: "Saratoga", state: "NSW", postcode: "2251" });
  });
});

describe("work-order PDF parser - scope", () => {
  const draft = parseWorkOrder(SAMPLE);
  it("groups every line item under its trade and area", () => {
    expect(draft.tasks).toHaveLength(15);
    expect(draft.tasks[0]).toMatchObject({ trade: "Carpentry", area: "General Works", description: "Supply & Install Temporary Containment Screens", quantity: 6, unit: "m2" });
    expect(draft.tasks[1]).toMatchObject({ trade: "Carpentry", area: "Lounge", quantity: 3, unit: "lm" });
    expect(draft.tasks.at(-1)).toMatchObject({ trade: "Waste Removal", quantity: 2, unit: "ea" });
  });
  it("re-joins a wrapped multi-line description", () => {
    const allowance = draft.tasks.find((task) => task.description.startsWith("-Allowance"));
    expect(allowance?.description).toContain("create a uniform smooth finish");
    expect(allowance).toMatchObject({ trade: "Plastering", quantity: 1, unit: "ea" });
  });
  it("never lets an area header or the totals block leak into a description", () => {
    expect(draft.tasks[0].description).not.toContain("Lounge");
    expect(draft.tasks.some((task) => /Subtotal|GST|\$/.test(task.description))).toBe(false);
  });
  it("uses only the allowed units", () => {
    for (const task of draft.tasks) expect(["ea", "m2", "lm", "m3", "hr"]).toContain(task.unit);
  });
});

describe("work-order PDF parser - totals", () => {
  it("parses money as integer cents and derives the GST rate", () => {
    const draft = parseWorkOrder(SAMPLE);
    expect(draft.totals).toEqual({ subtotalCents: 200000, gstRate: 0.1, gstCents: 20000, totalCents: 220000 });
    expect(draft.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

describe("scope-end boundary", () => {
  it("stops at the totals/signature/policy markers", () => {
    expect(isScopeEndLine("Our Anti-Slavery Policy &The General Insurance Code of Practice (GICOP) follow this work order for your reference.")).toBe(true);
    expect(isScopeEndLine("I ____ (name) from REME PAINTING GROUP PTY LTD have read and understood the scope of")).toBe(true);
    expect(isScopeEndLine("Anti Slavery Policy")).toBe(true);
  });
  it("does not stop on ordinary scope lines", () => {
    expect(isScopeEndLine("Prepare & Paint Internal Walls 15/m2")).toBe(false);
    expect(isScopeEndLine("Total $2,200.00")).toBe(false);
  });
});
