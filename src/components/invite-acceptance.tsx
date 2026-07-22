"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function InviteAcceptance() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const accept = async () => {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.slice(1));
      const code = url.searchParams.get("code");
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const linkType = hash.get("type");
      const intent = linkType === "invite" || (!linkType && url.searchParams.get("intent") === "invite") ? "invite" : "recovery";

      // Remove one-time credentials from browser history immediately.
      window.history.replaceState({}, "", `/auth/accept-invite${intent === "invite" ? "?intent=invite" : ""}`);

      const supabase = createClient();
      let authError: Error | null = null;
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        authError = exchangeError;
      } else if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        authError = sessionError;
      } else authError = new Error("No invitation session");

      if (!active) return;
      if (authError) {
        setError("This invitation link is invalid or has expired. Ask your manager to send a new invitation.");
        return;
      }
      router.replace(intent === "invite" ? "/update-password?invite=1" : "/update-password");
      router.refresh();
    };
    void accept();
    return () => { active = false; };
  }, [router]);

  if (error) return <div role="alert"><p className="text-sm leading-6 text-[#913a31]">{error}</p><a href="/sign-in" className="mt-4 inline-flex min-h-11 items-center font-semibold text-[#2f666c]">Return to sign in</a></div>;
  return <p role="status" className="flex items-center gap-3 text-sm font-semibold text-[#596461]"><LoaderCircle className="h-5 w-5 animate-spin text-[#2f666c]" />Preparing your secure account setup...</p>;
}
