import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { Logo } from "@/components/logo";
import { getCurrentProfile } from "@/lib/auth";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ setup?: string; error?: string }> }) {
  const query = await searchParams;
  const profile = await getCurrentProfile();
  if (profile) redirect(profile.role === "manager" ? "/manager" : "/worker");
  return <main className="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]">
    <section className="noise-bg relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <Logo href="/sign-in" full priority />
      <div className="relative z-10 max-w-xl pb-12"><p className="mb-5 text-sm font-bold uppercase tracking-[.2em] text-[#ffad58]">REME Painting Group</p><h1 className="text-5xl font-semibold leading-[1.08] tracking-[-.04em]">From work order to signed off, without the phone chase.</h1><p className="mt-6 max-w-lg text-lg leading-8 text-[#dcedf5]">Plan the day, brief the crew, capture proof and approve completed work in one secure place.</p></div>
      <div className="flex items-center gap-3 text-sm text-[#dcedf5]"><ShieldCheck className="h-5 w-5 text-[#ffad58]" /> Pricing is protected from worker accounts at every layer.</div>
    </section>
    <section className="flex min-h-screen items-center justify-center bg-[#f3f6f9] px-5 py-10 sm:px-10"><div className="w-full max-w-md"><div className="mb-10 lg:hidden"><Logo href="/sign-in" priority /></div>{query.setup === "complete" && <p role="status" className="mb-4 rounded-2xl bg-[#e1eee8] p-4 text-sm font-semibold text-[#2f6249]">Your password is ready. Sign in with your new password.</p>}{query.error === "password-link" && <p role="alert" className="mb-4 rounded-2xl bg-[#f5dfdc] p-4 text-sm text-[#913a31]">That setup link is invalid or has expired. Ask your manager for a new invitation.</p>}<div className="rounded-3xl border border-[#d7e0e7] bg-white p-7 shadow-[0_20px_70px_rgba(0,63,112,.10)] sm:p-9"><p className="text-sm font-bold text-[#b44a00]">WELCOME BACK</p><h2 className="mt-2 text-3xl font-semibold tracking-[-.035em] text-[#173047]">Sign in to REME</h2><p className="mb-7 mt-2 text-[#607181]">Use the account your manager created for you.</p><AuthForm /></div><p className="mt-6 text-center text-xs leading-5 text-[#6d7d8a]">No public sign-up. Accounts are created by an authorised manager.</p></div></section>
  </main>;
}
