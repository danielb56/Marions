-- Whole-order assignment becomes set-based, its notifications are batched, and
-- cancelling a work order now actually withdraws the work from its workers.
--
-- 1. Assignment notifications group per worker per work order instead of firing
--    once per assignment row. A 200-task order sent 400-600 messages to one
--    worker; it now sends two or three.
-- 2. assign_and_schedule_whole_order is set-based. It previously looped task by
--    task issuing single-row updates, so the status roll-up ran once per task and
--    each pass rescanned the whole order.
-- 3. assign_whole_order is dropped. It has been unreachable since 0015 replaced
--    it with assign_and_schedule_whole_order.
-- 4. cancel_work_order cascades to tasks, clears upcoming schedule entries and
--    notifies affected workers. Cancelling only set work_order.status, leaving
--    every task 'assigned' or 'scheduled' and fully actionable on workers'
--    phones.
-- 5. The worker-facing views exclude cancelled orders, and completion submission
--    now checks task status.

-- ---------------------------------------------------------------------------
-- 1. Batched assignment notifications
-- ---------------------------------------------------------------------------

create or replace function public.notify_new_assignments()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  notice record;
  target_url text;
  in_app_body text;
  email_body text;
  sms_body text;
begin
  for notice in
    select
      w.user_id as recipient_user_id,
      wo.id as work_order_id,
      wo.work_order_number,
      (w.sms_opt_in and tn.sms_enabled) as sms_allowed,
      count(*) as task_count,
      min(inserted.task_id) as first_task_id
    from inserted_assignment inserted
    join public.worker w on w.id = inserted.worker_id
    join public.tenant tn on tn.id = w.tenant_id
    join public.task t on t.id = inserted.task_id
    join public.work_order wo on wo.id = t.work_order_id
    where inserted.status <> 'reassigned'
    group by w.user_id, wo.id, wo.work_order_number, w.sms_opt_in, tn.sms_enabled
  loop
    if notice.task_count = 1 then
      target_url := '/worker/tasks/' || notice.first_task_id;
      in_app_body := 'You have new work on order ' || notice.work_order_number || '.';
      email_body := 'You have new work on order ' || notice.work_order_number
        || '. Sign in to view the details.';
      sms_body := 'new work assigned on order ' || notice.work_order_number
        || '. Open the app for details.';
    else
      -- A whole-order assign lands as one insert, so link to the job rather than
      -- to an arbitrary one of its tasks.
      target_url := '/worker/jobs/' || notice.work_order_id;
      in_app_body := 'You have ' || notice.task_count || ' new tasks on order '
        || notice.work_order_number || '.';
      email_body := 'You have ' || notice.task_count || ' new tasks on order '
        || notice.work_order_number || '. Sign in to view the details.';
      sms_body := notice.task_count || ' new tasks assigned on order '
        || notice.work_order_number || '. Open the app for details.';
    end if;

    perform public.queue_notification(
      notice.recipient_user_id, 'in_app', 'New work assigned', in_app_body, target_url
    );
    perform public.queue_notification(
      notice.recipient_user_id, 'email', 'New work assigned', email_body, target_url
    );
    if notice.sms_allowed then
      perform public.queue_notification(
        notice.recipient_user_id, 'sms', 'New work assigned', sms_body, target_url
      );
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists assignment_queue_notification on public.assignment;
create trigger assignment_queue_notification
  after insert on public.assignment
  referencing new table as inserted_assignment
  for each statement
  execute function public.notify_new_assignments();

drop function if exists public.notify_new_assignment();

-- ---------------------------------------------------------------------------
-- 2. Set-based whole-order assign and auto-schedule
-- ---------------------------------------------------------------------------

create or replace function public.assign_and_schedule_whole_order(
  p_work_order_id bigint,
  p_worker_id bigint,
  p_dates date[],
  p_preserve_existing boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  actor_key uuid := auth.uid();
  selected_dates date[];
  target_ids bigint[];
  task_count integer := 0;
  date_count integer := 0;
  base_per_day integer := 0;
  extra_days integer := 0;
  peak_capacity integer := 0;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if not exists (
    select 1 from public.work_order where id = p_work_order_id and tenant_id = tenant_key
  ) then
    raise exception 'Work order not found';
  end if;
  if not exists (
    select 1 from public.worker w
    join public.user_profile up on up.id = w.user_id
    where w.id = p_worker_id and w.tenant_id = tenant_key and up.is_active
  ) then raise exception 'Worker is unavailable'; end if;
  if cardinality(p_dates) is null or cardinality(p_dates) < 1 or cardinality(p_dates) > 62 then
    raise exception 'Choose between 1 and 62 schedule dates';
  end if;

  select array_agg(schedule_day order by schedule_day)
  into selected_dates
  from (select distinct unnest(p_dates) as schedule_day) dates
  where schedule_day is not null;
  date_count := cardinality(selected_dates);
  if date_count is null or date_count < 1 then
    raise exception 'Choose between 1 and 62 schedule dates';
  end if;

  select coalesce(array_agg(t.id order by t.sort_order, t.id), '{}'::bigint[])
  into target_ids
  from public.task t
  where t.work_order_id = p_work_order_id
    and t.tenant_id = tenant_key
    and t.status not in ('cancelled', 'completed');
  task_count := coalesce(cardinality(target_ids), 0);

  -- Days 1..extra_days each take base_per_day + 1 tasks; the rest take
  -- base_per_day. Capacities therefore sum to exactly task_count, which is what
  -- guarantees the computed day index below never runs past the selected dates.
  if task_count > 0 then
    base_per_day := task_count / date_count;
    extra_days := task_count % date_count;
    peak_capacity := base_per_day + case when extra_days > 0 then 1 else 0 end;
    if peak_capacity > 16 then
      raise exception 'Choose more dates. A day can hold at most 16 one-hour tasks starting at 8:00am';
    end if;
  end if;

  -- Unchanged from the previous version: this clears upcoming entries for every
  -- task on the order, not only the ones being rescheduled.
  delete from public.schedule_entry
  where tenant_id = tenant_key
    and planned_date >= current_date
    and (
      work_order_id = p_work_order_id
      or (
        task_id in (
          select id from public.task
          where work_order_id = p_work_order_id and tenant_id = tenant_key
        )
        and (not p_preserve_existing or worker_id = p_worker_id)
      )
    );

  if task_count = 0 then
    update public.work_order set lead_worker_id = p_worker_id
      where id = p_work_order_id and tenant_id = tenant_key;
    perform public.recompute_work_order_status(p_work_order_id);
    return jsonb_build_object('assignedTasks', 0, 'scheduledTasks', 0, 'scheduledDays', 0);
  end if;

  -- Assignment updates run in the same order the per-task loop used: retire other
  -- workers, clear every lead flag, then promote or insert this worker.
  if not p_preserve_existing then
    update public.assignment
    set status = 'reassigned',
        is_lead = false,
        reassigned_at = now(),
        reassigned_reason = 'Whole order reassigned and automatically scheduled'
    where task_id = any(target_ids) and worker_id <> p_worker_id and status <> 'reassigned';
  end if;

  update public.assignment set is_lead = false
  where task_id = any(target_ids) and status <> 'reassigned';

  update public.assignment set is_lead = true
  where task_id = any(target_ids) and worker_id = p_worker_id and status <> 'reassigned';

  -- One insert, so the statement-level notification trigger sends this worker a
  -- single "new work" message for the whole order.
  insert into public.assignment (tenant_id, task_id, worker_id, is_lead, assigned_by)
  select tenant_key, t.id, p_worker_id, true, actor_key
  from unnest(target_ids) as t(id)
  where not exists (
    select 1 from public.assignment a
    where a.task_id = t.id and a.worker_id = p_worker_id and a.status <> 'reassigned'
  );

  insert into public.schedule_entry (
    tenant_id, task_id, worker_id, planned_date, start_time,
    estimated_hours, multi_day_sequence, created_by
  )
  select
    tenant_key,
    placed.task_id,
    p_worker_id,
    selected_dates[placed.day_index],
    (time '08:00' + (placed.slot * interval '1 hour'))::time,
    1,
    placed.day_index,
    actor_key
  from (
    select
      ordered.task_id,
      case
        when ordered.seq <= extra_days * (base_per_day + 1)
          then ((ordered.seq - 1) / (base_per_day + 1)) + 1
        else extra_days
             + ((ordered.seq - extra_days * (base_per_day + 1) - 1)
                / greatest(base_per_day, 1)) + 1
      end as day_index,
      case
        when ordered.seq <= extra_days * (base_per_day + 1)
          then (ordered.seq - 1) % (base_per_day + 1)
        else (ordered.seq - extra_days * (base_per_day + 1) - 1)
             % greatest(base_per_day, 1)
      end as slot
    from unnest(target_ids) with ordinality as ordered(task_id, seq)
  ) placed
  on conflict (task_id, worker_id, planned_date) where task_id is not null
  do update set
    start_time = excluded.start_time,
    estimated_hours = excluded.estimated_hours,
    multi_day_sequence = excluded.multi_day_sequence,
    updated_at = now();

  -- One statement, so the roll-up trigger recomputes the order once.
  update public.task
  set status = 'scheduled', revised_since_viewed = true
  where id = any(target_ids) and status in ('draft', 'ready', 'assigned', 'scheduled');

  update public.work_order set lead_worker_id = p_worker_id
  where id = p_work_order_id and tenant_id = tenant_key;
  perform public.recompute_work_order_status(p_work_order_id);

  return jsonb_build_object(
    'assignedTasks', task_count,
    'scheduledTasks', task_count,
    'scheduledDays', least(date_count, task_count)
  );
end $$;

comment on function public.assign_and_schedule_whole_order(bigint, bigint, date[], boolean) is
  'Manager-only whole-order assignment with automatic one-hour scheduling from 8:00am. Set-based: one assignment insert, one schedule insert and one task update.';

-- ---------------------------------------------------------------------------
-- 3. Remove the superseded assignment function
-- ---------------------------------------------------------------------------

-- Unreachable since 0015. Keeping it invited work on a code path nothing calls.
drop function if exists public.assign_whole_order(bigint, bigint, boolean);

-- ---------------------------------------------------------------------------
-- 4. Cancelling a work order withdraws its work
-- ---------------------------------------------------------------------------

create or replace function public.cancel_work_order(p_work_order_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  cancelled_task_ids bigint[];
  affected_worker_ids bigint[] := '{}'::bigint[];
  recipient record;
  removed_entries integer := 0;
  notification_count integer := 0;
  order_number text;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception 'Enter a reason between 2 and 500 characters';
  end if;

  select work_order_number into order_number
  from public.work_order
  where id = p_work_order_id and tenant_id = tenant_key;
  if order_number is null then raise exception 'Work order not found'; end if;

  select coalesce(array_agg(t.id order by t.id), '{}'::bigint[])
  into cancelled_task_ids
  from public.task t
  where t.work_order_id = p_work_order_id
    and t.tenant_id = tenant_key
    and t.status not in ('cancelled', 'completed');

  select coalesce(array_agg(distinct a.worker_id), '{}'::bigint[])
  into affected_worker_ids
  from public.assignment a
  where a.tenant_id = tenant_key
    and a.task_id = any(cancelled_task_ids)
    and a.status <> 'reassigned';

  -- Notify once per worker, while their assignments are still live enough to
  -- identify them.
  for recipient in
    select distinct w.user_id, (w.sms_opt_in and tn.sms_enabled) as sms_allowed
    from public.assignment a
    join public.worker w on w.id = a.worker_id and w.tenant_id = tenant_key
    join public.tenant tn on tn.id = w.tenant_id
    where a.tenant_id = tenant_key
      and a.task_id = any(cancelled_task_ids)
      and a.status <> 'reassigned'
  loop
    perform public.queue_notification(
      recipient.user_id, 'in_app', 'Work order cancelled',
      'Order ' || order_number || ' was cancelled and removed from your work.', '/worker'
    );
    perform public.queue_notification(
      recipient.user_id, 'email', 'Work order cancelled',
      'Order ' || order_number || ' was cancelled. Sign in to view your current work.', '/worker'
    );
    if recipient.sms_allowed then
      perform public.queue_notification(
        recipient.user_id, 'sms', 'Work order cancelled',
        'Order ' || order_number || ' was cancelled. Open the app to view your current work.',
        '/worker'
      );
    end if;
    notification_count := notification_count + 1;
  end loop;

  delete from public.schedule_entry
  where tenant_id = tenant_key
    and (work_order_id = p_work_order_id or task_id = any(cancelled_task_ids));
  get diagnostics removed_entries = row_count;

  update public.task
  set status = 'cancelled', revised_since_viewed = true
  where tenant_id = tenant_key and id = any(cancelled_task_ids);

  -- Must follow the task update. That update fires the roll-up, which would
  -- otherwise settle the order on 'signed_off' when some tasks were already
  -- complete. Once the order is cancelled the roll-up leaves it alone.
  update public.work_order
  set status = 'cancelled', cancelled_at = now(), cancelled_reason = trim(p_reason)
  where id = p_work_order_id and tenant_id = tenant_key;

  insert into public.audit_event (
    tenant_id, actor_user_id, actor_role, action, entity_type, entity_id,
    before, after, affected_worker_ids, notified
  ) values (
    tenant_key, auth.uid(), 'manager', 'work_order.cancelled', 'work_order',
    p_work_order_id::text,
    jsonb_build_object(
      'taskIds', cancelled_task_ids,
      'workerIds', affected_worker_ids,
      'removedScheduleEntries', removed_entries
    ),
    jsonb_build_object('reason', trim(p_reason), 'status', 'cancelled'),
    affected_worker_ids, notification_count > 0
  );

  return jsonb_build_object(
    'cancelledTasks', cardinality(cancelled_task_ids),
    'affectedWorkers', cardinality(affected_worker_ids),
    'removedScheduleEntries', removed_entries
  );
end $$;

revoke all on function public.cancel_work_order(bigint, text) from public;
grant execute on function public.cancel_work_order(bigint, text) to authenticated;

comment on function public.cancel_work_order(bigint, text) is
  'Manager-only cancellation. Cancels active tasks, clears schedule entries, notifies each affected worker once and writes an audit event.';

-- ---------------------------------------------------------------------------
-- 5. Cancelled work stops reaching workers
-- ---------------------------------------------------------------------------

-- worker_can_access_work_order only tests for a live assignment, so without this
-- a cancelled order's tasks stayed visible and startable.
create or replace view public.worker_task_safe with (security_invoker = true) as
select
  t.id, t.work_order_id, t.description, t.quantity, t.unit, t.area_label, t.status,
  t.started_at, t.completed_at, t.revised_since_viewed, tc.name as trade_name,
  a.id as assignment_id, a.is_lead, a.status as assignment_status,
  (
    select count(*) from public.assignment team
    where team.task_id = t.id and team.status <> 'reassigned'
  ) as participant_count
from public.task t
join public.trade_section ts on ts.id = t.trade_section_id
join public.trade_category tc on tc.id = ts.trade_category_id
join public.work_order wo on wo.id = t.work_order_id and wo.status <> 'cancelled'
join public.assignment a
  on a.task_id = t.id
  and a.worker_id = public.current_worker_id()
  and a.status <> 'reassigned';

create or replace view public.worker_job_safe with (security_invoker = true) as
select
  wo.id, wo.site_id, wo.work_order_number, wo.job_number, wo.client_reference, wo.status,
  wo.start_date, wo.completion_due_date, wo.additional_instructions, c.name as client_name,
  s.street_address, s.suburb, s.state, s.postcode
from public.work_order wo
join public.client c on c.id = wo.client_id
join public.site s on s.id = wo.site_id
where wo.status <> 'cancelled' and public.worker_can_access_work_order(wo.id);

comment on view public.worker_task_safe is
  'Worker-safe allowlist. Intentionally contains no financial columns or joins, and excludes cancelled work orders.';
comment on view public.worker_job_safe is
  'Worker-safe work order allowlist. Original documents and pricing are excluded, as are cancelled orders.';

-- Completion submission had no status guard at all, so a worker could submit
-- against a cancelled task, or resubmit against one already approved.
create or replace function public.worker_submit_completion(
  p_task_id bigint,
  p_notes text,
  p_cannot_complete boolean,
  p_problem_report text
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  assignment_key bigint;
  submission_key bigint;
  tenant_key uuid := public.current_tenant_id();
  worker_key bigint := public.current_worker_id();
begin
  if public.current_app_role() <> 'worker' or not public.worker_can_access_task(p_task_id) then
    raise exception 'Forbidden';
  end if;
  if not exists (
    select 1 from public.task
    where id = p_task_id and status in ('in_progress', 'changes_requested', 'blocked')
  ) then
    raise exception 'This task cannot be submitted from its current status';
  end if;
  select id into assignment_key from public.assignment
  where task_id = p_task_id and worker_id = worker_key and status <> 'reassigned' limit 1;
  if assignment_key is null then raise exception 'Assignment not found'; end if;
  if p_cannot_complete and nullif(trim(coalesce(p_problem_report, '')), '') is null then
    raise exception 'A problem reason is required';
  end if;
  insert into public.completion_submission (
    tenant_id, task_id, assignment_id, worker_id, notes, cannot_complete, problem_report
  )
  values (
    tenant_key, p_task_id, assignment_key, worker_key,
    nullif(trim(coalesce(p_notes, '')), ''), p_cannot_complete,
    nullif(trim(coalesce(p_problem_report, '')), '')
  )
  returning id into submission_key;
  update public.task
  set status = case
    when p_cannot_complete then 'blocked'::public.task_status
    else 'completion_submitted'::public.task_status
  end
  where id = p_task_id;
  return submission_key;
end $$;
