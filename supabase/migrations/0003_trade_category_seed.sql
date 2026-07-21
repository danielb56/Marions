create table public.trade_category (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  name text not null,
  is_system boolean not null default false,
  default_unit text not null default 'ea' check (default_unit in ('ea','m2','lm','m3','hr')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index trade_category_tenant_name_unique on public.trade_category (tenant_id, lower(name));

create or replace function public.seed_trade_categories(p_tenant_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.trade_category (tenant_id, name, is_system, default_unit, sort_order)
  values
    (p_tenant_id, 'Carpentry', true, 'lm', 10),
    (p_tenant_id, 'Cleaning', true, 'hr', 20),
    (p_tenant_id, 'Insulation', true, 'm2', 30),
    (p_tenant_id, 'Painting', true, 'm2', 40),
    (p_tenant_id, 'Plastering', true, 'm2', 50),
    (p_tenant_id, 'Preliminaries', true, 'ea', 60),
    (p_tenant_id, 'Waste Removal', true, 'm3', 70),
    (p_tenant_id, 'Miscellaneous', true, 'ea', 80)
  on conflict do nothing;
$$;

create or replace function public.seed_tenant_trade_categories()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.seed_trade_categories(new.id);
  return new;
end $$;

-- This helper runs only from the tenant trigger. Leaving a SECURITY DEFINER
-- function executable by PUBLIC would let an API caller seed another tenant.
revoke all on function public.seed_trade_categories(uuid) from public;

create trigger tenant_seed_trade_categories
after insert on public.tenant for each row execute function public.seed_tenant_trade_categories();

do $$ declare tenant_row record; begin
  for tenant_row in select id from public.tenant loop
    perform public.seed_trade_categories(tenant_row.id);
  end loop;
end $$;

alter table public.trade_category enable row level security;
create policy trade_manager_all on public.trade_category for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
grant select, insert, update on public.trade_category to authenticated;
grant usage, select on all sequences in schema public to authenticated;
