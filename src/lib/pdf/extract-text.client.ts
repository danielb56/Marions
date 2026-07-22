import { getDocumentProxy } from "unpdf";
import { isScopeEndLine } from "@/lib/pdf/parse-work-order";

// Text extraction runs in the manager's browser. Keeping pdf.js out of the
// server bundle lets the application stay within Cloudflare's free Worker size
// limit while the normal manager-only create action remains the only save path.
//
// We read the document page by page and stop as soon as a scope-end marker is
// seen. Policy boilerplate after the work order is never parsed.

export type ExtractResult = {
  text: string;
  usedPages: number;
  pageCount: number;
  stopped: boolean;
};

type Cell = { x: number; text: string };
type Row = { y: number; cells: Cell[] };

// Rebuild visual lines from pdf.js text items: group items by their y position,
// order each line left-to-right by x, then order lines top-to-bottom. This keeps
// the quantity column on the same line as the start of its description.
async function renderPageLines(page: { getTextContent: () => Promise<{ items: unknown[] }> }): Promise<string[]> {
  const content = await page.getTextContent();
  const rows: Row[] = [];
  for (const raw of content.items) {
    const item = raw as { str?: unknown; transform?: unknown };
    if (typeof item.str !== "string" || !Array.isArray(item.transform)) continue;
    const transform = item.transform as number[];
    const y = Math.round(transform[5]);
    const cell: Cell = { x: transform[4], text: item.str };
    const row = rows.find((candidate) => Math.abs(candidate.y - y) <= 3);
    if (row) row.cells.push(cell);
    else rows.push({ y, cells: [cell] });
  }

  rows.sort((a, b) => b.y - a.y);
  const lines: string[] = [];
  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
    let line = "";
    for (const cell of row.cells) {
      if (line && !line.endsWith(" ") && !cell.text.startsWith(" ")) line += " ";
      line += cell.text;
    }
    const cleaned = line.replace(/\s+/g, " ").trim();
    if (cleaned) lines.push(cleaned);
  }
  return lines;
}

export async function extractWorkOrderText(bytes: Uint8Array, options: { maxPages?: number } = {}): Promise<ExtractResult> {
  const maxPages = options.maxPages ?? 10;
  const pdf = await getDocumentProxy(bytes);
  const pageCount: number = pdf.numPages;
  const limit = Math.min(pageCount, maxPages);

  const collected: string[] = [];
  let stopped = false;
  let usedPages = 0;

  for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const lines = await renderPageLines(page);
    usedPages = pageNumber;
    for (const line of lines) {
      if (isScopeEndLine(line)) {
        stopped = true;
        break;
      }
      collected.push(line);
    }
    if (stopped) break;
  }

  return { text: collected.join("\n"), usedPages, pageCount, stopped };
}
