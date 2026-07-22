import { InviteAcceptance } from "@/components/invite-acceptance";
import { Logo } from "@/components/logo";

export const metadata = { title: "Accept invitation" };

export default function AcceptInvitePage() {
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5"><Logo href="/sign-in" /><div className="mt-8 rounded-3xl border border-[#dfdbd1] bg-white p-8"><p className="text-xs font-bold uppercase tracking-[.14em] text-[#b44a00]">Secure invitation</p><h1 className="mb-4 mt-1 text-2xl font-semibold">Set up your account</h1><InviteAcceptance /></div></main>;
}
