import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { assertWorkerSafe, type WorkOrderStatus } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

type Job = { id:number; work_order_number:string; job_number:string|null; client_reference:string|null; status:WorkOrderStatus; start_date:string|null; completion_due_date:string|null; client_name:string; street_address:string; suburb:string; state:string; postcode:string };
export default async function JobsPage() { const supabase=await createClient(); const {data}=await supabase.from("worker_job_safe").select("id,work_order_number,job_number,client_reference,status,start_date,completion_due_date,client_name,street_address,suburb,state,postcode").order("start_date"); const jobs=assertWorkerSafe(data??[]) as Job[]; return <><p className="text-xs font-bold uppercase tracking-[.14em] text-[#a46327]">Assigned to you</p><h1 className="mb-5 mt-1 text-3xl font-semibold tracking-[-.04em]">Jobs</h1><div className="space-y-3">{jobs.map((job)=><Link key={job.id} href={`/worker/jobs/${job.id}`}><Card className="mb-3 p-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{job.work_order_number}</h2><StatusBadge status={job.status}/></div><p className="mt-1 text-sm text-[#65716d]">{job.client_name}</p><p className="mt-3 flex items-center gap-1.5 text-sm font-medium"><MapPin className="h-4 w-4 text-[#2f666c]"/>{job.street_address}, {job.suburb}</p><p className="mt-2 text-xs text-[#7b8582]">Due {formatDate(job.completion_due_date)}</p></div><ChevronRight className="mt-3 h-5 w-5 text-[#9ba19f]"/></div></Card></Link>)}</div></>; }
