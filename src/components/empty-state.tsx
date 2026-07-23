import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-[#cec8bd] bg-[#faf9f6] px-6 text-center"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e6f3f8] text-[#0077a8]"><Icon className="h-6 w-6" /></div><h2 className="mt-4 text-lg font-semibold">{title}</h2><p className="mt-1 max-w-md text-sm leading-6 text-[#6c7774]">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}
