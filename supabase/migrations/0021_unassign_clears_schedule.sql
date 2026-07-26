-- Unassigning now always clears the schedule, and removing a single scheduled
-- date no longer demands a reason.
--
-- 1. business_today() fixes a timezone mismatch. The calendar page decides what
--    counts as "upcoming" using Australia/Sydney, but these functions compared
--    against current_date, which is the database's timezone (UTC on Supabase).
--    For roughly ten hours a day those two disagreed about what "today" is, so a
--    job could be listed under "Assigned but unscheduled" while the RPC still
--    considered it scheduled and skipped it. Pressing "Unassign all" then
--    appeared to do nothing to that job.
-- 2. Both unassign paths now delete every schedule entry for the tasks they
--    unassign, not just upcoming ones. Unassigned work should not stay on the
--    calendar. The removed entries are recorded in audit_event, which is where
--    this history belongs.
-- 3. unschedule_entry accepts a null or empty reason.

-- ---------------------------------------------------------------------------
-- 1. One definition of "today" for scheduling
-- ---------------------------------------------------------------------------

-- The business is Australian and the calendar renders Sydney dates, so schedule
-- boundaries must be evaluated there rather than in the server's timezone.
create or replace function public.business_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Australia/Sydney')::date
$$;

revoke all on function public.business_today() from public;

comment on function public.business_today() is
  'The current date in the operating timezone. Schedule comparisons must use this, not current_date, which follows the database timezone.';

-- ---------------------------------------------------------------------------
-- 2a. Unassigning one task clears all of its scheduled dates
-- ---------------------------------------------------------------------------

create or replace function public.unassign_task(p_task_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  task_row record;
  recipient record;
  affected_worker_ids bigint[] := '{}';
  assignment_count integer := 0;
  notification_count integer := 0;
  removed_entries integer := 0;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception 'Enter a reason between 2 and 500 characters';
  end if;

  select t.id, t.work_order_id, t.status, wo.work_order_number
  into task_row
  from public.task t
  join public.work_order wo on wo.id = t.work_order_id and wo.tenant_id = tenant_key
  where t.id = p_task_id and t.tenant_id = tenant_key;
  if not found then raise exception 'Task not found'; end if;
  if task_row.status not in ('draft','ready','assigned','scheduled') then
    raise exception 'Only work that has not started can be unassigned';
  end if;

  select coalesce(array_agg(distinct worker_id), '{}'::bigint[]), count(*)
  into affected_worker_ids, assignment_count
  from public.assignment
  where task_id = p_task_id and tenant_id = tenant_key and status <> 'reassigned';
  if assignment_count = 0 then raise exception 'Task is already unassigned'; end if;

  for recipient in
    select distinct w.id as worker_id, w.user_id, (w.sms_opt_in and tn.sms_enabled) as sms_allowed
    from public.assignment a
    join public.worker w on w.id = a.worker_id and w.tenant_id = tenant_key
    join public.tenant tn on tn.id = w.tenant_id
    where a.task_id = p_task_id and a.tenant_id = tenant_key and a.status <> 'reassigned'
  loop
    perform public.queue_notification(
      recipient.user_id, 'in_app', 'Work unassigned',
      'Work on order ' || task_row.work_order_number || ' is no longer assigned to you.',
      '/worker'
    );
    perform public.queue_notification(
      recipient.user_id, 'email', 'Work unassigned',
      'Work on order ' || task_row.work_order_number || ' is no longer assigned to you. Sign in to view your current work.',
      '/worker'
    );
    if recipient.sms_allowed then
      perform public.queue_notification(
        recipient.user_id, 'sms', 'Work unassigned',
        'Work on order ' || task_row.work_order_number || ' was unassigned. Open the app for your current work.',
        '/worker'
      );
    end if;
    notification_count := notification_count + 1;
  end loop;

  update public.assignment
  set status = 'reassigned', is_lead = false, reassigned_at = now(),
    reassigned_reason = 'Unassigned: ' || trim(p_reason)
  where task_id = p_task_id and tenant_id = tenant_key and status <> 'reassigned';

  -- Every entry, not only upcoming ones. A task nobody is assigned to should not
  -- be left sitting on any day of the calendar.
  delete from public.schedule_entry
  where task_id = p_task_id and tenant_id = tenant_key;
  get diagnostics removed_entries = row_count;

  update public.task
  set status = 'ready', revised_since_viewed = true
  where id = p_task_id and tenant_id = tenant_key;

  update public.work_order wo
  set lead_worker_id = null
  where wo.id = task_row.work_order_id
    and wo.tenant_id = tenant_key
    and wo.lead_worker_id is not null
    and not exists (
      select 1
      from public.task t
      join public.assignment a on a.task_id = t.id and a.worker_id = wo.lead_worker_id and a.status <> 'reassigned'
      where t.work_order_id = wo.id and t.tenant_id = tenant_key
    );

  insert into public.audit_event (
    tenant_id, actor_user_id, actor_role, action, entity_type, entity_id,
    before, after, affected_worker_ids, notified
  ) values (
    tenant_key, auth.uid(), 'manager', 'task.unassigned', 'task', p_task_id::text,
    jsonb_build_object(
      'assignmentCount', assignment_count,
      'workerIds', affected_worker_ids,
      'removedScheduleEntries', removed_entries
    ),
    jsonb_build_object('reason', trim(p_reason), 'status', 'ready'),
    affected_worker_ids, notification_count > 0
  );

  perform public.recompute_work_order_status(task_row.work_order_id);
  return jsonb_build_object(
    'workOrderId', task_row.work_order_id,
    'unassignedWorkers', assignment_count,
    'removedScheduleEntries', removed_entries
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2b. Bulk unassign clears schedules too, and agrees on what "today" means
-- ---------------------------------------------------------------------------

create or replace function public.unassign_all_unscheduled_tasks(p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  recipient record;
  order_key bigint;
  candidate_task_ids bigint[] := '{}'::bigint[];
  affected_order_ids bigint[] := '{}'::bigint[];
  affected_worker_ids bigint[] := '{}'::bigint[];
  assignment_count integer := 0;
  removed_assignment_count integer := 0;
  removed_entries integer := 0;
  notification_count integer := 0;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception 'Enter a reason between 2 and 500 characters';
  end if;

  select
    coalesce(array_agg(candidate.id order by candidate.id), '{}'::bigint[]),
    coalesce(array_agg(distinct candidate.work_order_id), '{}'::bigint[])
  into candidate_task_ids, affected_order_ids
  from (
    select t.id, t.work_order_id
    from public.task t
    where t.tenant_id = tenant_key
      and t.status in ('draft','ready','assigned','scheduled')
      and exists (
        select 1
        from public.assignment a
        where a.tenant_id = tenant_key
          and a.task_id = t.id
          and a.status <> 'reassigned'
      )
      -- business_today(), not current_date: this has to match the boundary the
      -- calendar page used to build the queue, or the button silently skips the
      -- rows the manager can see.
      and not exists (
        select 1
        from public.schedule_entry se
        where se.tenant_id = tenant_key
          and se.planned_date >= public.business_today()
          and (se.task_id = t.id or se.work_order_id = t.work_order_id)
      )
    for update of t
  ) candidate;

  if cardinality(candidate_task_ids) = 0 then
    return jsonb_build_object(
      'unassignedTasks', 0,
      'affectedWorkers', 0,
      'removedAssignments', 0,
      'removedScheduleEntries', 0
    );
  end if;

  select
    coalesce(array_agg(distinct a.worker_id), '{}'::bigint[]),
    count(*)
  into affected_worker_ids, assignment_count
  from public.assignment a
  where a.tenant_id = tenant_key
    and a.task_id = any(candidate_task_ids)
    and a.status <> 'reassigned';

  for recipient in
    select distinct
      w.id as worker_id,
      w.user_id,
      (w.sms_opt_in and tn.sms_enabled) as sms_allowed
    from public.assignment a
    join public.worker w on w.id = a.worker_id and w.tenant_id = tenant_key
    join public.tenant tn on tn.id = w.tenant_id
    where a.tenant_id = tenant_key
      and a.task_id = any(candidate_task_ids)
      and a.status <> 'reassigned'
  loop
    perform public.queue_notification(
      recipient.user_id, 'in_app', 'Work unassigned',
      'Your manager unassigned some work that was waiting to be scheduled.',
      '/worker'
    );
    perform public.queue_notification(
      recipient.user_id, 'email', 'Work unassigned',
      'Your manager unassigned some work that was waiting to be scheduled. Sign in to view your current work.',
      '/worker'
    );
    if recipient.sms_allowed then
      perform public.queue_notification(
        recipient.user_id, 'sms', 'Work unassigned',
        'Some work waiting to be scheduled was unassigned. Open the app to view your current work.',
        '/worker'
      );
    end if;
    notification_count := notification_count + 1;
  end loop;

  update public.assignment
  set status = 'reassigned',
    is_lead = false,
    reassigned_at = now(),
    reassigned_reason = 'Bulk unassigned: ' || trim(p_reason)
  where tenant_id = tenant_key
    and task_id = any(candidate_task_ids)
    and status <> 'reassigned';
  get diagnostics removed_assignment_count = row_count;

  -- This is the behaviour that was missing: unassigning left any leftover dates
  -- on the calendar, so the job still looked scheduled to nobody in particular.
  delete from public.schedule_entry
  where tenant_id = tenant_key
    and task_id = any(candidate_task_ids);
  get diagnostics removed_entries = row_count;

  update public.task
  set status = 'ready', revised_since_viewed = true
  where tenant_id = tenant_key and id = any(candidate_task_ids);

  update public.work_order wo
  set lead_worker_id = null
  where wo.tenant_id = tenant_key
    and wo.id = any(affected_order_ids)
    and wo.lead_worker_id is not null
    and not exists (
      select 1
      from public.task t
      join public.assignment a
        on a.task_id = t.id
        and a.worker_id = wo.lead_worker_id
        and a.status <> 'reassigned'
      where t.tenant_id = tenant_key and t.work_order_id = wo.id
    );

  foreach order_key in array affected_order_ids loop
    perform public.recompute_work_order_status(order_key);
  end loop;

  insert into public.audit_event (
    tenant_id, actor_user_id, actor_role, action, entity_type, entity_id,
    before, after, affected_worker_ids, notified
  ) values (
    tenant_key, auth.uid(), 'manager', 'task.bulk_unassigned', 'task', 'assigned-but-unscheduled',
    jsonb_build_object(
      'taskIds', candidate_task_ids,
      'workOrderIds', affected_order_ids,
      'assignmentCount', assignment_count,
      'workerIds', affected_worker_ids,
      'removedScheduleEntries', removed_entries
    ),
    jsonb_build_object('reason', trim(p_reason), 'status', 'ready'),
    affected_worker_ids, notification_count > 0
  );

  return jsonb_build_object(
    'unassignedTasks', cardinality(candidate_task_ids),
    'affectedWorkers', cardinality(affected_worker_ids),
    'removedAssignments', removed_assignment_count,
    'removedScheduleEntries', removed_entries
  );
end $$;

comment on function public.unassign_all_unscheduled_tasks(text) is
  'Manager-only bulk unassignment for planning-stage tasks with active assignments and no upcoming task or whole-order schedule. Also clears any leftover schedule entries on those tasks.';

-- ---------------------------------------------------------------------------
-- 3. Removing one scheduled date no longer needs a reason
-- ---------------------------------------------------------------------------

create or replace function public.unschedule_entry(p_schedule_entry_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  schedule_row public.schedule_entry%rowtype;
  order_key bigint;
  order_number text;
  recipient_user_id uuid;
  sms_allowed boolean := false;
  reason_text text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  -- Removing a single date is a routine planning correction, so no reason is
  -- required. One is still stored when supplied.
  if reason_text is not null and length(reason_text) > 500 then
    raise exception 'A reason must be 500 characters or fewer';
  end if;

  select * into schedule_row
  from public.schedule_entry
  where id = p_schedule_entry_id and tenant_id = tenant_key;
  if not found then raise exception 'Scheduled date not found'; end if;

  if schedule_row.task_id is not null then
    select work_order_id into order_key from public.task where id = schedule_row.task_id and tenant_id = tenant_key;
  else
    order_key := schedule_row.work_order_id;
  end if;

  delete from public.schedule_entry where id = schedule_row.id and tenant_id = tenant_key;

  if schedule_row.task_id is not null then
    update public.task
    set
      revised_since_viewed = true,
      status = case
        when status = 'scheduled' and not exists (
          select 1 from public.schedule_entry where task_id = schedule_row.task_id
        ) then case
          when exists (
            select 1 from public.assignment where task_id = schedule_row.task_id and status <> 'reassigned'
          ) then 'assigned'::public.task_status
          else 'ready'::public.task_status
        end
        else status
      end
    where id = schedule_row.task_id and tenant_id = tenant_key;
  end if;

  select wo.work_order_number into order_number
  from public.work_order wo where wo.id = order_key and wo.tenant_id = tenant_key;

  if schedule_row.worker_id is not null then
    select w.user_id, (w.sms_opt_in and t.sms_enabled)
      into recipient_user_id, sms_allowed
    from public.worker w
    join public.tenant t on t.id = w.tenant_id
    where w.id = schedule_row.worker_id and w.tenant_id = tenant_key;

    if recipient_user_id is not null then
      perform public.queue_notification(
        recipient_user_id,
        'in_app',
        'Scheduled date removed',
        'The ' || to_char(schedule_row.planned_date, 'DD Mon YYYY') || ' date for work order ' || order_number || ' was removed. Contact your manager if needed.',
        case when schedule_row.task_id is not null then '/worker/tasks/' || schedule_row.task_id else '/worker/jobs/' || order_key end
      );
      perform public.queue_notification(
        recipient_user_id,
        'email',
        'Scheduled date removed',
        'A scheduled date for work order ' || order_number || ' was removed. Sign in to view your updated schedule.',
        case when schedule_row.task_id is not null then '/worker/tasks/' || schedule_row.task_id else '/worker/jobs/' || order_key end
      );
      if sms_allowed then
        perform public.queue_notification(
          recipient_user_id,
          'sms',
          'Scheduled date removed',
          'A scheduled date for work order ' || order_number || ' was removed. Open the app for your updated schedule.',
          case when schedule_row.task_id is not null then '/worker/tasks/' || schedule_row.task_id else '/worker/jobs/' || order_key end
        );
      end if;
    end if;
  end if;

  insert into public.audit_event (
    tenant_id, actor_user_id, actor_role, action, entity_type, entity_id,
    before, after, affected_worker_ids, notified
  ) values (
    tenant_key, auth.uid(), 'manager', 'schedule_entry.unscheduled', 'schedule_entry', schedule_row.id::text,
    to_jsonb(schedule_row), jsonb_build_object('reason', reason_text),
    case when schedule_row.worker_id is null then '{}'::bigint[] else array[schedule_row.worker_id] end,
    recipient_user_id is not null
  );

  if order_key is not null then perform public.recompute_work_order_status(order_key); end if;
end $$;

comment on function public.unschedule_entry(bigint, text) is
  'Manager-only removal of a scheduled date. The reason is optional. Preserves history in audit_event and sends pricing-free worker notifications.';
