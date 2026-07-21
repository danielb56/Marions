create table public.audit_event (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  actor_user_id uuid references public.user_profile(id) on delete set null,
  actor_role text not null check (actor_role in ('manager','worker','system')),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  affected_worker_ids bigint[] not null default '{}',
  notified boolean not null default false,
  created_at timestamptz not null default now()
);
create index audit_tenant_created_idx on public.audit_event (tenant_id, created_at desc);
create index audit_entity_idx on public.audit_event (entity_type, entity_id, created_at desc);
create index audit_actor_idx on public.audit_event (actor_user_id, created_at desc);

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  source jsonb;
  entity_key text;
  tenant_key uuid;
  worker_ids bigint[] := '{}';
begin
  source := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_key := coalesce(source ->> 'id', source ->> 'task_id', source ->> 'work_order_id', 'unknown');
  tenant_key := (source ->> 'tenant_id')::uuid;

  if tg_table_name = 'task' then
    select coalesce(array_agg(distinct worker_id), '{}') into worker_ids
    from public.assignment where task_id = entity_key::bigint and status <> 'reassigned';
  elsif tg_table_name = 'work_order' then
    select coalesce(array_agg(distinct a.worker_id), '{}') into worker_ids
    from public.assignment a join public.task t on t.id = a.task_id
    where t.work_order_id = entity_key::bigint and a.status <> 'reassigned';
  elsif source ? 'worker_id' then
    worker_ids := array[(source ->> 'worker_id')::bigint];
  end if;

  insert into public.audit_event (
    tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, before, after, affected_worker_ids
  ) values (
    tenant_key,
    auth.uid(),
    coalesce(public.current_app_role()::text, 'system'),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    entity_key,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    worker_ids
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger audit_work_order after insert or update or delete on public.work_order for each row execute function public.audit_row_change();
create trigger audit_task after insert or update or delete on public.task for each row execute function public.audit_row_change();
create trigger audit_assignment after insert or update or delete on public.assignment for each row execute function public.audit_row_change();
create trigger audit_schedule after insert or update or delete on public.schedule_entry for each row execute function public.audit_row_change();
create trigger audit_totals after insert or update or delete on public.work_order_totals for each row execute function public.audit_row_change();
create trigger audit_task_pricing after insert or update or delete on public.task_pricing for each row execute function public.audit_row_change();
create trigger audit_submission after insert or update or delete on public.completion_submission for each row execute function public.audit_row_change();
create trigger audit_profile after update on public.user_profile for each row execute function public.audit_row_change();

create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Audit events are append-only';
  return null;
end $$;
create trigger audit_event_append_only before update or delete on public.audit_event for each row execute function public.prevent_audit_mutation();

alter table public.audit_event enable row level security;
create policy audit_manager_select on public.audit_event for select to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager());
grant select on public.audit_event to authenticated;
grant usage, select on all sequences in schema public to authenticated;

comment on table public.audit_event is 'Append-only manager audit. before/after can contain pricing and are never exposed to workers.';
