import Link from "next/link";
import { Bell } from "lucide-react";
import { markNotificationRead } from "@/actions/notifications";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

type NotificationRow = { id: number; subject: string; body_redacted: string; action_url: string | null; channel: string; created_at: string; read_at: string | null };
export function NotificationList({ notifications }: { notifications: NotificationRow[] }) {
  return <Card className="overflow-hidden"><div className="divide-y divide-[#e9e5dd]">{notifications.map((item) => <article key={item.id} className={`flex gap-3 p-5 ${item.read_at ? "bg-white" : "bg-[#f0f6f4]"}`}><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e2f1f8] text-[#0077a8]"><Bell className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{item.subject}</h2><time className="shrink-0 text-xs text-[#7b8582]">{formatDate(item.created_at, "d MMM, h:mm a")}</time></div><p className="mt-1 text-sm text-[#65716d]">{item.body_redacted}</p><div className="mt-3 flex gap-3">{item.action_url && <Link href={item.action_url} className="text-sm font-semibold text-[#0077a8]">Open</Link>}{!item.read_at && <form action={markNotificationRead}><input type="hidden" name="notificationId" value={item.id} /><button className="text-sm font-semibold text-[#6e7875]">Mark read</button></form>}</div></div></article>)}{!notifications.length && <div className="p-14 text-center text-sm text-[#737d7a]">You are all caught up.</div>}</div></Card>;
}
