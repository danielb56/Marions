create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('manager', 'worker');

create table public.tenant (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 200),
  abn text,
  default_timezone text not null default 'Australia/Sydney',
  default_gst_rate numeric(5,4) not null default 0.1000 check (default_gst_rate between 0 and 1),
  retention_years integer not null default 7 check (retention_years between 1 and 20),
  mfa_required_for_managers boolean not null default true,
  sms_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.user_profile (
  id uuid primary key references auth.users(id) on delete restrict,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  role public.app_role not null,
  display_name text not null check (length(trim(display_name)) between 2 and 200),
  email text not null,
  phone text,
  is_active boolean not null default true,
  worker_id bigint,
  mfa_enrolled boolean not null default false,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text
);

create unique index user_profile_email_unique on public.user_profile (lower(email));
create index user_profile_tenant_role_idx on public.user_profile (tenant_id, role);

create table public.worker (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  user_id uuid not null unique references public.user_profile(id) on delete restrict,
  trade_specialties text[] not null default '{}',
  default_daily_capacity numeric(5,2) not null default 8 check (default_daily_capacity > 0 and default_daily_capacity <= 24),
  vehicle_notes text,
  sms_opt_in boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.user_profile
  add constraint user_profile_worker_id_fkey foreign key (worker_id) references public.worker(id) on delete restrict;
create unique index user_profile_worker_unique on public.user_profile (worker_id) where worker_id is not null;
create index worker_tenant_idx on public.worker (tenant_id);

create or replace function public.current_tenant_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select tenant_id from public.user_profile where id = auth.uid() and is_active = true $$;

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = ''
as $$ select role from public.user_profile where id = auth.uid() and is_active = true $$;

create or replace function public.current_worker_id()
returns bigint language sql stable security definer set search_path = ''
as $$ select worker_id from public.user_profile where id = auth.uid() and is_active = true $$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_app_role() = 'manager'::public.app_role, false) $$;

revoke all on function public.current_tenant_id() from public;
revoke all on function public.current_app_role() from public;
revoke all on function public.current_worker_id() from public;
revoke all on function public.is_manager() from public;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.current_worker_id() to authenticated;
grant execute on function public.is_manager() to authenticated;

create or replace function public.prevent_profile_privilege_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.role() <> 'service_role' and (new.tenant_id <> old.tenant_id or new.role <> old.role or new.id <> old.id) then
    raise exception 'Profile identity, tenant and role are immutable';
  end if;
  return new;
end $$;

create trigger user_profile_prevent_privilege_change
before update on public.user_profile for each row execute function public.prevent_profile_privilege_change();

create or replace function public.create_worker_for_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare new_worker_id bigint;
begin
  if new.role = 'worker' and new.worker_id is null then
    insert into public.worker (tenant_id, user_id) values (new.tenant_id, new.id) returning id into new_worker_id;
    update public.user_profile set worker_id = new_worker_id where id = new.id;
  end if;
  return new;
end $$;

create trigger user_profile_create_worker
after insert on public.user_profile for each row execute function public.create_worker_for_profile();

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data ? 'tenant_id' and new.raw_user_meta_data ? 'role' then
    insert into public.user_profile (id, tenant_id, role, display_name, email, phone)
    values (
      new.id,
      (new.raw_user_meta_data ->> 'tenant_id')::uuid,
      (new.raw_user_meta_data ->> 'role')::public.app_role,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
      new.email,
      nullif(new.raw_user_meta_data ->> 'phone', '')
    ) on conflict (id) do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_auth_user();

alter table public.tenant enable row level security;
alter table public.user_profile enable row level security;
alter table public.worker enable row level security;

create policy tenant_manager_select on public.tenant for select to authenticated
using (id = public.current_tenant_id() and public.is_manager());
create policy tenant_manager_update on public.tenant for update to authenticated
using (id = public.current_tenant_id() and public.is_manager())
with check (id = public.current_tenant_id() and public.is_manager());

create policy profile_self_or_manager_select on public.user_profile for select to authenticated
using (id = auth.uid() or (tenant_id = public.current_tenant_id() and public.is_manager()));
create policy profile_manager_update on public.user_profile for update to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());

create policy worker_manager_all on public.worker for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy worker_self_select on public.worker for select to authenticated
using (id = public.current_worker_id());

grant select, update on public.tenant to authenticated;
grant select, update on public.user_profile to authenticated;
grant select, insert, update on public.worker to authenticated;
grant usage, select on all sequences in schema public to authenticated;

comment on table public.user_profile is 'Application identity and role. No public sign-up; users are invited by a manager.';
