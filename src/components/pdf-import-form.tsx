"use client";

import { useState, type FormEvent } from "react";
import { FileUp, ScanText } from "lucide-react";
import type { WorkOrderDraft } from "@/lib/pdf/parse-work-order";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/field";
import { WorkOrderForm } from "@/components/work-order-form";

const MAX_BYTES = 25 * 1024 * 1024;

type PdfImportState = {
  error?: string;
  draft?: WorkOrderDraft;
  meta?: { usedPages: number; pageCount: number; stopped: boolean };
};

export function PdfImportForm() {
  const [state, setState] = useState<PdfImportState>({});
  const [pending, setPending] = useState(false);

  const importPdf = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || file.size === 0) return setState({ error: "Choose a PDF work order to import." });
    if (file.type && file.type !== "application/pdf") return setState({ error: "That file is not a PDF." });
    if (file.size > MAX_BYTES) return setState({ error: "That PDF is larger than 25 MB." });

    setPending(true);
    setState({});
    try {
      const [{ extractWorkOrderText }, { parseWorkOrder }] = await Promise.all([
        import("@/lib/pdf/extract-text.client"),
        import("@/lib/pdf/parse-work-order"),
      ]);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extracted = await extractWorkOrderText(bytes);
      const draft = parseWorkOrder(extracted.text);
      if (!draft.tasks.length && !draft.fields.workOrderNumber) {
        setState({ error: "No work-order details were recognised. The PDF may be a scan - enter the details manually or paste the text." });
      } else {
        setState({ draft, meta: { usedPages: extracted.usedPages, pageCount: extracted.pageCount, stopped: extracted.stopped } });
      }
    } catch {
      setState({ error: "The PDF could not be read. Enter the details manually or paste the text instead." });
    } finally {
      setPending(false);
    }
  };

  if (state.draft) {
    const pct = Math.round(state.draft.confidence * 100);
    const low = state.draft.confidence < 0.8;
    return (
      <div className="space-y-5">
        <div className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${low ? "border-[#e6d3ad] bg-[#faf1d9] text-[#7a5a17]" : "border-[#cfe4d8] bg-[#eaf5ee] text-[#2f6446]"}`}>
          <ScanText className="h-4 w-4 shrink-0" />
          <p className="font-medium">
            Read {state.draft.tasks.length} task{state.draft.tasks.length === 1 ? "" : "s"} from {state.meta?.usedPages ?? "?"} of {state.meta?.pageCount ?? "?"} pages · {pct}% confidence.
          </p>
          <p className="text-[13px] opacity-90">Check every field below before saving - especially the manager-only total.</p>
        </div>
        <WorkOrderForm initialDraft={state.draft} />
      </div>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      {state.error && <div role="alert" className="mb-4 rounded-2xl border border-[#e7c8c4] bg-[#f8e7e4] px-4 py-3 text-sm font-medium text-[#8b3730]">{state.error}</div>}
      <form onSubmit={importPdf} className="space-y-4">
        <div>
          <Label htmlFor="file">Work order PDF</Label>
          <label htmlFor="file" className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#d9d4c9] bg-[#faf9f6] px-4 py-10 text-center hover:border-[#a46327]">
            <FileUp className="h-6 w-6 text-[#a46327]" />
            <span className="text-sm font-semibold text-[#3a423f]">Choose a PDF to import</span>
            <span className="text-xs text-[#77817e]">The header, trade scope and total cost are read up to the signature line. Policy attachments are ignored.</span>
            <input id="file" name="file" type="file" accept="application/pdf" required className="mt-2 text-sm" />
          </label>
        </div>
        <Button type="submit" disabled={pending}>{pending ? "Reading PDF..." : "Read work order"}</Button>
      </form>
    </Card>
  );
}
