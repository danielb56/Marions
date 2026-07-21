import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "blue" | "green" | "amber" | "red" | "purple" | "teal"; className?: string }) {
  const tones = {
    neutral: "bg-[#eeece5] text-[#59605e]",
    blue: "bg-[#e7eef5] text-[#31546e]",
    green: "bg-[#e1eee8] text-[#2f6249]",
    amber: "bg-[#f6ead0] text-[#7a5314]",
    red: "bg-[#f5dfdc] text-[#913a31]",
    purple: "bg-[#eee6f3] text-[#69477a]",
    teal: "bg-[#dceced] text-[#265d61]",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold tracking-wide", tones[tone], className)}>{children}</span>;
}
