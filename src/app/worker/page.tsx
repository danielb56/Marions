import Link from "next/link";
import { ArrowRight, CalendarCheck2, ClipboardList, Coffee } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { WorkerTaskCard, type WorkerTaskCardData } from "@/components/worker-task-card";
import { requireRole } from "@/lib/auth";
import { assertWorkerSafe } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

type SafeTask = Omit<WorkerTaskCardData, "schedule" | "job">;
type SafeJob = { id: number; work_order_number: string; client_name: string; suburb: string };
export const metadata = { title: "Today" };
export default async function WorkerTodayPage() {
  const profile = await requireRole("worker");
  const supabase = await createClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
  const [{ data: taskData }, { data: scheduleData }, { data: jobData }] = await Promise.all([
    supabase.from("worker_task_safe").select("id,work_order_id,description,quantity,unit,area_label,status,trade_name,is_lead,participant_count"),
    supabase.from("schedule_entry").select("task_id,planned_date,start_time").eq("planned_date", today),
    supabase.from("worker_job_safe").select("id,work_order_number,client_name,suburb"),
  ]);
  const tasks = assertWorkerSafe((taskData ?? []) as SafeTask[]) as SafeTask[];
  const jobs = assertWorkerSafe((jobData ?? []) as SafeJob[]) as SafeJob[];
  const schedule = assertWorkerSafe(scheduleData ?? []) as Array<{ task_id: number; planned_date: string; start_time: string | null }>;
  const todayTasks = tasks.filter((task) => schedule.some((entry) => entry.task_id === task.id)).map((task) => ({ ...task, schedule: schedule.find((entry) => entry.task_id === task.id), job: jobs.find((job) => job.id === task.work_order_id) }));
  return <><div className="mb-6 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-[#a46327]">{formatDate(today, "EEEE, d MMMM")}</p><h1 className="mt-1 text-3xl font-semibold tracking-[-.04em]">Good day, {profile.display_name.split(" ")[0]}</h1><p className="mt-2 text-sm text-[#6c7774]">{todayTasks.length ? `${todayTasks.length} task${todayTasks.length === 1 ? "" : "s"} on your run sheet.` : "Your run sheet is clear."}</p></div><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e5d5bd] text-[#8b5d1f]"><CalendarCheck2 className="h-6 w-6" /></div></div>
  <div className="mb-5 grid grid-cols-2 gap-3"><Link href="/worker/jobs" className="rounded-2xl bg-[#173f45] p-4 text-white"><ClipboardList className="h-5 w-5 text-[#9fc5c4]" /><p className="mt-3 text-2xl font-semibold">{new Set(tasks.map((task) => task.work_order_id)).size}</p><p className="text-xs text-[#cfe0df]">Assigned jobs</p></Link><Link href="/worker/upcoming" className="rounded-2xl border border-[#d9d4c9] bg-white p-4"><ArrowRight className="h-5 w-5 text-[#2f666c]" /><p className="mt-3 text-2xl font-semibold">{tasks.filter((task) => task.status !== "completed").length}</p><p className="text-xs text-[#707a77]">Open tasks</p></Link></div>
  {todayTasks.length ? <div className="space-y-3">{todayTasks.map((task) => <WorkerTaskCard key={task.id} task={task} />)}</div> : <EmptyState icon={Coffee} title="No work scheduled today" description="Assigned work still appears under Upcoming and Jobs. Marion will notify you when the schedule changes." action={<Link href="/worker/upcoming" className="font-semibold text-[#2f666c]">View upcoming work</Link>} />}</>;
}
