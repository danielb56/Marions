import type { TaskStatus, WorkOrderStatus } from "@/lib/domain";
import { titleCase } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const tone: Record<TaskStatus | WorkOrderStatus, Parameters<typeof Badge>[0]["tone"]> = {
  draft: "neutral", ready: "blue", assigned: "blue", scheduled: "teal", in_progress: "amber",
  completion_submitted: "purple", changes_requested: "amber", blocked: "red", completed: "green",
  signed_off: "green", cancelled: "neutral",
};

export function StatusBadge({ status }: { status: TaskStatus | WorkOrderStatus }) {
  return <Badge tone={tone[status]}>{titleCase(status)}</Badge>;
}
