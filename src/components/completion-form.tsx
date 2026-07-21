"use client";

import { useActionState, useState } from "react";
import { submitCompletion } from "@/actions/worker";
import type { ActionState } from "@/actions/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";

export function CompletionForm({ taskId }: { taskId: number }) {
  const [state, action] = useActionState(submitCompletion, {} as ActionState);
  const [blocked, setBlocked] = useState(false);
  return <form action={action} className="space-y-3"><input type="hidden" name="taskId" value={taskId} /><Textarea name="notes" placeholder="What was completed? Add details the manager should know." /><label className="flex min-h-12 items-center gap-3 rounded-xl border border-[#ddd8ce] bg-white px-3.5 text-sm font-semibold"><input type="checkbox" name="cannotComplete" checked={blocked} onChange={(event) => setBlocked(event.target.checked)} className="h-5 w-5 accent-[#a33a32]" />I cannot complete this task</label>{blocked && <Textarea name="problemReport" required placeholder="Explain the issue, access problem or scope change." />}{state.error && <p className="rounded-xl bg-[#f5dfdc] p-3 text-sm text-[#913a31]">{state.error}</p>}<Button type="submit" className="w-full" variant={blocked ? "danger" : "primary"}>{blocked ? "Report problem" : "Submit for approval"}</Button></form>;
}
