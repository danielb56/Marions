import Link from "next/link";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { ArrowLeft, ArrowRight, CalendarDays, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TaskStatus, WorkOrderStatus } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type WorkOrderSummary = { id: number; work_order_number: string; status: WorkOrderStatus; client: { name: string } | null };
type ScheduleItem = { id: number; planned_date: string; start_time: string | null; estimated_hours: number | null; worker_id: number | null; task: { id: number; description: string; status: TaskStatus; work_order: WorkOrderSummary | null } | null; work_order: WorkOrderSummary | null };
type WorkerRow = { id: number; user_profile: { display_name: string } | null };
export const metadata = { title: "Calendar" };
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
  const base = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? parseISO(week) : parseISO(today);
  const monday = startOfWeek(base, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const from = format(days[0], "yyyy-MM-dd"), to = format(days[6], "yyyy-MM-dd");
  const supabase = await createClient();
  const [{ data: scheduleData }, { data: workerData }, { data: taskData }] = await Promise.all([
    supabase.from("schedule_entry").select("id,planned_date,start_time,estimated_hours,worker_id,task:task_id(id,description,status,work_order:work_order_id(id,work_order_number,status,client:client_id(name))),work_order:work_order_id(id,work_order_number,status,client:client_id(name))").gte("planned_date", from).lte("planned_date", to).order("start_time"),
    supabase.from("worker").select("id,user_profile:user_id(display_name,is_active)").order("id"),
    supabase.from("task").select("id,description,status,work_order:work_order_id(id,work_order_number,schedule_entry(id)),assignment(id),schedule_entry(id)").not("status", "in", "(completed,cancelled)"),
  ]);
  const schedule = (scheduleData ?? []) as unknown as ScheduleItem[];
  const workers = (workerData ?? []).filter((worker) => (worker.user_profile as unknown as { is_active?: boolean } | null)?.is_active) as unknown as WorkerRow[];
  const taskRows = (taskData ?? []) as unknown as Array<{ id: number; description: string; status: TaskStatus; work_order: { id: number; work_order_number: string; schedule_entry: Array<{ id: number }> } | null; assignment: Array<{ id: number }>; schedule_entry: Array<{ id: number }> }>;
  const unscheduled = taskRows.filter((task) => task.assignment.length > 0 && task.schedule_entry.length === 0 && !task.work_order?.schedule_entry.length);
  return <><PageHeader eyebrow="Planning" title="Crew calendar" description={`${format(days[0], "d MMM")} - ${format(days[6], "d MMM yyyy")}`} actions={<><Link aria-label="Previous week" href={`/manager/calendar?week=${format(addDays(monday,-7),"yyyy-MM-dd")}`} className="grid h-11 w-11 place-items-center rounded-xl border border-[#d9d4c9] bg-white"><ArrowLeft className="h-4 w-4" /></Link><Link aria-label="Next week" href={`/manager/calendar?week=${format(addDays(monday,7),"yyyy-MM-dd")}`} className="grid h-11 w-11 place-items-center rounded-xl border border-[#d9d4c9] bg-white"><ArrowRight className="h-4 w-4" /></Link></>} />
  <Card className="overflow-x-auto"><div className="min-w-[1050px]"><div className="grid grid-cols-[170px_repeat(7,1fr)] border-b border-[#ddd8ce] bg-[#f8f6f1]"><div className="p-3 text-xs font-bold uppercase tracking-wider text-[#737d7a]">Worker</div>{days.map((day) => { const date = format(day, "yyyy-MM-dd"); const isToday = date === today; return <div key={date} className={cn("border-l border-[#e1ddd4] p-3 text-center", isToday && "bg-[#fff3da] ring-2 ring-inset ring-[#d49a4a]")}><p className="text-xs font-bold uppercase text-[#7a8380]">{format(day,"EEE")}</p><p className="mt-1 text-lg font-semibold">{format(day,"d")}</p>{isToday && <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-[#9b5d20]">Today</p>}</div>; })}</div>{workers.map((worker) => <div key={worker.id} className="grid min-h-28 grid-cols-[170px_repeat(7,1fr)] border-b border-[#e8e4dc] last:border-0"><div className="p-3 text-sm font-semibold">{worker.user_profile?.display_name}</div>{days.map((day) => { const date = format(day,"yyyy-MM-dd"); const items = schedule.filter((item) => item.worker_id === worker.id && item.planned_date === date); const hours = items.reduce((sum,item) => sum + Number(item.estimated_hours ?? 0),0); const isToday = date === today; return <div key={date} className={cn("space-y-2 border-l border-[#e8e4dc] p-2", isToday && "bg-[#fffbf2]", hours > 8 && "bg-[#fff1e8]")}>{items.map((item) => { const order = item.task?.work_order ?? item.work_order; const status = item.task?.status ?? order?.status; return <Link href={`/manager/work-orders/${order?.id}`} key={item.id} className="block rounded-lg border border-[#cfdedc] bg-[#e8f1ef] p-2 text-xs"><p className="font-bold text-[#24575d]">{item.start_time?.slice(0,5) ?? "Any time"} · {order?.work_order_number}</p><p className="mt-1 line-clamp-2 font-medium">{item.task?.description ?? "Whole work order · All tasks"}</p>{status && <div className="mt-2"><StatusBadge status={status} /></div>}</Link>; })}{hours > 8 && <Badge tone="red"><TriangleAlert className="mr-1 h-3 w-3" />{hours}h</Badge>}</div>; })}</div>)}</div></Card>
  <Card className="mt-6 overflow-hidden"><div className="flex items-center justify-between border-b border-[#e8e4dc] px-5 py-4"><div><h2 className="font-semibold">Assigned but unscheduled</h2><p className="text-sm text-[#7a8380]">Use a work order&apos;s task scheduler to add dates.</p></div><Badge tone={unscheduled.length ? "amber" : "green"}>{unscheduled.length}</Badge></div><div className="divide-y divide-[#e9e5dd]">{unscheduled.slice(0,20).map((task) => <Link key={task.id} href={`/manager/work-orders/${task.work_order?.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-[#faf9f6]"><div><p className="text-sm font-semibold">{task.description}</p><p className="mt-1 text-xs text-[#7a8380]">{task.work_order?.work_order_number}</p></div><CalendarDays className="h-4 w-4 text-[#2f666c]" /></Link>)}{!unscheduled.length && <p className="p-8 text-center text-sm text-[#7a8380]">All assigned tasks are scheduled.</p>}</div></Card></>;
}
