import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { assertWorkerSafe } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { formatDate, titleCase } from "@/lib/utils";

type SubmissionRow = { id: number; status: string; submitted_at: string; review_notes: string | null; task: { id: number; description: string; status: string; work_order: { work_order_number: string } | null } | null };

export default async function WorkerHistoryPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("completion_submission").select("id,status,submitted_at,review_notes,task:task_id(id,description,status,work_order:work_order_id(work_order_number))").order("submitted_at", { ascending: false });
  const submissions = assertWorkerSafe(data ?? []) as unknown as SubmissionRow[];
  return <><p className="text-xs font-bold uppercase tracking-[.14em] text-[#a46327]">Your submissions</p><h1 className="mb-5 mt-1 text-3xl font-semibold tracking-[-.04em]">Completed work</h1><div className="space-y-3">{submissions.map((submission) => <Card key={submission.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-[#2f666c]">{submission.task?.work_order?.work_order_number}</p><p className="mt-1 font-semibold">{submission.task?.description}</p><p className="mt-2 text-xs text-[#7b8582]">Submitted {formatDate(submission.submitted_at, "d MMM yyyy, h:mm a")}</p>{submission.review_notes && <p className="mt-3 rounded-xl bg-[#f8f6f1] p-3 text-sm">Manager: {submission.review_notes}</p>}</div><span className="rounded-full bg-[#e7ece9] px-2.5 py-1 text-xs font-bold">{titleCase(submission.status)}</span></div></Card>)}{!submissions.length && <div className="py-16 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-[#9aa19f]" /><p className="mt-3 text-sm text-[#707a77]">Your completion history will appear here.</p></div>}</div></>;
}
