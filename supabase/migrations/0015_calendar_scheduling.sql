-- Keep one canonical booking if the pre-calendar UI was submitted twice for the
-- same worker, target and date. This allows the new upsert constraints to be
-- added safely without changing any distinct scheduled day.
delete from public.schedule_entry se_duplicate
using public.schedule_entry se_canonical
where se_duplicate.id > se_canonical.id
  and se_duplicate.task_id is not null
  and se_duplicate.task_id = se_canonical.task_id
  and se_duplicate.worker_id = se_canonical.worker_id
  and se_duplicate.planned_date = se_canonical.planned_date;

delete from public.schedule_entry se_duplicate
using public.schedule_entry se_canonical
where se_duplicate.id > se_canonical.id
  and se_duplicate.work_order_id is not null
  and se_duplicate.work_order_id = se_canonical.work_order_id
  and se_duplicate.worker_id = se_canonical.worker_id
  and se_duplicate.planned_date = se_canonical.planned_date;

create unique index if not exists schedule_task_worker_date_unique
  on public.schedule_entry (task_id, worker_id, planned_date)
  where task_id is not null;

create unique index if not exists schedule_order_worker_date_unique
  on public.schedule_entry (work_order_id, worker_id, planned_date)
  where work_order_id is not null;

create or replace function public.schedule_task(
  p_task_id bigint,
  p_worker_id bigint,
  p_dates date[],
  p_start_time time default null,
  p_estimated_hours numeric default null
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  schedule_date date;
  sequence_no integer := 1;
  scheduled_count integer := 0;
  tenant_key uuid := public.current_tenant_id();
  order_key bigint;
  has_lead boolean;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  select work_order_id into order_key from public.task where id = p_task_id and tenant_id = tenant_key;
  if order_key is null then raise exception 'Task not found'; end if;
  if cardinality(p_dates) is null or cardinality(p_dates) < 1 or cardinality(p_dates) > 62 then
    raise exception 'Choose between 1 and 62 schedule dates';
  end if;
  if not exists (
    select 1 from public.worker w
    join public.user_profile up on up.id = w.user_id
    where w.id = p_worker_id and w.tenant_id = tenant_key and up.is_active
  ) then raise exception 'Worker is unavailable'; end if;

  if not exists (select 1 from public.assignment where task_id = p_task_id and worker_id = p_worker_id and status <> 'reassigned') then
    select exists (select 1 from public.assignment where task_id = p_task_id and is_lead and status <> 'reassigned') into has_lead;
    insert into public.assignment (tenant_id, task_id, worker_id, is_lead, assigned_by)
    values (tenant_key, p_task_id, p_worker_id, not has_lead, auth.uid());
  end if;

  for schedule_date in select distinct unnest(p_dates) order by 1 loop
    insert into public.schedule_entry (
      tenant_id, task_id, worker_id, planned_date, start_time,
      estimated_hours, multi_day_sequence, created_by
    ) values (
      tenant_key, p_task_id, p_worker_id, schedule_date, p_start_time,
      p_estimated_hours, sequence_no, auth.uid()
    )
    on conflict (task_id, worker_id, planned_date) where task_id is not null
    do update set
      start_time = excluded.start_time,
      estimated_hours = excluded.estimated_hours,
      multi_day_sequence = excluded.multi_day_sequence,
      updated_at = now();
    sequence_no := sequence_no + 1;
    scheduled_count := scheduled_count + 1;
  end loop;

  update public.task set status = 'scheduled', revised_since_viewed = true
  where id = p_task_id and status in ('ready','assigned','scheduled');
  perform public.recompute_work_order_status(order_key);
  return scheduled_count;
end $$;

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
  schedule_date date;
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

  if not p_preserve_existing then
    delete from public.schedule_entry
    where tenant_id = tenant_key
      and planned_date >= current_date
      and (
        work_order_id = p_work_order_id
        or task_id in (select id from public.task where work_order_id = p_work_order_id and tenant_id = tenant_key)
      );
  else
    delete from public.schedule_entry
    where tenant_id = tenant_key and work_order_id = p_work_order_id and planned_date >= current_date;
  end if;

  for task_row in
    select id from public.task
    where work_order_id = p_work_order_id and tenant_id = tenant_key and status not in ('cancelled','completed')
    order by id
  loop
    if not p_preserve_existing then
      update public.assignment
      set status = 'reassigned', is_lead = false, reassigned_at = now(), reassigned_reason = 'Whole order reassigned and rescheduled'
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

    update public.task
    set status = 'scheduled', revised_since_viewed = true
    where id = task_row.id and status in ('draft','ready','assigned','scheduled');
    assigned_count := assigned_count + 1;
  end loop;

  for schedule_date in select distinct unnest(p_dates) order by 1 loop
    insert into public.schedule_entry (
      tenant_id, work_order_id, worker_id, planned_date, multi_day_sequence, created_by
    ) values (
      tenant_key, p_work_order_id, p_worker_id, schedule_date, scheduled_count + 1, auth.uid()
    )
    on conflict (work_order_id, worker_id, planned_date) where work_order_id is not null
    do update set multi_day_sequence = excluded.multi_day_sequence, updated_at = now();
    scheduled_count := scheduled_count + 1;
  end loop;

  update public.work_order set lead_worker_id = p_worker_id
  where id = p_work_order_id and tenant_id = tenant_key;
  perform public.recompute_work_order_status(p_work_order_id);

  return jsonb_build_object('assignedTasks', assigned_count, 'scheduledDays', scheduled_count);
end $$;

create or replace function public.unschedule_entry(p_schedule_entry_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  schedule_row public.schedule_entry%rowtype;
  order_key bigint;
  order_number text;
  recipient_user_id uuid;
  sms_allowed boolean := false;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if length(trim(coalesce(p_reason, ''))) not between 2 and 500 then
    raise exception 'Enter a reason between 2 and 500 characters';
  end if;

  select * into schedule_row from public.schedule_entry
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
    set revised_since_viewed = true,
      status = case
        when status = 'scheduled'
          and not exists (select 1 from public.schedule_entry where task_id = schedule_row.task_id)
          and not exists (select 1 from public.schedule_entry where work_order_id = order_key)
        then case
          when exists (select 1 from public.assignment where task_id = schedule_row.task_id and status <> 'reassigned') then 'assigned'::public.task_status
          else 'ready'::public.task_status
        end
        else status
      end
    where id = schedule_row.task_id and tenant_id = tenant_key;
  elsif order_key is not null then
    update public.task set revised_since_viewed = true
    where work_order_id = order_key and tenant_id = tenant_key and status <> 'cancelled';
    if not exists (select 1 from public.schedule_entry where work_order_id = order_key) then
      update public.task t
      set status = case
        when exists (select 1 from public.assignment where task_id = t.id and status <> 'reassigned') then 'assigned'::public.task_status
        else 'ready'::public.task_status
      end
      where t.work_order_id = order_key and t.tenant_id = tenant_key and t.status = 'scheduled'
        and not exists (select 1 from public.schedule_entry where task_id = t.id);
    end if;
  end if;

  select wo.work_order_number into order_number
  from public.work_order wo where wo.id = order_key and wo.tenant_id = tenant_key;

  if schedule_row.worker_id is not null then
    select w.user_id, (w.sms_opt_in and t.sms_enabled)
      into recipient_user_id, sms_allowed
    from public.worker w join public.tenant t on t.id = w.tenant_id
    where w.id = schedule_row.worker_id and w.tenant_id = tenant_key;

    if recipient_user_id is not null then
      perform public.queue_notification(
        recipient_user_id, 'in_app', 'Scheduled date removed',
        'The ' || to_char(schedule_row.planned_date, 'DD Mon YYYY') || ' date for work order ' || order_number || ' was removed. Contact your manager if needed.',
        case when schedule_row.task_id is not null then '/worker/tasks/' || schedule_row.task_id else '/worker/jobs/' || order_key end
      );
      perform public.queue_notification(
        recipient_user_id, 'email', 'Scheduled date removed',
        'A scheduled date for work order ' || order_number || ' was removed. Sign in to view your updated schedule.',
        case when schedule_row.task_id is not null then '/worker/tasks/' || schedule_row.task_id else '/worker/jobs/' || order_key end
      );
      if sms_allowed then
        perform public.queue_notification(
          recipient_user_id, 'sms', 'Scheduled date removed',
          'Marion: a scheduled date for work order ' || order_number || ' was removed. Open the app for your updated schedule.',
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
    to_jsonb(schedule_row), jsonb_build_object('reason', trim(p_reason)),
    case when schedule_row.worker_id is null then '{}'::bigint[] else array[schedule_row.worker_id] end,
    recipient_user_id is not null
  );

  if order_key is not null then perform public.recompute_work_order_status(order_key); end if;
end $$;

revoke all on function public.schedule_task(bigint,bigint,date[],time,numeric) from public;
revoke all on function public.assign_and_schedule_whole_order(bigint,bigint,date[],boolean) from public;
revoke all on function public.unschedule_entry(bigint,text) from public;
grant execute on function public.schedule_task(bigint,bigint,date[],time,numeric) to authenticated;
grant execute on function public.assign_and_schedule_whole_order(bigint,bigint,date[],boolean) to authenticated;
grant execute on function public.unschedule_entry(bigint,text) to authenticated;

comment on function public.assign_and_schedule_whole_order(bigint,bigint,date[],boolean) is
  'Manager-only atomic whole-order assignment and multi-day scheduling operation.';
