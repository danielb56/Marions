import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { hasSupabaseConfig } from "@/lib/env";
import type { AppRole, UserProfile } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";

export const getCurrentProfile = cache(async (): Promise<UserProfile | null> => {
  if (!hasSupabaseConfig()) return null;
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return null;
  const { data } = await supabase
    .from("user_profile")
    .select("id, tenant_id, role, worker_id, display_name, email, phone, is_active, mfa_enrolled")
    .eq("id", userId)
    .single();
  if (!data?.is_active) return null;
  return data as UserProfile;
});

export async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/sign-in");
  return profile;
}

export async function requireRole(role: AppRole, options: { skipMfa?: boolean } = {}) {
  const profile = await requireProfile();
  if (profile.role !== role) redirect(profile.role === "manager" ? "/manager" : "/worker");
  if (role === "manager" && !options.skipMfa) {
    const supabase = await createClient();
    const { data: tenant } = await supabase.from("tenant").select("mfa_required_for_managers").eq("id", profile.tenant_id).single();
    if (tenant?.mfa_required_for_managers && !profile.mfa_enrolled) redirect("/security/mfa-enrol");
    if (profile.mfa_enrolled) {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!data || data.currentLevel !== "aal2") redirect("/mfa");
    }
  }
  return profile;
}

export async function assertRole(role: AppRole) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== role) throw new Error("Forbidden");
  if (role === "manager") {
    const supabase = await createClient();
    const { data: tenant } = await supabase.from("tenant").select("mfa_required_for_managers").eq("id", profile.tenant_id).single();
    if (tenant?.mfa_required_for_managers) {
      if (!profile.mfa_enrolled) throw new Error("Manager MFA enrollment required");
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!data || data.currentLevel !== "aal2") throw new Error("Manager MFA verification required");
    }
  }
  return profile;
}
