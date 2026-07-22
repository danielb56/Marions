"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MultiDateCalendar({ name, today, compact = false }: { name: string; today: string; compact?: boolean }) {
  const [month, setMonth] = useState(() => startOfMonth(parseISO(today)));
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  }), [month]);

  const toggleDate = (date: string) => {
    setSelectedDates((current) => current.includes(date)
      ? current.filter((item) => item !== date)
      : [...current, date].sort());
  };

  useEffect(() => {
    if (!compact || !open) return;

    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [compact, open]);

  const selectionLabel = selectedDates.length === 0
    ? "Choose dates"
    : selectedDates.length === 1
      ? format(parseISO(selectedDates[0]), "d MMM yyyy")
      : `${selectedDates.length} dates selected`;

  const calendar = <>
    <div className="flex items-center justify-between gap-2">
      <button type="button" aria-label="Previous month" onClick={() => setMonth((current) => subMonths(current, 1))} className={cn("grid place-items-center rounded-xl border border-[#e1ddd4] text-[#2f666c] hover:bg-[#f8f6f1]", compact ? "h-8 w-8" : "h-10 w-10")}><ChevronLeft className="h-4 w-4" /></button>
      <div className="text-center"><p className="font-semibold">{format(month, "MMMM yyyy")}</p><p className="text-xs text-[#7a8380]">Select one or more days</p></div>
      <button type="button" aria-label="Next month" onClick={() => setMonth((current) => addMonths(current, 1))} className={cn("grid place-items-center rounded-xl border border-[#e1ddd4] text-[#2f666c] hover:bg-[#f8f6f1]", compact ? "h-8 w-8" : "h-10 w-10")}><ChevronRight className="h-4 w-4" /></button>
    </div>
    <div className="mt-3 grid grid-cols-7 gap-1" aria-hidden="true">{WEEKDAYS.map((day) => <div key={day} className="py-1 text-center text-[10px] font-bold uppercase tracking-wide text-[#7b8582]">{day}</div>)}</div>
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Schedule dates">
      {days.map((day) => {
        const date = format(day, "yyyy-MM-dd");
        const selected = selectedDates.includes(date);
        const isToday = date === today;
        return <button
          key={date}
          type="button"
          aria-label={`${format(day, "EEEE, d MMMM yyyy")}${isToday ? ", today" : ""}`}
          aria-pressed={selected}
          onClick={() => toggleDate(date)}
          className={cn(
            "relative grid aspect-square place-items-center rounded-xl font-semibold transition",
            compact ? "min-h-8 text-xs" : "min-h-9 text-sm",
            isSameMonth(day, month) ? "text-[#303b38]" : "text-[#a4aaa7]",
            "hover:bg-[#edf4f2] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2f666c]",
            isToday && "ring-2 ring-inset ring-[#d49a4a]",
            selected && "bg-[#245d63] text-white hover:bg-[#19484e]",
          )}
        >
          {format(day, "d")}
          {isToday && <span className={cn("absolute bottom-1 h-1 w-1 rounded-full", selected ? "bg-[#f4c36f]" : "bg-[#b66b25]")} />}
        </button>;
      })}
    </div>
    <div className="mt-3 flex min-h-9 items-center justify-between gap-3 rounded-xl bg-[#f8f6f1] px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 font-semibold text-[#52605c]"><CalendarDays className="h-3.5 w-3.5" />{selectedDates.length ? `${selectedDates.length} day${selectedDates.length === 1 ? "" : "s"} selected` : "No dates selected"}</span>
      {selectedDates.length > 0 && <button type="button" onClick={() => setSelectedDates([])} className="inline-flex items-center gap-1 font-semibold text-[#913a31]"><X className="h-3.5 w-3.5" />Clear</button>}
    </div>
    {selectedDates.length > 0 && <p className="mt-2 text-xs leading-5 text-[#707a77]">{selectedDates.map((date) => format(parseISO(date), "d MMM yyyy")).join(" · ")}</p>}
    {compact && <button type="button" onClick={() => setOpen(false)} className="mt-3 min-h-9 w-full rounded-xl bg-[#245d63] px-3 text-sm font-semibold text-white hover:bg-[#19484e]">Done</button>}
  </>;

  if (compact) {
    return (
      <div ref={rootRef} className="relative">
        <input type="hidden" name={name} value={selectedDates.join(",")} />
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[#d9d4c9] bg-white px-3.5 text-left text-[15px] text-[#303b38] shadow-sm outline-none hover:border-[#8aaaa9] focus-visible:border-[#2f666c] focus-visible:ring-2 focus-visible:ring-[#b7d3d3]"
        >
          <span className={cn("truncate", selectedDates.length === 0 && "text-[#949c99]")}>{selectionLabel}</span>
          <CalendarDays className="h-4 w-4 shrink-0 text-[#2f666c]" />
        </button>
        {open && <div role="dialog" aria-label="Choose schedule dates" className="absolute left-0 top-full z-50 mt-2 w-full rounded-2xl border border-[#d9d4c9] bg-white p-3 shadow-xl">{calendar}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#d9d4c9] bg-white p-3">
      <input type="hidden" name={name} value={selectedDates.join(",")} />
      {calendar}
    </div>
  );
}
