import Link from "next/link";
import { ChevronRight, Clock3, MapPin } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import type { TaskStatus } from "@/lib/domain";

export type WorkerTaskCardData = { id: number; description: string; quantity: number; unit: string; area_label: string | null; status: TaskStatus; trade_name: string; is_lead: boolean; participant_count: number; work_order_id: number; schedule?: { planned_date: string; start_time: string | null } | null; job?: { work_order_number: string; client_name: string; suburb: string } | null };
export function WorkerTaskCard({ task }: { task: WorkerTaskCardData }) {
  return <Link href={`/worker/tasks/${task.id}`}><Card className="p-4 transition active:scale-[.99]"><div className="flex items-start gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#e2f1f8] text-xs font-black uppercase tracking-wide text-[#0078ad]">{task.trade_name.slice(0,2)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold leading-5">{task.description}</p>{task.is_lead && <span className="rounded-full bg-[#f4e6ca] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#81571b]">Lead</span>}</div><p className="mt-1 text-sm font-medium text-[#586561]">{task.quantity} {task.unit}{task.area_label ? ` · ${task.area_label}` : ""}</p><div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#77817e]">{task.schedule?.start_time && <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{task.schedule.start_time.slice(0,5)}</span>}{task.job && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{task.job.suburb}</span>}<StatusBadge status={task.status} /></div></div><ChevronRight className="mt-3 h-5 w-5 shrink-0 text-[#9ba19f]" /></div></Card></Link>;
}
