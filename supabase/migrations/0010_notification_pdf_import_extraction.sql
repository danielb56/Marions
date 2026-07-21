create type public.notification_channel as enum ('in_app','email','sms');
create type public.notification_status as enum ('queued','sent','delivered','failed');

create table public.notification (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  recipient_user_id uuid not null references public.user_profile(id) on delete restrict,
  channel public.notification_channel not null,
  subject text not null,
  body_redacted text not null,
  action_url text,
  status public.notification_status not null default 'queued',
  external_id text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);
create index notification_recipient_idx on public.notification (recipient_user_id, created_at desc);
create index notification_queue_idx on public.notification (status, created_at) where status in ('queued','failed');

create table public.pdf_import (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  source text not null check (source in ('upload','email_in')),
  sender_email text,
  original_attachment_id bigint not null references public.attachment(id) on delete restrict,
  client_id bigint references public.client(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','review','confirmed','failed','discarded')),
  created_by uuid not null references public.user_profile(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.user_profile(id) on delete set null
);

create table public.extraction_result (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  pdf_import_id bigint not null unique references public.pdf_import(id) on delete cascade,
  raw_text text,
  fields jsonb not null default '{}',
  line_items jsonb not null default '[]',
  overall_confidence numeric(5,4),
  parser_version text,
  created_at timestamptz not null default now()
);

create or replace function public.queue_notification(
  p_recipient_user_id uuid,
  p_channel public.notification_channel,
  p_subject text,
  p_body text,
  p_action_url text default null
) returns bigint language plpgsql security definer set search_path = '' as $$
declare profile_tenant uuid; result_id bigint;
begin
  select tenant_id into profile_tenant from public.user_profile where id = p_recipient_user_id and is_active = true;
  if profile_tenant is null then return null; end if;
  insert into public.notification (tenant_id, recipient_user_id, channel, subject, body_redacted, action_url)
  values (profile_tenant, p_recipient_user_id, p_channel, p_subject, p_body, p_action_url)
  returning id into result_id;
  return result_id;
end $$;

create or replace function public.notify_new_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient uuid; wo_number text; sms_allowed boolean;
begin
  if new.status = 'reassigned' then return new; end if;
  select w.user_id, wo.work_order_number, (w.sms_opt_in and tn.sms_enabled)
    into recipient, wo_number, sms_allowed
  from public.worker w
  join public.tenant tn on tn.id = w.tenant_id
  join public.task t on t.id = new.task_id
  join public.work_order wo on wo.id = t.work_order_id
  where w.id = new.worker_id;
  perform public.queue_notification(recipient, 'in_app', 'New work assigned', 'You have new work on order ' || wo_number || '.', '/worker/tasks/' || new.task_id);
  perform public.queue_notification(recipient, 'email', 'New work assigned', 'You have new work on order ' || wo_number || '. Sign in to view the details.', '/worker/tasks/' || new.task_id);
  if sms_allowed then
    perform public.queue_notification(recipient, 'sms', 'New work assigned', 'Marion: new work assigned on order ' || wo_number || '. Open the app for details.', '/worker/tasks/' || new.task_id);
  end if;
  return new;
end $$;

-- Notifications are queued by trusted triggers. Do not expose the definer
-- helper as an RPC that could be used to spam users across tenants.
revoke all on function public.queue_notification(uuid, public.notification_channel, text, text, text) from public;
create trigger assignment_queue_notification after insert on public.assignment for each row execute function public.notify_new_assignment();

alter table public.notification enable row level security;
alter table public.pdf_import enable row level security;
alter table public.extraction_result enable row level security;
create policy notification_manager_all on public.notification for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy notification_own_select on public.notification for select to authenticated
using (recipient_user_id = auth.uid());
create policy pdf_import_manager_all on public.pdf_import for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy extraction_manager_all on public.extraction_result for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());

grant select on public.notification to authenticated;
grant select, insert, update on public.pdf_import, public.extraction_result to authenticated;
grant usage, select on all sequences in schema public to authenticated;
comment on table public.extraction_result is 'V2 draft only. Manager RLS only; never query from worker surfaces.';
