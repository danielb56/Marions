import * as React from "react";
import { cn } from "@/lib/utils";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ className, variant = "primary", size = "md", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24535a] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-[#173f45] text-white shadow-sm hover:bg-[#24535a]",
        variant === "secondary" && "border border-[#d9d4c9] bg-white text-[#263331] hover:border-[#b8b1a3] hover:bg-[#f8f6f1]",
        variant === "ghost" && "text-[#51605d] hover:bg-[#eeece5] hover:text-[#263331]",
        variant === "danger" && "bg-[#a33a32] text-white hover:bg-[#862f29]",
        size === "sm" && "min-h-9 rounded-lg px-3 text-sm",
        size === "md" && "px-4 py-2.5 text-sm",
        size === "lg" && "min-h-12 px-5 py-3 text-base",
        className,
      )}
      {...props}
    />
  );
}
