import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvConfig(process.cwd());
  const args = new Map(process.argv.slice(2).map((item, index, all) => item.startsWith("--") ? [item.slice(2), all[index + 1]] : ["", ""]));
  const email = args.get("email")?.toLowerCase();
  const password = process.env.MANAGER_PASSWORD;
  const displayName = args.get("name") ?? "Manager";
  const tenantName = args.get("tenant") ?? "REME Painting Group Pty Ltd";
  if (!email || !password || password.length < 12) {
    console.error("Set MANAGER_PASSWORD to at least 12 characters, then run: pnpm seed:manager --email manager@example.com --name 'Manager Name' --tenant 'Company Name'");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  let tenantId = args.get("tenantId");
  if (!tenantId) {
    const { data, error } = await admin.from("tenant").insert({ name: tenantName }).select("id").single();
    if (error) throw error;
    tenantId = data.id;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { tenant_id: tenantId, role: "manager", display_name: displayName } });
  if (error) throw error;
  console.info(`Created manager ${data.user.email} for tenant ${tenantId}. Sign in and complete authenticator enrolment before using manager features.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
