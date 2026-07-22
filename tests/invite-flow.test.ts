import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeAuthRedirect } from "@/lib/auth-redirect";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("worker invitation setup", () => {
  it("marks manager-created invitations as password-setup links", () => {
    expect(source("src/actions/workers.ts")).toContain("next=/update-password&intent=invite");
    expect(source("src/actions/team.ts")).toContain("next=/update-password&intent=invite");
  });

  it("accepts implicit invite sessions in the browser before opening password setup", () => {
    const acceptance = source("src/components/invite-acceptance.tsx");
    expect(acceptance).toContain('hash.get("access_token")');
    expect(acceptance).toContain('hash.get("refresh_token")');
    expect(acceptance).toContain("supabase.auth.setSession");
    expect(acceptance).toContain('new Error("No invitation session")');
    expect(acceptance).toContain('router.replace(intent === "invite" ? "/update-password?invite=1"');
  });

  it("requires password confirmation, then signs invited users out to sign in normally", () => {
    const action = source("src/actions/auth.ts");
    expect(action).toContain("password !== confirmPassword");
    expect(action).toContain("supabase.auth.signOut()");
    expect(action).toContain('redirect("/sign-in?setup=complete")');
  });
});

describe("auth callback redirects", () => {
  it("only permits known internal destinations", () => {
    expect(safeAuthRedirect("/update-password")).toBe("/update-password");
    expect(safeAuthRedirect("//evil.example")).toBe("/");
    expect(safeAuthRedirect("/manager")).toBe("/");
    expect(safeAuthRedirect(null)).toBe("/");
  });
});
