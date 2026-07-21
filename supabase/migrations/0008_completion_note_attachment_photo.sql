create type public.submission_status as enum ('submitted','approved','rejected','changes_requested');
create type public.note_visibility as enum ('manager_only','worker_visible');
create type public.note_type as enum ('general','site_instruction','problem','internal');

create table public.completion_submission (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  task_id bigint not null references public.task(id) on delete restrict,
  assignment_id bigint not null references public.assignment(id) on delete restrict,
  worker_id bigint not null references public.worker(id) on delete restrict,
  notes text,
  cannot_complete boolean not null default false,
  problem_report text,
  completed_for_all_participants boolean not null default false,
  status public.submission_status not null default 'submitted',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.user_profile(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text
);
create index completion_task_idx on public.completion_submission (task_id, submitted_at);
create index completion_worker_idx on public.completion_submission (worker_id, submitted_at);
create index completion_status_idx on public.completion_submission (tenant_id, status, submitted_at);

create table public.note (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  parent_type text not null check (parent_type in ('work_order','task')),
  parent_id bigint not null,
  author_user_id uuid not null references public.user_profile(id) on delete restrict,
  body text not null check (length(trim(body)) between 1 and 10000),
  visibility public.note_visibility not null default 'worker_visible',
  note_type public.note_type not null default 'general',
  created_at timestamptz not null default now()
);
create index note_parent_idx on public.note (parent_type, parent_id, created_at);

create table public.attachment (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  owner_type text not null check (owner_type in ('work_order','completion_submission')),
  owner_id bigint not null,
  storage_key text not null unique,
  content_hash text,
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  visibility public.note_visibility not null default 'manager_only',
  uploaded_by uuid not null references public.user_profile(id) on delete restrict,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index attachment_owner_idx on public.attachment (owner_type, owner_id);
create index attachment_hash_idx on public.attachment (tenant_id, content_hash) where content_hash is not null;

create table public.completion_photo (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenant(id) on delete restrict,
  completion_submission_id bigint not null references public.completion_submission(id) on delete cascade,
  storage_key text not null unique,
  thumbnail_key text,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  taken_at timestamptz,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  uploaded_by uuid not null references public.user_profile(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index completion_photo_submission_idx on public.completion_photo (completion_submission_id);

alter table public.completion_submission enable row level security;
alter table public.note enable row level security;
alter table public.attachment enable row level security;
alter table public.completion_photo enable row level security;

create policy submission_manager_all on public.completion_submission for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy submission_worker_select on public.completion_submission for select to authenticated
using (worker_id = public.current_worker_id());
-- Worker submissions are created only through worker_submit_completion(), which
-- owns the status/reviewer fields. Workers cannot forge an approved submission.

create policy note_manager_all on public.note for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy note_worker_select on public.note for select to authenticated
using (tenant_id = public.current_tenant_id() and visibility = 'worker_visible' and (
  (parent_type = 'task' and public.worker_can_access_task(parent_id)) or
  (parent_type = 'work_order' and public.worker_can_access_work_order(parent_id))
));
create policy note_worker_insert on public.note for insert to authenticated
with check (
  tenant_id = public.current_tenant_id()
  and author_user_id = auth.uid()
  and visibility = 'worker_visible'
  and note_type <> 'internal'
  and parent_type = 'task'
  and public.worker_can_access_task(parent_id)
);

create policy attachment_manager_all on public.attachment for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy attachment_worker_select on public.attachment for select to authenticated
using (tenant_id = public.current_tenant_id() and visibility = 'worker_visible' and owner_type = 'completion_submission' and exists (
  select 1 from public.completion_submission cs where cs.id = attachment.owner_id and cs.worker_id = public.current_worker_id()
));

create policy photo_manager_all on public.completion_photo for all to authenticated
using (tenant_id = public.current_tenant_id() and public.is_manager())
with check (tenant_id = public.current_tenant_id() and public.is_manager());
create policy photo_worker_select on public.completion_photo for select to authenticated
using (exists (select 1 from public.completion_submission cs where cs.id = completion_submission_id and cs.worker_id = public.current_worker_id()));
create policy photo_worker_insert on public.completion_photo for insert to authenticated
with check (tenant_id = public.current_tenant_id() and uploaded_by = auth.uid() and exists (
  select 1 from public.completion_submission cs where cs.id = completion_submission_id and cs.worker_id = public.current_worker_id()
));

grant select on public.completion_submission, public.note, public.attachment, public.completion_photo to authenticated;
grant insert on public.note, public.completion_photo to authenticated;
grant usage, select on all sequences in schema public to authenticated;
