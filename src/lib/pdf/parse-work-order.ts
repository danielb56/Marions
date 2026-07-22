import { TRADE_CATEGORIES, UNITS } from "@/lib/domain";

// V1 deterministic parser for Bentino-style work orders. No LLM: it relies on
// the fixed header labels, the trade/area layout and the quantity/unit column.
// Long descriptions that wrap onto extra lines are re-joined; boilerplate that
// follows the totals or signature block is never reached (see extract-text.ts).

export type ParsedTask = {
  trade: string;
  area: string;
  description: string;
  quantity: number;
  unit: string;
};

export type WorkOrderDraftFields = {
  clientName: string;
  assignedTo: string;
  supervisorName: string;
  workOrderNumber: string;
  jobNumber: string;
  clientReference: string;
  customerName: string;
  customerPhone: string;
  streetAddress: string;
  suburb: string;
  state: string;
  postcode: string;
};

export type WorkOrderDraft = {
  fields: WorkOrderDraftFields;
  tasks: ParsedTask[];
  totals: { subtotalCents: number; gstRate: number; gstCents: number; totalCents: number };
  confidence: number;
  parserVersion: string;
};

export const PARSER_VERSION = "wo-parser-1.0.0";

// Lines at or beyond any of these end the work order proper. Extraction stops
// here so the anti-slavery policy and insurance code of practice are ignored.
export const SCOPE_END_MARKERS: RegExp[] = [
  /have read and understood the scope of/i, // signature acceptance ("...scope of works" wraps across lines)
  /follow this work order for your reference/i,
  /anti[-\s]?slavery policy/i,
  /general insurance code of practice/i,
];

export function isScopeEndLine(line: string): boolean {
  return SCOPE_END_MARKERS.some((re) => re.test(line));
}

const UNIT_GROUP = UNITS.join("|");
const ITEM_RE = new RegExp(`^(.*\\S)\\s+(\\d+(?:\\.\\d+)?)\\s*/\\s*(${UNIT_GROUP})\\s*$`, "i");

const NOISE: RegExp[] = [
  /^Bentino Pty Ltd$/i,
  /@/,
  /^ABN:/i,
  /^LIC:/i,
  /Registered (Head|QLD) Office/i,
  /^Work Order - /i,
  /^Material$/i,
  /uncontrolled when printed/i,
];

function toCents(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const amount = Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round((amount + Number.EPSILON) * 100);
}

function tradeHeader(line: string): string | null {
  const trimmed = line.replace(/\s+Material$/i, "").trim();
  return TRADE_CATEGORIES.find((trade) => trade.toLowerCase() === trimmed.toLowerCase()) ?? null;
}

// An area sub-header ("General Works", "Lounge", "Kitchen", ...) is a short
// standalone label with no quantity. Wrapped description lines are excluded by
// their length, a leading hyphen, or a trailing connective word.
function areaHeader(line: string): string | null {
  const trimmed = line.replace(/\s+Material$/i, "").trim();
  if (/^General Works$/i.test(trimmed)) return "General Works";
  if (trimmed.startsWith("-")) return null;
  if (ITEM_RE.test(line)) return null;
  const words = trimmed.split(/\s+/);
  if (words.length <= 4 && trimmed.length <= 32 && !/[.,]$/.test(trimmed) && !/\b(and|to|the|of|for|with|any|a)$/i.test(trimmed)) {
    return trimmed.replace(/:$/, "");
  }
  return null;
}

function grab(lines: string[], label: string): string {
  const re = new RegExp(`^${label}\\s*:?\\s*(.*)$`, "i");
  for (const line of lines) {
    const match = line.match(re);
    if (match) return match[1].trim();
  }
  return "";
}

export function parseWorkOrder(text: string): WorkOrderDraft {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Client (principal) is the letterhead company, not the assigned subcontractor.
  const clientName = (
    lines.find((line) => /\bPty\.?\s*Ltd\b|\bGroup\b|\bConstructions?\b|\bBuilders\b/i.test(line) && !/assigned/i.test(line)) ?? ""
  ).trim();

  // Header ends at the first trade section or the standalone work-order number.
  let scopeStart = lines.findIndex((line, index) => index > 2 && (tradeHeader(line) !== null || /^\d{3,}-\d{2,}$/.test(line)));
  if (scopeStart < 0) scopeStart = lines.length;
  const header = lines.slice(0, scopeStart);

  const assignedRaw = grab(header, "Work Order Assigned");
  const [assignedTo, supervisorFromLine] = assignedRaw.split(/\s+Supervisor\s+/i);
  let supervisorName = (supervisorFromLine ?? "").trim();
  if (!supervisorName) {
    for (const line of header) {
      const match = line.match(/Supervisor\s+(?!Contact\b)(.+)$/i);
      if (match) {
        supervisorName = match[1].trim();
        break;
      }
    }
  }

  const workOrderNumber = grab(header, "Work Order Number").replace(/\s+Supervisor.*$/i, "").trim();

  const address = grab(header, "Site Address");
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  let streetAddress = "";
  let suburb = "";
  let state = "";
  let postcode = "";
  if (parts.length) {
    streetAddress = parts[0];
    const last = parts[parts.length - 1];
    const match = last.match(/([A-Za-z]{2,3})\s+(\d{4})$/);
    if (match) {
      state = match[1].toUpperCase();
      postcode = match[2];
    }
    if (parts.length >= 3) suburb = parts[1];
    else if (parts.length === 2) suburb = parts[1].replace(/\s*[A-Za-z]{2,3}\s+\d{4}$/, "").trim();
  }

  // Scope: walk lines and build trade-grouped tasks.
  const scope = lines.slice(scopeStart);
  let trade = "Miscellaneous";
  let area = "";
  let current: ParsedTask | null = null;
  const tasks: ParsedTask[] = [];
  const flush = () => {
    if (current && current.description.trim().length >= 2) tasks.push(current);
    current = null;
  };

  for (const line of scope) {
    if (/^Totals\b/i.test(line)) break; // end of scope; totals handled below
    if (/^(Subtotal|GST|Total)\b.*[\d.,]+/i.test(line)) continue;
    if (NOISE.some((re) => re.test(line))) continue;
    if (/^\d{3,}-\d{2,}$/.test(line)) continue; // repeated work-order number

    const trHeader = tradeHeader(line);
    if (trHeader) {
      flush();
      trade = trHeader;
      area = "";
      continue;
    }

    const item = line.match(ITEM_RE);
    if (item) {
      flush();
      current = { trade, area, description: item[1].trim(), quantity: Number(item[2]), unit: item[3].toLowerCase() };
      continue;
    }

    const ar = areaHeader(line);
    if (ar) {
      flush(); // an area header closes any open task
      area = ar;
      continue;
    }

    if (current) current.description = `${current.description} ${line}`.trim(); // wrapped description
  }
  flush();

  // Totals (parsed from the full captured text, up to the Totals block).
  const all = lines.join("\n");
  const subtotalCents = toCents((all.match(/Subtotal\s*\$?\s*([\d,]+\.\d{2})/i) ?? [])[1]) ?? 0;
  const gstCents = toCents((all.match(/\bGST\s*\$?\s*([\d,]+\.\d{2})/i) ?? [])[1]) ?? 0;
  const totalCents = toCents((all.match(/\bTotal\s*\$?\s*([\d,]+\.\d{2})/i) ?? [])[1]) ?? subtotalCents + gstCents;
  const gstRate = subtotalCents > 0 ? Math.round((gstCents / subtotalCents) * 100) / 100 : 0.1;

  const requiredFound = [clientName, workOrderNumber, streetAddress, postcode].filter(Boolean).length;
  const confidence = Math.min(1, (requiredFound / 4) * 0.5 + (tasks.length ? 0.3 : 0) + (subtotalCents ? 0.2 : 0));

  return {
    fields: {
      clientName,
      assignedTo: (assignedTo ?? "").trim(),
      supervisorName,
      workOrderNumber,
      jobNumber: grab(header, "Job Number"),
      clientReference: grab(header, "Client Reference"),
      customerName: grab(header, "Customer Name"),
      customerPhone: grab(header, "Customer Phone"),
      streetAddress,
      suburb,
      state: state || "NSW",
      postcode,
    },
    tasks,
    totals: { subtotalCents, gstRate, gstCents, totalCents },
    confidence: Math.round(confidence * 100) / 100,
    parserVersion: PARSER_VERSION,
  };
}
