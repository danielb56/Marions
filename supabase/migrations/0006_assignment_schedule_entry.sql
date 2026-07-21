create type public.assignment_status as enum ('assigned','accepted','declined','reassigned','completed');

create table public.assignment (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  task_id bigint not null references public.task(id) on delete restrict,
  worker_id bigint not null references public.worker(id) on delete restrict,
  is_lead boolean not null default false,
  role text not null default 'primary',
  status public.assignment_status not null default 'assigned',
  assigned_by uuid not null references public.user_profile(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  reassigned_at timestamptz,
  reassigned_reason text
);
create index assignment_worker_status_idx on public.assignment (worker_id, status);
create index assignment_task_idx on public.assignment (task_id);
create unique index assignment_active_worker_unique on public.assignment (task_id, worker_id) where status <> 'reassigned';
create unique index assignment_one_lead_unique on public.assignment (task_id) where is_lead and status <> 'reassigned';

create table public.schedule_entry (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  task_id bigint references public.task(id) on delete cascade,
  work_order_id bigint references public.work_order(id) on delete cascade,
  worker_id bigint references public.worker(id) on delete set null,
  planned_date date not null,
  start_time time,
  estimated_hours numeric(5,2) check (estimated_hours is null or (estimated_hours > 0 and estimated_hours <= 24)),
  multi_day_sequence integer,
  created_by uuid not null references public.user_profile(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_one_target check ((task_id is not null)::integer + (work_order_id is not null)::integer = 1)
);
create index schedule_worker_date_idx on public.schedule_entry (worker_id, planned_date);
create index schedule_date_idx on public.schedule_entry (tenant_id, planned_date);
create index schedule_work_order_idx on public.schedule_entry (work_order_id);
create index schedule_task_idx on public.schedule_entry (task_id);
create trigger schedule_entry_set_updated_at before update on public.schedule_entry for each row execute function public.set_updated_at();

create or replace function public.worker_can_access_task(p_task_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignment a
    where a.task_id = p_task_id and a.worker_id = public.current_worker_id() and a.status <> 'reassigned'
  )
$$;

create or replace function public.worker_can_access_work_order(p_work_order_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignment a
    join public.task t on t.id = a.task_id
    where t.work_order_id = p_work_order_id and a.worker_id = public.current_worker_id() and a.status <> 'reassigned'
  )
$$;
revoke all on function public.worker_can_access_task(bigint) from public;
revoke all on function public.worker_can_access_work_order(bigint) from public;
grant execute on function public.worker_can_access_task(bigint) to authenticated;
grant execute on function public.worker_can_access_work_order(bigint) to authenticated;

alter table public.assignment enable row level security;
alter table public.schedule_entry enable row level security;
create policy assignment_manager_all on public.assignment for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy assignment_worker_select on public.assignment for select to authenticated
using (worker_id = public.current_worker_id() and status <> 'reassigned');
create policy schedule_manager_all on public.schedule_entry for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy schedule_worker_select on public.schedule_entry for select to authenticated
using (worker_id = public.current_worker_id() or (task_id is not null and public.worker_can_access_task(task_id)));

create policy work_order_worker_select on public.work_order for select to authenticated
using (tenant_id = public.current_tenant_id() and public.worker_can_access_work_order(id));
create policy task_worker_select on public.task for select to authenticated
using (tenant_id = public.current_tenant_id() and public.worker_can_access_task(id));
create policy trade_section_worker_select on public.trade_section for select to authenticated
using (tenant_id = public.current_tenant_id() and public.worker_can_access_work_order(work_order_id));
create policy trade_category_worker_select on public.trade_category for select to authenticated
using (tenant_id = public.current_tenant_id() and exists (
  select 1 from public.trade_section ts where ts.trade_category_id = trade_category.id and public.worker_can_access_work_order(ts.work_order_id)
));
create policy client_worker_select on public.client for select to authenticated
using (tenant_id = public.current_tenant_id() and exists (
  select 1 from public.work_order wo where wo.client_id = client.id and public.worker_can_access_work_order(wo.id)
));
create policy customer_worker_select on public.customer for select to authenticated
using (tenant_id = public.current_tenant_id() and exists (
  select 1 from public.work_order wo where wo.customer_id = customer.id and public.worker_can_access_work_order(wo.id)
));
create policy site_worker_select on public.site for select to authenticated
using (tenant_id = public.current_tenant_id() and exists (
  select 1 from public.work_order wo where wo.site_id = site.id and public.worker_can_access_work_order(wo.id)
));
create policy site_contact_worker_select on public.site_contact for select to authenticated
using (tenant_id = public.current_tenant_id() and exists (
  select 1 from public.work_order wo where wo.site_id = site_contact.site_id and public.worker_can_access_work_order(wo.id)
));

grant select, insert, update on public.assignment, public.schedule_entry to authenticated;
grant usage, select on all sequences in schema public to authenticated;
