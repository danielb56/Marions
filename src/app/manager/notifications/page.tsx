import { PageHeader } from "@/components/page-header";
import { NotificationList } from "@/components/notification-list";
import { createClient } from "@/lib/supabase/server";
export default async function ManagerNotificationsPage() { const supabase = await createClient(); const { data } = await supabase.from("notification").select("id,subject,body_redacted,action_url,channel,created_at,read_at").order("created_at", { ascending: false }).limit(100); return <><PageHeader eyebrow="Inbox" title="Notifications" /><NotificationList notifications={data ?? []} /></>; }
