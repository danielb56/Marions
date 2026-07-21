import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { Logo } from "@/components/logo";
import { getCurrentProfile } from "@/lib/auth";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  const profile = await getCurrentProfile();
  if (profile) redirect(profile.role === "manager" ? "/manager" : "/worker");
  return <main className="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]">
    <section className="noise-bg relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <Logo href="/sign-in" />
      <div className="relative z-10 max-w-xl pb-12"><p className="mb-5 text-sm font-bold uppercase tracking-[.2em] text-[#a9cccb]">Work stays moving</p><h1 className="text-5xl font-semibold leading-[1.08] tracking-[-.04em]">From work order to signed off, without the phone chase.</h1><p className="mt-6 max-w-lg text-lg leading-8 text-[#d7e6e5]">Plan the day, brief the crew, capture proof and approve completed work in one secure place.</p></div>
      <div className="flex items-center gap-3 text-sm text-[#d7e6e5]"><ShieldCheck className="h-5 w-5 text-[#efbd69]" /> Pricing is protected from worker accounts at every layer.</div>
    </section>
    <section className="flex min-h-screen items-center justify-center bg-[#f4f2ec] px-5 py-10 sm:px-10"><div className="w-full max-w-md"><div className="mb-10 lg:hidden"><Logo href="/sign-in" /></div><div className="rounded-3xl border border-[#dfdbd1] bg-white p-7 shadow-[0_20px_70px_rgba(36,49,47,.08)] sm:p-9"><p className="text-sm font-bold text-[#b4772f]">WELCOME BACK</p><h2 className="mt-2 text-3xl font-semibold tracking-[-.035em] text-[#23312f]">Sign in to Marion</h2><p className="mb-7 mt-2 text-[#697370]">Use the account your manager created for you.</p><AuthForm /></div><p className="mt-6 text-center text-xs leading-5 text-[#7c8582]">No public sign-up. Accounts are created by an authorised manager.</p></div></section>
  </main>;
}
