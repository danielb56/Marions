import { MfaEnrol } from "@/components/mfa";
import { Logo } from "@/components/logo";
import { requireRole } from "@/lib/auth";

export default async function MfaEnrolPage() {
  await requireRole("manager", { skipMfa: true });
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10"><Logo /><div className="mt-8 rounded-3xl border border-[#dfdbd1] bg-white p-7"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#a46327]">Manager security</p><h1 className="mt-1 text-2xl font-semibold">Set up your authenticator</h1><p className="mb-6 mt-2 text-sm leading-6 text-[#697370]">Scan the code with 1Password, Google Authenticator or another TOTP app. This protects pricing and approvals.</p><MfaEnrol /></div></main>;
}
