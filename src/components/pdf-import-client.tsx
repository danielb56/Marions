"use client";

import dynamic from "next/dynamic";
import { Card } from "@/components/ui/card";

// PDF.js is intentionally browser-only. Disabling SSR for the importer keeps
// its large parser chunk out of the Cloudflare Worker while retaining it as a
// lazily loaded static asset for managers who use PDF import.
const PdfImportForm = dynamic(
  () => import("@/components/pdf-import-form").then((module) => module.PdfImportForm),
  {
    ssr: false,
    loading: () => <Card className="p-5 text-sm text-[#77817e] sm:p-6">Preparing PDF import...</Card>,
  },
);

export function PdfImportClient() {
  return <PdfImportForm />;
}
