create table public.task_status_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  task_id bigint not null references public.task(id) on delete restrict,
  from_status public.task_status,
  to_status public.task_status not null,
  reason text,
  actor_user_id uuid references public.user_profile(id) on delete set null,
  actor_role text not null check (actor_role in ('manager','worker','system')),
  worker_id bigint references public.worker(id) on delete set null,
  created_at timestamptz not null default now()
);
create index task_status_history_task_idx on public.task_status_history (task_id, created_at);

create table public.work_order_status_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  work_order_id bigint not null references public.work_order(id) on delete restrict,
  from_status public.work_order_status,
  to_status public.work_order_status not null,
  actor_user_id uuid references public.user_profile(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index work_order_status_history_idx on public.work_order_status_history (work_order_id, created_at);

create or replace function public.record_task_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from new.status then
    insert into public.task_status_history (tenant_id, task_id, from_status, to_status, actor_user_id, actor_role, worker_id)
    values (new.tenant_id, new.id, old.status, new.status, auth.uid(), coalesce(public.current_app_role()::text, 'system'), public.current_worker_id());
  end if;
  return new;
end $$;

create or replace function public.record_work_order_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from new.status then
    insert into public.work_order_status_history (tenant_id, work_order_id, from_status, to_status, actor_user_id)
    values (new.tenant_id, new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

create or replace function public.recompute_work_order_status(p_work_order_id bigint)
returns public.work_order_status language plpgsql security definer set search_path = '' as $$
declare next_status public.work_order_status;
begin
  select case
    when count(*) filter (where status <> 'cancelled') = 0 then 'cancelled'::public.work_order_status
    when bool_or(status = 'blocked') then 'blocked'::public.work_order_status
    when bool_or(status = 'changes_requested') then 'changes_requested'::public.work_order_status
    when bool_and(status in ('completed','cancelled')) then 'signed_off'::public.work_order_status
    when bool_or(status in ('in_progress','completion_submitted')) then 'in_progress'::public.work_order_status
    when bool_and(status in ('scheduled','completed','cancelled')) then 'scheduled'::public.work_order_status
    when bool_or(status in ('assigned','scheduled','completed')) then 'assigned'::public.work_order_status
    when bool_and(status in ('ready','cancelled')) then 'ready'::public.work_order_status
    else 'draft'::public.work_order_status end
  into next_status from public.task where work_order_id = p_work_order_id;
  update public.work_order set status = next_status where id = p_work_order_id and status <> 'cancelled';
  return next_status;
end $$;

create or replace function public.recompute_parent_after_task()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public.recompute_work_order_status(new.work_order_id); return new; end $$;

-- Status roll-up is an internal trigger/RPC helper, not a public API.
revoke all on function public.recompute_work_order_status(bigint) from public;

create trigger task_record_status after update of status on public.task for each row execute function public.record_task_status_change();
create trigger task_recompute_work_order after update of status on public.task for each row execute function public.recompute_parent_after_task();
create trigger work_order_record_status after update of status on public.work_order for each row execute function public.record_work_order_status_change();

alter table public.task_status_history enable row level security;
alter table public.work_order_status_history enable row level security;
create policy task_history_manager_select on public.task_status_history for select to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager());
create policy task_history_worker_select on public.task_status_history for select to authenticated
using (tenant_id = public.current_tenant_id() and public.worker_can_access_task(task_id));
create policy work_order_history_manager_select on public.work_order_status_history for select to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager());
create policy work_order_history_worker_select on public.work_order_status_history for select to authenticated
using (tenant_id = public.current_tenant_id() and public.worker_can_access_work_order(work_order_id));
grant select on public.task_status_history, public.work_order_status_history to authenticated;
grant usage, select on all sequences in schema public to authenticated;
