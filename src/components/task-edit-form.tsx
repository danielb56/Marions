"use client";

import { useActionState } from "react";
import { Pencil } from "lucide-react";
import { updateTaskDetails } from "@/actions/work-orders";
import type { ActionState } from "@/actions/types";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { UNITS } from "@/lib/domain";

type TaskEditFormProps = {
  task: {
    id: number;
    description: string;
    quantity: number;
    unit: string;
    areaLabel: string | null;
  };
};

export function TaskEditForm({ task }: TaskEditFormProps) {
  const [state, action] = useActionState(updateTaskDetails, {} as ActionState);
  const prefix = `task-${task.id}`;

  return (
    <details className="mt-4 rounded-xl border border-[#d8e3e1] bg-[#f5fafc] p-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-[#0077a8]">
        <Pencil className="h-4 w-4" />Edit task
      </summary>
      <form action={action} className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.35fr)_7rem_6.5rem]">
        <input type="hidden" name="taskId" value={task.id} />
        <div className="md:col-span-4">
          <Label htmlFor={`${prefix}-description`}>Description</Label>
          <Textarea id={`${prefix}-description`} name="description" required minLength={2} maxLength={1000} defaultValue={task.description} />
          {state.fieldErrors?.description?.map((error) => <p key={error} className="mt-1 text-xs text-[#913a31]">{error}</p>)}
        </div>
        <div>
          <Label htmlFor={`${prefix}-area`}>Area</Label>
          <Input id={`${prefix}-area`} name="area" maxLength={120} defaultValue={task.areaLabel ?? ""} placeholder="For example, Lounge" />
          {state.fieldErrors?.area?.map((error) => <p key={error} className="mt-1 text-xs text-[#913a31]">{error}</p>)}
        </div>
        <div>
          <Label htmlFor={`${prefix}-quantity`}>Quantity</Label>
          <Input id={`${prefix}-quantity`} name="quantity" type="number" required min="0.001" max="999999" step="0.001" defaultValue={task.quantity} />
          {state.fieldErrors?.quantity?.map((error) => <p key={error} className="mt-1 text-xs text-[#913a31]">{error}</p>)}
        </div>
        <div>
          <Label htmlFor={`${prefix}-unit`}>Unit</Label>
          <Select id={`${prefix}-unit`} name="unit" required defaultValue={task.unit}>
            {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </Select>
          {state.fieldErrors?.unit?.map((error) => <p key={error} className="mt-1 text-xs text-[#913a31]">{error}</p>)}
        </div>
        <div className="flex items-end">
          <SubmitButton className="w-full" pendingText="Saving task...">Save changes</SubmitButton>
        </div>
        {state.error && <p role="alert" className="text-sm text-[#913a31] md:col-span-4">{state.error}</p>}
        {state.message && <p role="status" className="text-sm font-semibold text-[#2f6249] md:col-span-4">{state.message}</p>}
      </form>
    </details>
  );
}
