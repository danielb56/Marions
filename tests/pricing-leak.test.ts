import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
function files(dir: string): string[] { return readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path]; }); }

describe("pricing isolation gate", () => {
  it("has only manager policies on both financial tables", () => {
    const sql = read("supabase/migrations/0005_task_pricing_work_order_totals.sql");
    expect(sql).toContain("alter table public.work_order_totals enable row level security");
    expect(sql).toContain("alter table public.task_pricing enable row level security");
    expect(sql).not.toMatch(/create policy\s+\S*worker\S*\s+on public\.(?:work_order_totals|task_pricing)/i);
    expect((sql.match(/public\.is_manager\(\)/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("keeps financial tables out of worker-safe views", () => {
    const sql = read("supabase/migrations/0011_rls_pricing_leak_views.sql");
    const views = sql.match(/create view public\.worker_[\s\S]*?comment on view public\.worker_job_safe[\s\S]*?;/i)?.[0] ?? "";
    expect(views).not.toMatch(/task_pricing|work_order_totals|unit_rate_cents|line_total_cents|subtotal_cents|gst_cents|total_cents/i);
  });

  it("does not reference financial fields from any worker page", () => {
    const source = files(join(root, "src/app/worker")).filter((path) => /\.(ts|tsx)$/.test(path)).map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toMatch(/unit_rate_cents|line_total_cents|subtotal_cents|gst_cents|total_cents|task_pricing|work_order_totals/);
  });

  it("requires manager role before issuing an original-document URL", () => {
    expect(read("src/app/api/attachments/[id]/route.ts")).toContain('assertRole("manager")');
  });

  it("never caches manager or API responses in the service worker", () => {
    const serviceWorker = read("public/sw.js");
    expect(serviceWorker).toContain('url.pathname.startsWith("/worker")');
    expect(serviceWorker).not.toContain('url.pathname.startsWith("/manager")');
    expect(serviceWorker).not.toContain('url.pathname.startsWith("/api")');
  });
});
