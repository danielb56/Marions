import { NextResponse, type NextRequest } from "next/server";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next");
  const intent = request.nextUrl.searchParams.get("intent");
  const safeNext = safeAuthRedirect(next);
  const destination = intent === "invite" && safeNext === "/update-password"
    ? "/update-password?invite=1"
    : safeNext;
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destination, request.url));
  }

  // Admin invitations use an implicit browser flow and return the session in
  // the URL fragment, which a server route cannot read. Redirect to a client
  // handoff page; browsers retain the fragment across this redirect.
  if (!code && safeNext === "/update-password") {
    const acceptUrl = new URL("/auth/accept-invite", request.url);
    if (intent === "invite") acceptUrl.searchParams.set("intent", "invite");
    return NextResponse.redirect(acceptUrl);
  }

  return NextResponse.redirect(new URL("/sign-in?error=callback", request.url));
}
