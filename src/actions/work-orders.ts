"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { parseScheduleDates, workOrderInputSchema } from "@/lib/domain";
import { logger } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/actions/types";

export async function createWorkOrder(_: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole("manager");
  let tasks: unknown = [];
  try { tasks = JSON.parse(String(formData.get("tasks") ?? "[]")); } catch { return { error: "The task list could not be read." }; }
  const raw = {
    clientName: formData.get("clientName"), customerName: formData.get("customerName"), customerPhone: formData.get("customerPhone"),
    streetAddress: formData.get("streetAddress"), suburb: formData.get("suburb"), state: formData.get("state"), postcode: formData.get("postcode"),
    siteContactName: formData.get("siteContactName"), siteContactPhone: formData.get("siteContactPhone"), workOrderNumber: formData.get("workOrderNumber"),
    jobNumber: formData.get("jobNumber"), clientReference: formData.get("clientReference"), supervisorName: formData.get("supervisorName"), supervisorPhone: formData.get("supervisorPhone"),
    issuedAt: formData.get("issuedAt"), startDate: formData.get("startDate"), dueDate: formData.get("dueDate"), notes: formData.get("notes"), additionalInstructions: formData.get("additionalInstructions"),
    totalCents: formData.get("totalCents"), duplicateReason: formData.get("duplicateReason"), tasks,
  };
  const parsed = workOrderInputSchema.safeParse(raw);
  if (!parsed.success) return { error: "Check the highlighted information and try again.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const payload = {
    ...parsed.data,
    subtotalCents: parsed.data.totalCents,
    gstRate: 0,
    gstCents: 0,
    totalOverride: true,
  };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_work_order_bundle", { p_payload: payload });
  if (error) {
    logger.error("work_order.create_failed", error);
    const duplicate = error.message.toLowerCase().includes("duplicate");
    return { error: duplicate ? "A work order with that number or client reference already exists. Add a duplicate reason if this is intentional." : "The work order could not be saved." };
  }
  revalidatePath("/manager"); revalidatePath("/manager/work-orders");
  redirect(`/manager/work-orders/${data}`);
}

export async function assignWholeOrder(_: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole("manager");
  const workOrderId = Number(formData.get("workOrderId"));
  const workerId = Number(formData.get("workerId"));
  const dates = parseScheduleDates(String(formData.get("dates") ?? ""));
  if (!Number.isInteger(workOrderId) || workOrderId < 1 || !Number.isInteger(workerId) || workerId < 1) return { error: "Choose a worker." };
  if (!dates) return { error: "Choose between 1 and 62 valid schedule dates." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_and_schedule_whole_order", { p_work_order_id: workOrderId, p_worker_id: workerId, p_dates: dates, p_preserve_existing: formData.get("preserveExisting") === "on" });
  if (error) return { error: error.message };
  const result = data as { assignedTasks?: number; scheduledTasks?: number; scheduledDays?: number } | null;
  revalidatePath(`/manager/work-orders/${workOrderId}`); revalidatePath("/manager"); revalidatePath("/manager/calendar"); revalidatePath("/worker"); revalidatePath("/worker/jobs"); revalidatePath("/worker/upcoming");
  const scheduledDays = result?.scheduledDays ?? dates.length;
  return { ok: true, message: `${result?.assignedTasks ?? 0} tasks assigned and ${result?.scheduledTasks ?? 0} one-hour blocks scheduled from 8:00am across ${scheduledDays} day${scheduledDays === 1 ? "" : "s"}.` };
}

export async function assignTask(_: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole("manager");
  const taskId = Number(formData.get("taskId"));
  const workerIds = formData.getAll("workerIds").map(Number).filter(Number.isInteger);
  const leadWorkerId = Number(formData.get("leadWorkerId"));
  if (!taskId || !workerIds.length || !leadWorkerId) return { error: "Choose at least one worker and a lead." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_task", { p_task_id: taskId, p_worker_ids: workerIds, p_lead_worker_id: leadWorkerId });
  if (error) return { error: error.message };
  revalidatePath("/manager/work-orders"); revalidatePath("/manager");
  return { ok: true, message: "Task assignment updated." };
}

export async function scheduleTask(_: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole("manager");
  const taskId = Number(formData.get("taskId"));
  const workerId = Number(formData.get("workerId"));
  const dates = parseScheduleDates(String(formData.get("dates") ?? ""));
  if (!Number.isInteger(taskId) || taskId < 1 || !Number.isInteger(workerId) || workerId < 1) return { error: "Choose a worker." };
  if (!dates) return { error: "Choose between 1 and 62 valid schedule dates." };
  const supabase = await createClient();
  const { data: task, error: taskError } = await supabase.from("task").select("work_order_id").eq("id", taskId).single();
  if (taskError || !task) return { error: "The task could not be found." };
  const { error } = await supabase.rpc("schedule_task", { p_task_id: taskId, p_worker_id: workerId, p_dates: dates, p_start_time: String(formData.get("startTime") ?? "") || null, p_estimated_hours: Number(formData.get("estimatedHours")) || null });
  if (error) return { error: error.message };
  revalidatePath(`/manager/work-orders/${task.work_order_id}`); revalidatePath("/manager/calendar"); revalidatePath("/manager/work-orders"); revalidatePath("/worker"); revalidatePath("/worker/upcoming");
  return { ok: true, message: dates.length > 1 ? "Multi-day schedule saved." : "Task scheduled." };
}

export async function unscheduleEntry(_: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole("manager");
  const scheduleEntryId = Number(formData.get("scheduleEntryId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isInteger(scheduleEntryId) || scheduleEntryId < 1) return { error: "The scheduled date is invalid." };
  if (reason.length < 2 || reason.length > 500) return { error: "Enter a reason between 2 and 500 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("unschedule_entry", { p_schedule_entry_id: scheduleEntryId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath("/manager/calendar");
  revalidatePath("/manager/work-orders");
  revalidatePath("/worker");
  revalidatePath("/worker/upcoming");
  return { ok: true, message: "Scheduled date removed and the worker was notified." };
}

export async function unassignTask(_: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole("manager");
  const taskId = Number(formData.get("taskId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isInteger(taskId) || taskId < 1) return { error: "The task is invalid." };
  if (reason.length < 2 || reason.length > 500) return { error: "Enter a reason between 2 and 500 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unassign_task", { p_task_id: taskId, p_reason: reason });
  if (error) return { error: error.message };
  const result = data as { workOrderId?: number; unassignedWorkers?: number } | null;
  if (result?.workOrderId) revalidatePath(`/manager/work-orders/${result.workOrderId}`);
  revalidatePath("/manager/calendar"); revalidatePath("/manager/work-orders"); revalidatePath("/manager"); revalidatePath("/worker"); revalidatePath("/worker/jobs"); revalidatePath("/worker/upcoming");
  return { ok: true, message: `Task unassigned from ${result?.unassignedWorkers ?? 0} worker${result?.unassignedWorkers === 1 ? "" : "s"}.` };
}

export async function unscheduleAllUpcoming(_: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole("manager");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 2 || reason.length > 500) return { error: "Enter a reason between 2 and 500 characters." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unschedule_all_upcoming", { p_reason: reason });
  if (error) return { error: error.message };
  const result = data as { removedEntries?: number; affectedWorkers?: number } | null;
  revalidatePath("/manager/calendar"); revalidatePath("/manager/work-orders"); revalidatePath("/manager"); revalidatePath("/worker"); revalidatePath("/worker/jobs"); revalidatePath("/worker/upcoming");
  const removed = result?.removedEntries ?? 0;
  return { ok: true, message: removed > 0 ? `${removed} upcoming schedule ${removed === 1 ? "entry" : "entries"} removed across ${result?.affectedWorkers ?? 0} worker${result?.affectedWorkers === 1 ? "" : "s"}.` : "There were no upcoming schedules to remove." };
}

export async function cancelWorkOrder(formData: FormData) {
  const profile = await assertRole("manager");
  const workOrderId = Number(formData.get("workOrderId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!workOrderId || !reason) throw new Error("A cancellation reason is required");
  const supabase = await createClient();
  const { error } = await supabase.from("work_order").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_reason: reason }).eq("id", workOrderId).eq("tenant_id", profile.tenant_id);
  if (error) throw new Error("Could not cancel work order");
  revalidatePath("/manager/work-orders"); redirect("/manager/work-orders");
}

export async function reopenTask(formData: FormData) {
  await assertRole("manager");
  const taskId = Number(formData.get("taskId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!taskId || !reason) throw new Error("A reason is required");
  const supabase = await createClient();
  const { error } = await supabase.from("task").update({ status: "changes_requested", completed_at: null, revised_since_viewed: true }).eq("id", taskId);
  if (error) throw new Error("Could not reopen task");
  await supabase.from("note").insert({ tenant_id: (await assertRole("manager")).tenant_id, parent_type: "task", parent_id: taskId, author_user_id: (await assertRole("manager")).id, body: reason, visibility: "worker_visible", note_type: "problem" });
  revalidatePath("/manager/work-orders");
}
