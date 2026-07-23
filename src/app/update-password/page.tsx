import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { PasswordForm } from "@/components/password-form";
import { createClient } from "@/lib/supabase/server";

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?error=password-link");
  const isInvite = invite === "1";
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5"><Logo href="/" /><div className="mt-8 rounded-3xl border border-[#dfdbd1] bg-white p-8"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#b44a00]">{isInvite ? "Account setup" : "Account security"}</p><h1 className="mt-1 text-2xl font-semibold">{isInvite ? "Create your password" : "Choose a new password"}</h1><p className="mb-6 mt-2 text-sm text-[#697370]">Use a unique password you do not use elsewhere. You&apos;ll confirm it before continuing.</p><PasswordForm mode="update" intent={isInvite ? "invite" : "recovery"} /></div></main>;
}
