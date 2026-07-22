/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { createClient } from "@/lib/supabase/client";

export function MfaEnrol() {
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "REME manager" });
      if (enrollError) { setError(enrollError.message); setBusy(false); return; }
      setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret); setBusy(false);
    })();
  }, []);

  const verify = async () => {
    setBusy(true); setError("");
    const supabase = createClient();
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) { setError(challenge.error.message); setBusy(false); return; }
    const result = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
    if (result.error) { setError("That code was not accepted. Check the time on your phone and try again."); setBusy(false); return; }
    const saved = await supabase.rpc("set_mfa_enrolled", { p_enrolled: true });
    if (saved.error) { setError(saved.error.message); setBusy(false); return; }
    router.replace("/manager"); router.refresh();
  };

  if (busy && !qr) return <div className="flex items-center gap-2 text-sm text-[#65716d]"><LoaderCircle className="h-4 w-4 animate-spin" />Preparing authenticator...</div>;
  return <div className="space-y-5">{qr && <div className="flex justify-center rounded-2xl bg-white p-4"><img src={qr} alt="Authenticator QR code" className="h-52 w-52" /></div>}<div><Label>Manual setup key</Label><code className="block break-all rounded-xl bg-[#f1efe9] p-3 text-xs">{secret}</code></div><div><Label htmlFor="code">Six-digit code</Label><Input id="code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" /></div>{error && <p className="rounded-xl bg-[#f5dfdc] p-3 text-sm text-[#913a31]">{error}</p>}<Button className="w-full" onClick={() => void verify()} disabled={busy || code.length !== 6}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Verify and continue</Button></div>;
}

export function MfaChallenge() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const verify = async () => {
    setBusy(true); setError("");
    const supabase = createClient();
    const factors = await supabase.auth.mfa.listFactors();
    const factor = factors.data?.totp.find((item) => item.status === "verified");
    if (!factor) { router.replace("/security/mfa-enrol"); return; }
    const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error) { setError(challenge.error.message); setBusy(false); return; }
    const result = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code });
    if (result.error) { setError("Incorrect code. Try the current code from your authenticator."); setBusy(false); return; }
    router.replace("/manager"); router.refresh();
  };

  return <div className="space-y-4"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e2f1f8] text-[#0077a8]"><KeyRound className="h-6 w-6" /></div><div><Label htmlFor="mfa-code">Authenticator code</Label><Input id="mfa-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoFocus autoComplete="one-time-code" placeholder="000000" /></div>{error && <p className="rounded-xl bg-[#f5dfdc] p-3 text-sm text-[#913a31]">{error}</p>}<Button className="w-full" onClick={() => void verify()} disabled={busy || code.length !== 6}>{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}Continue</Button></div>;
}
