create table public.client (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 200),
  abn text,
  licence_numbers text,
  billing_address text,
  account_manager_name text,
  account_manager_email text,
  account_manager_phone text,
  default_trade_categories text[] not null default '{}',
  created_at timestamptz not null default now()
);
create unique index client_tenant_name_unique on public.client (tenant_id, lower(name));

create table public.customer (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 200),
  phone text,
  email text,
  created_at timestamptz not null default now()
);
create index customer_tenant_phone_idx on public.customer (tenant_id, phone);

create table public.site (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  street_address text not null,
  suburb text not null,
  state text not null default 'NSW',
  postcode text not null check (postcode ~ '^\d{4}$'),
  latitude numeric(10,7),
  longitude numeric(10,7),
  access_notes text,
  created_at timestamptz not null default now()
);
create index site_tenant_address_idx on public.site (tenant_id, lower(street_address), postcode);

create table public.site_contact (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  site_id bigint not null references public.site(id) on delete cascade,
  name text not null,
  phone text,
  relationship text,
  notes text,
  created_at timestamptz not null default now()
);
create index site_contact_site_idx on public.site_contact (site_id);

alter table public.client enable row level security;
alter table public.customer enable row level security;
alter table public.site enable row level security;
alter table public.site_contact enable row level security;

create policy client_manager_all on public.client for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy customer_manager_all on public.customer for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy site_manager_all on public.site for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy site_contact_manager_all on public.site_contact for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());

grant select, insert, update on public.client, public.customer, public.site, public.site_contact to authenticated;
grant usage, select on all sequences in schema public to authenticated;
