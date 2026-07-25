import { MfaChallenge } from "@/components/mfa";
import { Logo } from "@/components/logo";
import { requireRole } from "@/lib/auth";

export default async function MfaPage() {
  await requireRole("manager", { skipMfa: true });
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
      <Logo />
      <div className="mt-8 rounded-3xl border border-[#dfdbd1] bg-white p-7 text-center">
        <p className="text-xs font-bold tracking-[.14em] text-[#b44a00] uppercase">One more step</p>
        <h1 className="mt-1 text-2xl font-semibold">Verify it&apos;s you</h1>
        <p className="mt-2 mb-6 text-sm text-[#697370]">
          Enter the current code from your authenticator app.
        </p>
        <MfaChallenge />
      </div>
    </main>
  );
}
