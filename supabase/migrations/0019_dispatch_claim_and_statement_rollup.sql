-- Three hardening changes.
--
-- 1. Notification dispatch now claims rows before sending, so two overlapping
--    cron runs can no longer both deliver the same queued message.
-- 2. The work-order status roll-up becomes a statement-level trigger, so a bulk
--    task update recomputes once per work order instead of once per row.
-- 3. assign_whole_order works set-based instead of row-by-row, which together
--    with (2) turns an O(n^2) whole-order assign into a constant number of
--    recomputes.

-- ---------------------------------------------------------------------------
-- 1. Notification claim / lease
-- ---------------------------------------------------------------------------

alter table public.notification add column if not exists claimed_at timestamptz;

drop index if exists public.notification_queue_idx;
create index notification_queue_idx on public.notification (status, claimed_at, created_at)
  where status in ('queued', 'failed');

-- Claim up to p_limit dispatchable notifications and return them.
--
-- "for update skip locked" plus the claimed_at stamp make this safe to call
-- concurrently: a second caller skips the rows the first has locked, and a
-- claimed row stays invisible until its lease expires. That expiry is also the
-- recovery path — if a dispatcher dies mid-flight its rows become claimable
-- again after p_lease_seconds rather than being stranded.
--
-- A row left in 'failed' keeps its claimed_at, so the lease doubles as retry
-- backoff: a permanently failing message is reattempted once per lease window
-- instead of on every run.
create or replace function public.claim_notifications(
  p_limit integer default 50,
  p_lease_seconds integer default 600
)
returns table (
  id bigint,
  channel public.notification_channel,
  subject text,
  body_redacted text,
  attempts integer,
  recipient_email text,
  recipient_phone text
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with claimable as (
    select n.id
    from public.notification n
    where n.status in ('queued', 'failed')
      and n.attempts < 5
      and (
        n.claimed_at is null
        or n.claimed_at < now() - make_interval(secs => p_lease_seconds)
      )
    order by n.created_at
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.notification n
    set claimed_at = now()
    where n.id in (select c.id from claimable c)
    returning n.id, n.channel, n.subject, n.body_redacted, n.attempts, n.recipient_user_id
  )
  select c.id, c.channel, c.subject, c.body_redacted, c.attempts, up.email, up.phone
  from claimed c
  join public.user_profile up on up.id = c.recipient_user_id
  order by c.id;
end $$;

-- Dispatch is a backend-only operation; never expose it to end users.
revoke all on function public.claim_notifications(integer, integer) from public;
grant execute on function public.claim_notifications(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Statement-level status roll-up
-- ---------------------------------------------------------------------------

-- The row-level version meant a 200-task work order recomputed its parent 200
-- times, and each pass scanned every task in the order. A statement-level
-- trigger with transition tables collapses that to one recompute per affected
-- work order per statement.
--
-- Note the trigger can no longer be declared "of status": PostgreSQL rejects a
-- column list on a trigger that uses transition tables. The status filter moves
-- into the body instead, comparing the old and new transition tables, which also
-- makes it cheaper than before on updates that touch other columns.
create or replace function public.recompute_parent_after_task_statement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare order_key bigint;
begin
  for order_key in
    select distinct changed.work_order_id
    from changed_task changed
    join previous_task previous on previous.id = changed.id
    where changed.status is distinct from previous.status
  loop
    perform public.recompute_work_order_status(order_key);
  end loop;
  return null;
end $$;

drop trigger if exists task_recompute_work_order on public.task;
create trigger task_recompute_work_order
  after update on public.task
  referencing old table as previous_task new table as changed_task
  for each statement
  execute function public.recompute_parent_after_task_statement();

drop function if exists public.recompute_parent_after_task();

-- ---------------------------------------------------------------------------
-- 3. Set-based whole-order assignment
-- ---------------------------------------------------------------------------

create or replace function public.assign_whole_order(
  p_work_order_id bigint,
  p_worker_id bigint,
  p_preserve_existing boolean default false
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  actor_key uuid := auth.uid();
  target_ids bigint[];
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if not exists (
    select 1 from public.worker w
    join public.user_profile up on up.id = w.user_id
    where w.id = p_worker_id and w.tenant_id = tenant_key and up.is_active
  ) then
    raise exception 'Worker is unavailable';
  end if;

  -- Resolve the target set once. When p_preserve_existing is set, tasks that
  -- already carry a live assignment are excluded here rather than skipped
  -- mid-loop, which keeps the returned count identical to the previous version.
  select coalesce(array_agg(t.id order by t.id), '{}'::bigint[])
  into target_ids
  from public.task t
  where t.work_order_id = p_work_order_id
    and t.tenant_id = tenant_key
    and t.status <> 'cancelled'
    and (
      not p_preserve_existing
      or not exists (
        select 1 from public.assignment a
        where a.task_id = t.id and a.status <> 'reassigned'
      )
    );

  if array_length(target_ids, 1) is null then
    update public.work_order set lead_worker_id = p_worker_id
      where id = p_work_order_id and tenant_id = tenant_key;
    perform public.recompute_work_order_status(p_work_order_id);
    return 0;
  end if;

  update public.assignment
  set status = 'reassigned',
      is_lead = false,
      reassigned_at = now(),
      reassigned_reason = 'Whole order reassigned'
  where task_id = any(target_ids) and status <> 'reassigned';

  insert into public.assignment (tenant_id, task_id, worker_id, is_lead, assigned_by)
  select tenant_key, t.id, p_worker_id, true, actor_key
  from unnest(target_ids) as t(id);

  update public.task set status = 'assigned'
  where id = any(target_ids) and status in ('draft', 'ready', 'assigned', 'scheduled');

  update public.work_order set lead_worker_id = p_worker_id
    where id = p_work_order_id and tenant_id = tenant_key;

  -- Kept because the task update above matches nothing when every target is
  -- already past 'scheduled', in which case no trigger would fire.
  perform public.recompute_work_order_status(p_work_order_id);
  return array_length(target_ids, 1);
end $$;

-- Same treatment for the schedule loop: one insert statement instead of one per
-- date. Array order drives multi_day_sequence exactly as the loop counter did.
create or replace function public.schedule_task(
  p_task_id bigint,
  p_worker_id bigint,
  p_dates date[],
  p_start_time time default null,
  p_estimated_hours numeric default null
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  actor_key uuid := auth.uid();
  order_key bigint;
  has_lead boolean;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  select work_order_id into order_key from public.task
    where id = p_task_id and tenant_id = tenant_key;
  if order_key is null then raise exception 'Task not found'; end if;
  if array_length(p_dates, 1) is null then raise exception 'Choose at least one schedule date'; end if;
  if not exists (
    select 1 from public.worker w
    join public.user_profile up on up.id = w.user_id
    where w.id = p_worker_id and w.tenant_id = tenant_key and up.is_active
  ) then raise exception 'Worker is unavailable'; end if;

  if not exists (
    select 1 from public.assignment
    where task_id = p_task_id and worker_id = p_worker_id and status <> 'reassigned'
  ) then
    select exists (
      select 1 from public.assignment
      where task_id = p_task_id and is_lead and status <> 'reassigned'
    ) into has_lead;
    insert into public.assignment (tenant_id, task_id, worker_id, is_lead, assigned_by)
    values (tenant_key, p_task_id, p_worker_id, not has_lead, actor_key);
  end if;

  insert into public.schedule_entry (
    tenant_id, task_id, worker_id, planned_date, start_time, estimated_hours,
    multi_day_sequence, created_by
  )
  select tenant_key, p_task_id, p_worker_id, d.planned_date, p_start_time, p_estimated_hours,
         d.seq, actor_key
  from unnest(p_dates) with ordinality as d(planned_date, seq);

  update public.task set status = 'scheduled'
    where id = p_task_id and status in ('ready', 'assigned', 'scheduled');
  perform public.recompute_work_order_status(order_key);
  return array_length(p_dates, 1);
end $$;
