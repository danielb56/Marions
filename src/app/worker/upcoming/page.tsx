import { addDays, format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { WorkerTaskCard, type WorkerTaskCardData } from "@/components/worker-task-card";
import { assertWorkerSafe } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export default async function UpcomingPage() {
  const supabase = await createClient(); const today = new Date(); const from = format(today,"yyyy-MM-dd"), to = format(addDays(today,14),"yyyy-MM-dd");
  const [{ data: schedules }, { data: tasks }, { data: jobs }] = await Promise.all([supabase.from("schedule_entry").select("task_id,planned_date,start_time").gte("planned_date",from).lte("planned_date",to).order("planned_date"), supabase.from("worker_task_safe").select("id,work_order_id,description,quantity,unit,area_label,status,trade_name,is_lead,participant_count"), supabase.from("worker_job_safe").select("id,work_order_number,client_name,suburb")]);
  assertWorkerSafe({ schedules, tasks, jobs });
  const rows = (schedules ?? []).map((schedule) => { const task = (tasks ?? []).find((item) => item.id === schedule.task_id); if (!task) return null; return { ...task, schedule, job: (jobs ?? []).find((job) => job.id === task.work_order_id) } as WorkerTaskCardData; }).filter(Boolean) as WorkerTaskCardData[];
  const grouped = rows.reduce<Record<string,WorkerTaskCardData[]>>((result,row) => { (result[row.schedule!.planned_date] ??= []).push(row); return result; },{});
  return <><p className="text-xs font-bold uppercase tracking-[.14em] text-[#a46327]">Next 14 days</p><h1 className="mb-5 mt-1 text-3xl font-semibold tracking-[-.04em]">Upcoming work</h1>{rows.length ? <div className="space-y-6">{Object.entries(grouped).map(([date,items]) => <section key={date}><h2 className="mb-2 text-sm font-bold text-[#596461]">{formatDate(date,"EEEE, d MMMM")}</h2><div className="space-y-3">{items.map((task) => <WorkerTaskCard key={`${task.id}-${date}`} task={task} />)}</div></section>)}</div> : <EmptyState icon={CalendarDays} title="No upcoming work" description="New assignments and schedule changes will appear here." />}</>;
}
