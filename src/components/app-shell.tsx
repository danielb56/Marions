"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, CheckCircle2, ClipboardList, History, LayoutDashboard, LogOut, Settings, Users, Wrench } from "lucide-react";
import { signOut } from "@/actions/auth";
import { Logo } from "@/components/logo";
import type { UserProfile } from "@/lib/domain";
import { cn, initials } from "@/lib/utils";

const managerLinks = [
  { href: "/manager", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/manager/work-orders", label: "Work orders", icon: ClipboardList },
  { href: "/manager/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/manager/review", label: "Completion review", icon: CheckCircle2 },
  { href: "/manager/workers", label: "Workers", icon: Users },
  { href: "/manager/audit", label: "Audit history", icon: History },
  { href: "/manager/settings", label: "Settings", icon: Settings },
];

const workerLinks = [
  { href: "/worker", label: "Today", icon: Wrench, exact: true },
  { href: "/worker/upcoming", label: "Upcoming", icon: CalendarDays },
  { href: "/worker/history", label: "History", icon: CheckCircle2 },
  { href: "/worker/profile", label: "Profile", icon: Users },
];

function ActiveLink({ item, compact = false }: { item: (typeof managerLinks)[number]; compact?: boolean }) {
  const pathname = usePathname();
  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
  const Icon = item.icon;
  return <Link href={item.href} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition", active ? "bg-[#dcebea] text-[#173f45]" : "text-[#66716e] hover:bg-[#eeece5] hover:text-[#263331]", compact && "flex-col gap-1 rounded-none px-1 py-2 text-[11px]")}><Icon className={cn("h-5 w-5", active && "text-[#2d686e]")} /><span>{item.label}</span></Link>;
}

export function ManagerShell({ profile, unread, children }: { profile: UserProfile; unread: number; children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#f4f2ec] lg:grid lg:grid-cols-[252px_1fr]">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[252px] flex-col border-r border-[#ddd8cd] bg-[#faf9f6] p-4 lg:flex"><div className="px-2 py-3"><Logo href="/manager" /></div><nav className="mt-7 flex-1 space-y-1">{managerLinks.map((item) => <ActiveLink key={item.href} item={item} />)}</nav><div className="rounded-2xl border border-[#dfdbd1] bg-white p-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#173f45] text-sm font-bold text-white">{initials(profile.display_name)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{profile.display_name}</p><p className="truncate text-xs text-[#7b8582]">Manager</p></div><form action={signOut}><button aria-label="Sign out" className="grid h-10 w-10 place-items-center rounded-lg text-[#7b8582] hover:bg-[#f0eee8] hover:text-[#913a31]"><LogOut className="h-4 w-4" /></button></form></div></div></aside>
    <div className="lg:col-start-2"><header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-[#ddd8cd] bg-[#f8f6f1]/95 px-4 backdrop-blur lg:px-8"><div className="lg:hidden"><Logo href="/manager" /></div><p className="hidden text-sm font-medium text-[#74807c] lg:block">Australia/Sydney</p><Link href="/manager/notifications" className="relative grid h-10 w-10 place-items-center rounded-xl border border-[#ddd8cd] bg-white text-[#4f5e5b]"><Bell className="h-5 w-5" />{unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#b45a42] px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}</Link></header><main className="mx-auto w-full max-w-[1500px] p-4 pb-10 sm:p-6 lg:p-8">{children}</main></div>
  </div>;
}

export function WorkerShell({ profile, unread, children }: { profile: UserProfile; unread: number; children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#f4f2ec]"><header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#ddd8cd] bg-[#faf9f6]/95 px-4 backdrop-blur"><Logo href="/worker" /><div className="flex items-center gap-2"><Link href="/worker/notifications" aria-label={`${unread} unread notifications`} className="relative grid h-10 w-10 place-items-center rounded-xl text-[#4f5e5b]"><Bell className="h-5 w-5" />{unread > 0 && <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-[#faf9f6] bg-[#b45a42]" />}</Link><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#173f45] text-xs font-bold text-white">{initials(profile.display_name)}</div></div></header><main className="mx-auto w-full max-w-3xl px-4 py-5 pb-28">{children}</main><nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-[#d7d2c8] bg-[#faf9f6]/98 pb-[max(.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(36,49,47,.08)] backdrop-blur">{workerLinks.map((item) => <ActiveLink key={item.href} item={item} compact />)}</nav></div>;
}
