"use client";

import { useActionState } from "react";
import { LockKeyhole, Mail } from "lucide-react";
import { signIn, type AuthState } from "@/actions/auth";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: AuthState = {};

export function AuthForm() {
  const [state, action] = useActionState(signIn, initialState);
  return <form action={action} className="space-y-4">
    <div><label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-[#35423f]">Email</label><div className="relative"><Mail className="absolute left-3.5 top-3.5 h-4 w-4 text-[#7c8582]" /><input id="email" name="email" type="email" autoComplete="email" required className="min-h-12 w-full rounded-xl border border-[#d9d4c9] pl-10 pr-3 text-[15px] outline-none focus:border-[#3b7379] focus:ring-3 focus:ring-[#dcebec]" placeholder="you@company.com.au" /></div></div>
    <div><div className="mb-1.5 flex items-center justify-between"><label htmlFor="password" className="text-sm font-semibold text-[#35423f]">Password</label><a href="/forgot-password" className="text-sm font-semibold text-[#2f666c] hover:underline">Forgot password?</a></div><div className="relative"><LockKeyhole className="absolute left-3.5 top-3.5 h-4 w-4 text-[#7c8582]" /><input id="password" name="password" type="password" autoComplete="current-password" required className="min-h-12 w-full rounded-xl border border-[#d9d4c9] pl-10 pr-3 text-[15px] outline-none focus:border-[#3b7379] focus:ring-3 focus:ring-[#dcebec]" /></div></div>
    {state.error && <p role="alert" className="rounded-xl bg-[#f5dfdc] px-3.5 py-3 text-sm font-medium text-[#913a31]">{state.error}</p>}
    <SubmitButton className="w-full" pendingText="Signing in...">Sign in securely</SubmitButton>
  </form>;
}
