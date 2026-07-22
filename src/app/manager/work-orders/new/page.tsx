import Link from "next/link";
import { ArrowLeft, FileUp } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { WorkOrderForm } from "@/components/work-order-form";
export const metadata = { title: "New work order" };
export default function NewWorkOrderPage() { return <><PageHeader eyebrow="New work order" title="Capture the job once" description="Enter the operational scope and manager-only totals, then assign and schedule the crew." actions={<><Link href="/manager/work-orders/import" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#d9d4c9] bg-white px-4 text-sm font-semibold"><FileUp className="h-4 w-4" />Import from PDF</Link><Link href="/manager/work-orders" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#d9d4c9] bg-white px-4 text-sm font-semibold"><ArrowLeft className="h-4 w-4" />Back</Link></>} /><WorkOrderForm /></>; }
