"use client";

import { useActionState } from "react";
import { CalendarX2, TriangleAlert, UserMinus } from "lucide-react";
import { unassignTask, unscheduleAllUpcoming } from "@/actions/work-orders";
import type { ActionState } from "@/actions/types";
import { Input, Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function UnassignTaskForm({ taskId }: { taskId: number }) {
  const [state, action] = useActionState(unassignTask, {} as ActionState);
  const reasonId = `unassign-reason-${taskId}`;

  return (
    <form action={action} className="grid gap-3 rounded-xl bg-[#f8f6f1] p-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <input type="hidden" name="taskId" value={taskId} />
      <div>
        <Label htmlFor={reasonId}>Reason for unassigning</Label>
        <Input id={reasonId} name="reason" required minLength={2} maxLength={500} placeholder="For example, allocate to another worker" />
      </div>
      <SubmitButton variant="danger" pendingText="Unassigning..."><UserMinus className="h-4 w-4" />Unassign</SubmitButton>
      {state.error && <p role="alert" className="text-sm text-[#913a31] sm:col-span-2">{state.error}</p>}
      {state.message && <p role="status" className="text-sm font-semibold text-[#2f6249] sm:col-span-2">{state.message}</p>}
    </form>
  );
}

export function UnscheduleAllControl() {
  const [state, action] = useActionState(unscheduleAllUpcoming, {} as ActionState);

  return (
    <details className="relative">
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-xl bg-[#a33a32] px-3.5 text-sm font-semibold text-white hover:bg-[#862f29]">
        <CalendarX2 className="h-4 w-4" />Unschedule all
      </summary>
      <form action={action} className="absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2.5rem))] space-y-3 rounded-2xl border border-[#dfdbd1] bg-white p-4 text-left shadow-xl">
        <div className="flex gap-2 rounded-xl bg-[#f5dfdc] p-3 text-sm text-[#7b302a]">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>This removes every schedule from today onward. Past schedule history and worker assignments are kept.</p>
        </div>
        <div>
          <Label htmlFor="unschedule-all-reason">Reason</Label>
          <Input id="unschedule-all-reason" name="reason" required minLength={2} maxLength={500} placeholder="Why are all upcoming dates being removed?" />
        </div>
        {state.error && <p role="alert" className="text-sm text-[#913a31]">{state.error}</p>}
        {state.message && <p role="status" className="text-sm font-semibold text-[#2f6249]">{state.message}</p>}
        <SubmitButton className="w-full" variant="danger" pendingText="Removing schedules...">Confirm unschedule all</SubmitButton>
      </form>
    </details>
  );
}
