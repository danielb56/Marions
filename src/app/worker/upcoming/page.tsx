import { addDays, format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { WorkerTaskCard, type WorkerTaskCardData } from "@/components/worker-task-card";
import { assertWorkerSafe } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export default async function UpcomingPage() {
  const supabase = await createClient(); const from = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date()), to = format(addDays(parseISO(from),14),"yyyy-MM-dd");
  const [{ data: schedules }, { data: tasks }, { data: jobs }] = await Promise.all([supabase.from("schedule_entry").select("task_id,work_order_id,planned_date,start_time").gte("planned_date",from).lte("planned_date",to).order("planned_date"), supabase.from("worker_task_safe").select("id,work_order_id,description,quantity,unit,area_label,status,trade_name,is_lead,participant_count"), supabase.from("worker_job_safe").select("id,work_order_number,client_name,suburb")]);
  assertWorkerSafe({ schedules, tasks, jobs });
  const rowsByTaskAndDate = new Map<string, WorkerTaskCardData>();
  for (const schedule of schedules ?? []) {
    const matchingTasks = (tasks ?? []).filter((task) => schedule.task_id === task.id || (!schedule.task_id && schedule.work_order_id === task.work_order_id));
    for (const task of matchingTasks) {
      const key = `${task.id}:${schedule.planned_date}`;
      const existing = rowsByTaskAndDate.get(key);
      if (!existing || schedule.task_id === task.id) rowsByTaskAndDate.set(key, { ...task, schedule, job: (jobs ?? []).find((job) => job.id === task.work_order_id) } as WorkerTaskCardData);
    }
  }
  const rows = [...rowsByTaskAndDate.values()].sort((a, b) => a.schedule!.planned_date.localeCompare(b.schedule!.planned_date));
  const grouped = rows.reduce<Record<string,WorkerTaskCardData[]>>((result,row) => { (result[row.schedule!.planned_date] ??= []).push(row); return result; },{});
  return <><p className="text-xs font-bold uppercase tracking-[.14em] text-[#a46327]">Next 14 days</p><h1 className="mb-5 mt-1 text-3xl font-semibold tracking-[-.04em]">Upcoming work</h1>{rows.length ? <div className="space-y-6">{Object.entries(grouped).map(([date,items]) => <section key={date}><h2 className="mb-2 text-sm font-bold text-[#596461]">{formatDate(date,"EEEE, d MMMM")}</h2><div className="space-y-3">{items.map((task) => <WorkerTaskCard key={`${task.id}-${date}`} task={task} />)}</div></section>)}</div> : <EmptyState icon={CalendarDays} title="No upcoming work" description="New assignments and schedule changes will appear here." />}</>;
}
