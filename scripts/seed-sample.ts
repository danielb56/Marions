import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvConfig(process.cwd());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Configure Supabase in .env.local");
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: manager } = await admin.from("user_profile").select("id,tenant_id").eq("role", "manager").eq("is_active", true).limit(1).single();
  if (!manager) throw new Error("Create the first manager before seeding sample data");
  const tenantId = manager.tenant_id;
  let { data: client } = await admin.from("client").select("id").eq("tenant_id", tenantId).ilike("name", "Bentino Pty Ltd").limit(1).maybeSingle();
  if (!client) {
    const inserted = await admin.from("client").insert({ tenant_id: tenantId, name: "Bentino Pty Ltd" }).select("id").single();
    client = inserted.data;
  }
  const { data: customer } = await admin.from("customer").insert({ tenant_id: tenantId, name: "Francesco Amato", phone: "0409735370" }).select("id").single();
  const { data: site } = await admin.from("site").insert({ tenant_id: tenantId, street_address: "4 Irwan St", suburb: "Saratoga", state: "NSW", postcode: "2251" }).select("id").single();
  if (!client || !site) throw new Error("Could not seed client or site");
  await admin.from("site_contact").insert({ tenant_id: tenantId, site_id: site.id, name: "Francesco Amato", phone: "0409735370", relationship: "customer" });
  const { data: order, error: orderError } = await admin.from("work_order").insert({ tenant_id: tenantId, client_id: client.id, customer_id: customer?.id, site_id: site.id, work_order_number: "20299-29572", job_number: "20299", client_reference: "12201037101", client_supervisor_name: "Astafanos Kheir", status: "ready", additional_instructions: "Confirm access with the site contact before arrival. Protect finished surfaces and leave the site clean.", created_by: manager.id }).select("id").single();
  if (orderError || !order) throw orderError;
  const { data: trades } = await admin.from("trade_category").select("id,name").eq("tenant_id", tenantId);
  const tasks = [
    ["Carpentry","Lounge","Remove & Replace Skirting - Pine (standard size)",3,"lm"],
    ["Cleaning","General Works","Builders Clean - Labour Rate",3,"ea"],
    ["Insulation","Lounge","Remove & Replace Ceiling Insulation - Glasswool R4.0 Batts",1,"m2"],
    ["Painting","Lounge","Prepare and paint walls",45,"m2"],
    ["Plastering","Lounge","Patch and set damaged plasterboard",6,"m2"],
    ["Preliminaries","General Works","Site protection and setup",1,"ea"],
    ["Waste Removal","General Works","Waste Disposal - General",2,"ea"],
  ] as const;
  let position = 0;
  for (const [tradeName, area, description, quantity, unit] of tasks) {
    position += 1; const trade = trades?.find((item) => item.name === tradeName); if (!trade) continue;
    const { data: section } = await admin.from("trade_section").insert({ tenant_id: tenantId, work_order_id: order.id, trade_category_id: trade.id, area_label: area, sort_order: position }).select("id").single();
    if (section) await admin.from("task").insert({ tenant_id: tenantId, work_order_id: order.id, trade_section_id: section.id, description, quantity, unit, area_label: area, sort_order: position, status: "ready" });
  }
  await admin.from("work_order_totals").insert({ work_order_id: order.id, tenant_id: tenantId, subtotal_cents: 200000, gst_rate: .1, gst_cents: 20000, total_cents: 220000, total_override: true, updated_by: manager.id });
  console.info(`Seeded sample work order ${order.id} (20299-29572).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
