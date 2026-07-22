"use server";

import { assertRole } from "@/lib/auth";
import { extractWorkOrderText } from "@/lib/pdf/extract-text";
import { parseWorkOrder, type WorkOrderDraft } from "@/lib/pdf/parse-work-order";
import { logger } from "@/lib/redact";

const MAX_BYTES = 25 * 1024 * 1024;

export type PdfImportState = {
  error?: string;
  draft?: WorkOrderDraft;
  meta?: { usedPages: number; pageCount: number; stopped: boolean };
};

// Manager-only. Reads an uploaded PDF in memory, extracts the work-order text
// (stopping at the totals/signature block) and returns a reviewable draft.
// Nothing is written to the database here - the manager confirms via the normal
// create flow, which keeps the human-in-the-loop check on financial data.
export async function extractWorkOrderPdf(_: PdfImportState, formData: FormData): Promise<PdfImportState> {
  await assertRole("manager");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF work order to import." };
  if (file.type && file.type !== "application/pdf") return { error: "That file is not a PDF." };
  if (file.size > MAX_BYTES) return { error: "That PDF is larger than 25 MB." };

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractWorkOrderText(bytes);
    const draft = parseWorkOrder(extracted.text);
    if (!draft.tasks.length && !draft.fields.workOrderNumber) {
      return { error: "No work-order details were recognised. The PDF may be a scan - enter the details manually or paste the text." };
    }
    return { draft, meta: { usedPages: extracted.usedPages, pageCount: extracted.pageCount, stopped: extracted.stopped } };
  } catch (error) {
    logger.error("pdf_import.extract_failed", error);
    return { error: "The PDF could not be read. Enter the details manually or paste the text instead." };
  }
}
