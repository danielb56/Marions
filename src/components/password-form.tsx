"use client";

import { useActionState } from "react";
import { requestPasswordReset, updatePassword, type AuthState } from "@/actions/auth";
import { Input, Label } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function PasswordForm({ mode }: { mode: "request" | "update" }) {
  const [state, action] = useActionState(mode === "request" ? requestPasswordReset : updatePassword, {} as AuthState);
  return <form action={action} className="space-y-4">
    {mode === "request" ? <div><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required autoComplete="email" /></div> : <div><Label htmlFor="password">New password <span className="font-normal text-[#7c8582]">(12+ characters)</span></Label><Input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" /></div>}
    {state.error && <p className="rounded-xl bg-[#f5dfdc] p-3 text-sm text-[#913a31]">{state.error}</p>}
    {state.message && <p className="rounded-xl bg-[#e1eee8] p-3 text-sm text-[#2f6249]">{state.message}</p>}
    <SubmitButton className="w-full">{mode === "request" ? "Send reset link" : "Set new password"}</SubmitButton>
  </form>;
}
