-- Calendar queue controls and task-level whole-order auto-scheduling.

create or replace function public.assign_and_schedule_whole_order(
  p_work_order_id bigint,
  p_worker_id bigint,
  p_dates date[],
  p_preserve_existing boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  task_row record;
  selected_dates date[];
  schedule_date date;
  task_count integer := 0;
  date_count integer := 0;
  base_tasks_per_day integer := 0;
  extra_days integer := 0;
  date_index integer := 1;
  slot_in_day integer := 0;
  day_capacity integer := 0;
  assigned_count integer := 0;
  scheduled_count integer := 0;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if not exists (select 1 from public.work_order where id = p_work_order_id and tenant_id = tenant_key) then
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

  select count(*) into task_count
  from public.task
  where work_order_id = p_work_order_id
    and tenant_id = tenant_key
    and status not in ('cancelled','completed');

  if task_count > 0 then
    base_tasks_per_day := task_count / date_count;
    extra_days := task_count % date_count;
    day_capacity := base_tasks_per_day;
    if extra_days > 0 then
      day_capacity := day_capacity + 1;
    end if;
    if day_capacity > 16 then
      raise exception 'Choose more dates. A day can hold at most 16 one-hour tasks starting at 8:00am';
    end if;
  end if;

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

  for task_row in
    select t.id
    from public.task t
    where t.work_order_id = p_work_order_id
      and t.tenant_id = tenant_key
      and t.status not in ('cancelled','completed')
    order by t.sort_order, t.id
  loop
    if not p_preserve_existing then
      update public.assignment
      set status = 'reassigned', is_lead = false, reassigned_at = now(),
        reassigned_reason = 'Whole order reassigned and automatically scheduled'
      where task_id = task_row.id and worker_id <> p_worker_id and status <> 'reassigned';
    end if;

    update public.assignment set is_lead = false
    where task_id = task_row.id and status <> 'reassigned';

    if exists (
      select 1 from public.assignment
      where task_id = task_row.id and worker_id = p_worker_id and status <> 'reassigned'
    ) then
      update public.assignment set is_lead = true
      where task_id = task_row.id and worker_id = p_worker_id and status <> 'reassigned';
    else
      insert into public.assignment (tenant_id, task_id, worker_id, is_lead, assigned_by)
      values (tenant_key, task_row.id, p_worker_id, true, auth.uid());
    end if;

    loop
      day_capacity := base_tasks_per_day;
      if date_index <= extra_days then
        day_capacity := day_capacity + 1;
      end if;
      exit when slot_in_day < day_capacity;
      date_index := date_index + 1;
      slot_in_day := 0;
      if date_index > date_count then
        raise exception 'Could not distribute tasks across the selected dates';
      end if;
    end loop;

    schedule_date := selected_dates[date_index];
    insert into public.schedule_entry (
      tenant_id, task_id, worker_id, planned_date, start_time,
      estimated_hours, multi_day_sequence, created_by
    ) values (
      tenant_key, task_row.id, p_worker_id, schedule_date,
      (time '08:00' + slot_in_day * interval '1 hour')::time,
      1, date_index, auth.uid()
    )
    on conflict (task_id, worker_id, planned_date) where task_id is not null
    do update set
      start_time = excluded.start_time,
      estimated_hours = excluded.estimated_hours,
      multi_day_sequence = excluded.multi_day_sequence,
      updated_at = now();

    update public.task
    set status = 'scheduled', revised_since_viewed = true
    where id = task_row.id and status in ('draft','ready','assigned','scheduled');

    slot_in_day := slot_in_day + 1;
    assigned_count := assigned_count + 1;
    scheduled_count := scheduled_count + 1;
  end loop;

  update public.work_order set lead_worker_id = p_worker_id
  where id = p_work_order_id and tenant_id = tenant_key;
  perform public.recompute_work_order_status(p_work_order_id);

  return jsonb_build_object(
    'assignedTasks', assigned_count,
    'scheduledTasks', scheduled_count,
    'scheduledDays', least(date_count, scheduled_count)
  );
end $$;

create or replace function public.unassign_task(p_task_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  task_row record;
  recipient record;
  affected_worker_ids bigint[] := '{}';
  assignment_count integer := 0;
  notification_count integer := 0;
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
        'Marion: work on order ' || task_row.work_order_number || ' was unassigned. Open the app for your current work.',
        '/worker'
      );
    end if;
    notification_count := notification_count + 1;
  end loop;

  update public.assignment
  set status = 'reassigned', is_lead = false, reassigned_at = now(),
    reassigned_reason = 'Unassigned: ' || trim(p_reason)
  where task_id = p_task_id and tenant_id = tenant_key and status <> 'reassigned';

  delete from public.schedule_entry
  where task_id = p_task_id and tenant_id = tenant_key and planned_date >= current_date;

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
    jsonb_build_object('assignmentCount', assignment_count, 'workerIds', affected_worker_ids),
    jsonb_build_object('reason', trim(p_reason), 'status', 'ready'),
    affected_worker_ids, notification_count > 0
  );

  perform public.recompute_work_order_status(task_row.work_order_id);
  return jsonb_build_object('workOrderId', task_row.work_order_id, 'unassignedWorkers', assignment_count);
end $$;

create or replace function public.unschedule_all_upcoming(p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  recipient record;
  order_key bigint;
  affected_worker_ids bigint[] := '{}';
  affected_order_ids bigint[] := '{}';
  entry_count integer := 0;
  deleted_count integer := 0;
  notification_count integer := 0;
  first_date date;
  last_date date;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception 'Enter a reason between 2 and 500 characters';
  end if;

  select
    count(*), min(se.planned_date), max(se.planned_date),
    coalesce(array_agg(distinct se.worker_id) filter (where se.worker_id is not null), '{}'::bigint[]),
    coalesce(array_agg(distinct coalesce(se.work_order_id, t.work_order_id))
      filter (where coalesce(se.work_order_id, t.work_order_id) is not null), '{}'::bigint[])
  into entry_count, first_date, last_date, affected_worker_ids, affected_order_ids
  from public.schedule_entry se
  left join public.task t on t.id = se.task_id and t.tenant_id = tenant_key
  where se.tenant_id = tenant_key and se.planned_date >= current_date;

  if entry_count = 0 then
    return jsonb_build_object('removedEntries', 0, 'affectedWorkers', 0);
  end if;

  for recipient in
    select distinct w.id as worker_id, w.user_id, (w.sms_opt_in and tn.sms_enabled) as sms_allowed
    from public.schedule_entry se
    join public.worker w on w.id = se.worker_id and w.tenant_id = tenant_key
    join public.tenant tn on tn.id = w.tenant_id
    where se.tenant_id = tenant_key and se.planned_date >= current_date
  loop
    perform public.queue_notification(
      recipient.user_id, 'in_app', 'Upcoming schedule cleared',
      'Your upcoming schedule was cleared. Contact your manager if you need more information.',
      '/worker/upcoming'
    );
    perform public.queue_notification(
      recipient.user_id, 'email', 'Upcoming schedule cleared',
      'Your upcoming schedule was cleared. Sign in to view your current assigned work.',
      '/worker/upcoming'
    );
    if recipient.sms_allowed then
      perform public.queue_notification(
        recipient.user_id, 'sms', 'Upcoming schedule cleared',
        'Marion: your upcoming schedule was cleared. Open the app for your current assigned work.',
        '/worker/upcoming'
      );
    end if;
    notification_count := notification_count + 1;
  end loop;

  delete from public.schedule_entry
  where tenant_id = tenant_key and planned_date >= current_date;
  get diagnostics deleted_count = row_count;

  update public.task t
  set revised_since_viewed = true,
    status = case
      when t.status = 'scheduled' and exists (
        select 1 from public.assignment a where a.task_id = t.id and a.status <> 'reassigned'
      ) then 'assigned'::public.task_status
      when t.status = 'scheduled' then 'ready'::public.task_status
      else t.status
    end
  where t.tenant_id = tenant_key
    and t.work_order_id = any(affected_order_ids)
    and t.status not in ('completed','cancelled');

  foreach order_key in array affected_order_ids loop
    perform public.recompute_work_order_status(order_key);
  end loop;

  insert into public.audit_event (
    tenant_id, actor_user_id, actor_role, action, entity_type, entity_id,
    before, after, affected_worker_ids, notified
  ) values (
    tenant_key, auth.uid(), 'manager', 'schedule_entry.bulk_unscheduled', 'schedule_entry', 'upcoming',
    jsonb_build_object(
      'entryCount', entry_count,
      'firstDate', first_date,
      'lastDate', last_date,
      'workOrderIds', affected_order_ids
    ),
    jsonb_build_object('reason', trim(p_reason)),
    affected_worker_ids, notification_count > 0
  );

  return jsonb_build_object(
    'removedEntries', deleted_count,
    'affectedWorkers', cardinality(affected_worker_ids)
  );
end $$;

revoke all on function public.assign_and_schedule_whole_order(bigint,bigint,date[],boolean) from public;
revoke all on function public.unassign_task(bigint,text) from public;
revoke all on function public.unschedule_all_upcoming(text) from public;
grant execute on function public.assign_and_schedule_whole_order(bigint,bigint,date[],boolean) to authenticated;
grant execute on function public.unassign_task(bigint,text) to authenticated;
grant execute on function public.unschedule_all_upcoming(text) to authenticated;

comment on function public.assign_and_schedule_whole_order(bigint,bigint,date[],boolean) is
  'Manager-only whole-order assignment that distributes one-hour task bookings from 8:00am across selected dates.';
comment on function public.unassign_task(bigint,text) is
  'Manager-only task unassignment with audit history and worker notification.';
comment on function public.unschedule_all_upcoming(text) is
  'Manager-only removal of every tenant schedule from today onward, preserving past schedule history.';
