create table public.work_order_totals (
  work_order_id bigint primary key references public.work_order(id) on delete cascade,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  gst_rate numeric(5,4) not null default 0.1000 check (gst_rate between 0 and 1),
  gst_cents bigint not null default 0 check (gst_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  total_override boolean not null default true,
  updated_by uuid not null references public.user_profile(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint work_order_totals_sum check (total_override or total_cents = subtotal_cents + gst_cents)
);
create index work_order_totals_tenant_idx on public.work_order_totals (tenant_id);

create table public.task_pricing (
  task_id bigint primary key references public.task(id) on delete cascade,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  unit_rate_cents bigint check (unit_rate_cents is null or unit_rate_cents >= 0),
  line_total_cents bigint check (line_total_cents is null or line_total_cents >= 0),
  is_estimate boolean not null default true,
  updated_by uuid not null references public.user_profile(id) on delete restrict,
  updated_at timestamptz not null default now()
);
create index task_pricing_tenant_idx on public.task_pricing (tenant_id);

create trigger work_order_totals_set_updated_at before update on public.work_order_totals for each row execute function public.set_updated_at();
create trigger task_pricing_set_updated_at before update on public.task_pricing for each row execute function public.set_updated_at();

alter table public.work_order_totals enable row level security;
alter table public.task_pricing enable row level security;

create policy totals_manager_select on public.work_order_totals for select to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager());
create policy totals_manager_insert on public.work_order_totals for insert to authenticated
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy totals_manager_update on public.work_order_totals for update to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());

create policy task_pricing_manager_select on public.task_pricing for select to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager());
create policy task_pricing_manager_insert on public.task_pricing for insert to authenticated
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy task_pricing_manager_update on public.task_pricing for update to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());

grant select, insert, update on public.work_order_totals, public.task_pricing to authenticated;
comment on table public.work_order_totals is 'Financial data. RLS grants manager access only; worker policies must never be added.';
comment on table public.task_pricing is 'Optional per-task financial data. RLS grants manager access only.';
