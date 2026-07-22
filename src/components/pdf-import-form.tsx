"use client";

import { useActionState } from "react";
import { FileUp, ScanText } from "lucide-react";
import { extractWorkOrderPdf, type PdfImportState } from "@/actions/pdf-import";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { WorkOrderForm } from "@/components/work-order-form";

export function PdfImportForm() {
  const [state, action] = useActionState(extractWorkOrderPdf, {} as PdfImportState);

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
      <form action={action} className="space-y-4">
        <div>
          <Label htmlFor="file">Work order PDF</Label>
          <label htmlFor="file" className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#d9d4c9] bg-[#faf9f6] px-4 py-10 text-center hover:border-[#a46327]">
            <FileUp className="h-6 w-6 text-[#a46327]" />
            <span className="text-sm font-semibold text-[#3a423f]">Choose a PDF to import</span>
            <span className="text-xs text-[#77817e]">The header, trade scope and total cost are read up to the signature line. Policy attachments are ignored.</span>
            <input id="file" name="file" type="file" accept="application/pdf" required className="mt-2 text-sm" />
          </label>
        </div>
        <SubmitButton pendingText="Reading PDF...">Read work order</SubmitButton>
      </form>
    </Card>
  );
}
