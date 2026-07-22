import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PdfImportClient } from "@/components/pdf-import-client";

export const metadata = { title: "Import work order PDF" };

export default function ImportWorkOrderPage() {
  return (
    <>
      <PageHeader
        eyebrow="Import"
        title="Import a work order PDF"
        description="Upload a work order. Marion reads the header, scope and total cost, then hands you a pre-filled draft to review and edit before saving."
        actions={<Link href="/manager/work-orders/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#d9d4c9] bg-white px-4 text-sm font-semibold"><ArrowLeft className="h-4 w-4" />Manual entry</Link>}
      />
      <PdfImportClient />
    </>
  );
}
