"use client";

import { useActionState } from "react";
import { assignWholeOrder, scheduleTask, unscheduleEntry } from "@/actions/work-orders";
import type { ActionState } from "@/actions/types";
import { MultiDateCalendar } from "@/components/multi-date-calendar";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type WorkerOption = { id: number; name: string };

export function WholeOrderAssignmentForm({ workOrderId, workers, today }: { workOrderId: number; workers: WorkerOption[]; today: string }) {
  const [state, action] = useActionState(assignWholeOrder, {} as ActionState);
  return <form action={action} className="space-y-3"><input type="hidden" name="workOrderId" value={workOrderId} /><div><Label htmlFor="wholeOrderWorkerId">Lead worker</Label><Select id="wholeOrderWorkerId" name="workerId" required defaultValue=""><option value="" disabled>Choose an active worker</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</Select></div><div><Label>Work dates</Label><MultiDateCalendar name="dates" today={today} /><p className="mt-2 text-xs leading-5 text-[#77817e]">Tasks are kept in work-order order, spread across these dates and booked as consecutive one-hour blocks from 8:00am.</p></div><label className="flex items-start gap-2 text-sm text-[#63706c]"><input className="mt-1" type="checkbox" name="preserveExisting" />Keep existing per-task workers as additional assignees</label>{state.error && <p role="alert" className="text-sm text-[#913a31]">{state.error}</p>}{state.message && <p role="status" className="text-sm font-medium text-[#2f6249]">{state.message}</p>}<SubmitButton className="w-full" pendingText="Assigning and scheduling...">Assign and schedule whole order</SubmitButton></form>;
}

export function ScheduleTaskForm({ taskId, workers, defaultWorkerId, today }: { taskId: number; workers: WorkerOption[]; defaultWorkerId?: number; today: string }) {
  const [state, action] = useActionState(scheduleTask, {} as ActionState);
  return <form action={action} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="taskId" value={taskId} /><div><Label>Worker</Label><Select name="workerId" defaultValue={defaultWorkerId ?? ""} required><option value="" disabled>Choose worker</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</Select></div><div><Label>Start time</Label><Input name="startTime" type="time" /></div><div className="sm:col-span-2"><Label>Dates</Label><MultiDateCalendar name="dates" today={today} /></div><div><Label>Estimated hours per selected day</Label><Input name="estimatedHours" type="number" min="0.25" max="24" step="0.25" /></div>{state.error && <p role="alert" className="sm:col-span-2 text-sm text-[#913a31]">{state.error}</p>}{state.message && <p role="status" className="sm:col-span-2 text-sm font-medium text-[#2f6249]">{state.message}</p>}<div className="sm:col-span-2"><Button type="submit" variant="secondary" className="w-full">Save schedule</Button></div></form>;
}

export function UnscheduleEntryForm({ scheduleEntryId }: { scheduleEntryId: number }) {
  const [state, action] = useActionState(unscheduleEntry, {} as ActionState);
  return <details className="shrink-0 text-left"><summary className="cursor-pointer list-none rounded-lg px-2 py-1 text-xs font-semibold text-[#913a31] hover:bg-[#f5dfdc]">Remove</summary><form action={action} className="mt-2 w-full min-w-56 space-y-2 rounded-xl border border-[#e0dcd3] bg-white p-3 shadow-lg"><input type="hidden" name="scheduleEntryId" value={scheduleEntryId} /><Label>Reason</Label><Input name="reason" required minLength={2} maxLength={500} placeholder="Why is this date being removed?" />{state.error && <p role="alert" className="text-xs text-[#913a31]">{state.error}</p>}{state.message && <p role="status" className="text-xs text-[#2f6249]">{state.message}</p>}<SubmitButton className="w-full" pendingText="Removing...">Remove scheduled date</SubmitButton></form></details>;
}
