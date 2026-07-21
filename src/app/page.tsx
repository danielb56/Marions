import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";

export default async function Home() {
  const profile = await getCurrentProfile();
  redirect(profile?.role === "manager" ? "/manager" : profile?.role === "worker" ? "/worker" : "/sign-in");
}
