"use client";

import { useActionState } from "react";
import { assignWholeOrder, scheduleTask, unscheduleEntry } from "@/actions/work-orders";
import type { ActionState } from "@/actions/types";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type WorkerOption = { id: number; name: string };

export function WholeOrderAssignmentForm({ workOrderId, workers }: { workOrderId: number; workers: WorkerOption[] }) {
  const [state, action] = useActionState(assignWholeOrder, {} as ActionState);
  return <form action={action} className="space-y-3"><input type="hidden" name="workOrderId" value={workOrderId} /><div><Label htmlFor="workerId">Lead worker</Label><Select id="workerId" name="workerId" required defaultValue=""><option value="" disabled>Choose an active worker</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</Select></div><label className="flex items-start gap-2 text-sm text-[#63706c]"><input className="mt-1" type="checkbox" name="preserveExisting" />Keep existing per-task assignments</label>{state.error && <p className="text-sm text-[#913a31]">{state.error}</p>}{state.message && <p className="text-sm font-medium text-[#2f6249]">{state.message}</p>}<SubmitButton className="w-full">Assign whole order</SubmitButton></form>;
}

export function ScheduleTaskForm({ taskId, workers, defaultWorkerId }: { taskId: number; workers: WorkerOption[]; defaultWorkerId?: number }) {
  const [state, action] = useActionState(scheduleTask, {} as ActionState);
  return <form action={action} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="taskId" value={taskId} /><div><Label>Worker</Label><Select name="workerId" defaultValue={defaultWorkerId ?? ""} required><option value="" disabled>Choose worker</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</Select></div><div><Label>Dates</Label><Input name="dates" required placeholder="2026-07-22, 2026-07-23" /></div><div><Label>Start time</Label><Input name="startTime" type="time" /></div><div><Label>Estimated hours</Label><Input name="estimatedHours" type="number" min="0.25" max="24" step="0.25" /></div>{state.error && <p className="sm:col-span-2 text-sm text-[#913a31]">{state.error}</p>}{state.message && <p className="sm:col-span-2 text-sm font-medium text-[#2f6249]">{state.message}</p>}<div className="sm:col-span-2"><Button type="submit" variant="secondary" className="w-full">Save schedule</Button></div></form>;
}

export function UnscheduleEntryForm({ scheduleEntryId }: { scheduleEntryId: number }) {
  const [state, action] = useActionState(unscheduleEntry, {} as ActionState);
  return <details className="shrink-0 text-left"><summary className="cursor-pointer list-none rounded-lg px-2 py-1 text-xs font-semibold text-[#913a31] hover:bg-[#f5dfdc]">Remove</summary><form action={action} className="mt-2 w-full min-w-56 space-y-2 rounded-xl border border-[#e0dcd3] bg-white p-3 shadow-lg"><input type="hidden" name="scheduleEntryId" value={scheduleEntryId} /><Label>Reason</Label><Input name="reason" required minLength={2} maxLength={500} placeholder="Why is this date being removed?" />{state.error && <p role="alert" className="text-xs text-[#913a31]">{state.error}</p>}{state.message && <p role="status" className="text-xs text-[#2f6249]">{state.message}</p>}<SubmitButton className="w-full" pendingText="Removing...">Remove scheduled date</SubmitButton></form></details>;
}
