create type public.work_order_status as enum ('draft','ready','assigned','scheduled','in_progress','changes_requested','blocked','completed','signed_off','cancelled');
create type public.task_status as enum ('draft','ready','assigned','scheduled','in_progress','completion_submitted','changes_requested','blocked','completed','cancelled');

create table public.work_order (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  client_id bigint not null references public.client(id) on delete restrict,
  customer_id bigint references public.customer(id) on delete set null,
  site_id bigint not null references public.site(id) on delete restrict,
  lead_worker_id bigint references public.worker(id) on delete set null,
  work_order_number text not null,
  job_number text,
  client_reference text,
  client_supervisor_name text,
  client_supervisor_phone text,
  issued_at timestamptz,
  start_date date,
  completion_due_date date,
  status public.work_order_status not null default 'draft',
  notes text,
  additional_instructions text,
  duplicate_reason text,
  created_by uuid not null references public.user_profile(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_reason text
);
create index work_order_tenant_status_idx on public.work_order (tenant_id, status);
create index work_order_tenant_reference_idx on public.work_order (tenant_id, client_reference);
create index work_order_tenant_number_idx on public.work_order (tenant_id, work_order_number);
create index work_order_tenant_start_idx on public.work_order (tenant_id, start_date);
create unique index work_order_reference_unique on public.work_order (tenant_id, client_reference)
  where client_reference is not null and client_reference <> '' and duplicate_reason is null;
create unique index work_order_number_unique on public.work_order (tenant_id, work_order_number)
  where duplicate_reason is null;

create table public.trade_section (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  work_order_id bigint not null references public.work_order(id) on delete cascade,
  trade_category_id bigint not null references public.trade_category(id) on delete restrict,
  area_label text,
  sort_order integer not null default 0
);
create index trade_section_work_order_idx on public.trade_section (work_order_id, sort_order);

create table public.task (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  work_order_id bigint not null references public.work_order(id) on delete cascade,
  trade_section_id bigint not null references public.trade_section(id) on delete cascade,
  description text not null check (length(trim(description)) between 2 and 1000),
  quantity numeric(12,3) not null check (quantity > 0),
  unit text not null check (unit in ('ea','m2','lm','m3','hr')),
  area_label text,
  sort_order integer not null default 0,
  status public.task_status not null default 'ready',
  started_at timestamptz,
  completed_at timestamptz,
  revised_since_viewed boolean not null default false,
  supersedes_task_id bigint references public.task(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_work_order_idx on public.task (work_order_id, sort_order);
create index task_trade_section_idx on public.task (trade_section_id);
create index task_status_idx on public.task (tenant_id, status);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger work_order_set_updated_at before update on public.work_order for each row execute function public.set_updated_at();
create trigger task_set_updated_at before update on public.task for each row execute function public.set_updated_at();

alter table public.work_order enable row level security;
alter table public.trade_section enable row level security;
alter table public.task enable row level security;

create policy work_order_manager_all on public.work_order for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy trade_section_manager_all on public.trade_section for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy task_manager_all on public.task for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());

grant select, insert, update on public.work_order, public.trade_section, public.task to authenticated;
grant usage, select on all sequences in schema public to authenticated;
