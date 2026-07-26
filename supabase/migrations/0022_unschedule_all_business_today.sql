-- The Scheduled queue exposes unschedule_all_upcoming in the manager UI for the
-- first time, so bring its date boundary in line with 0021.
--
-- It compared against current_date, which follows the database timezone, while
-- the calendar page decides what is upcoming in Australia/Sydney. Left as it was,
-- the new "Unschedule all" button would clear a different set of dates than the
-- list sitting directly above it claims to show.
--
-- Nothing else about the function changes: it still deletes upcoming entries,
-- returns each affected task to 'assigned' when it still has a live assignment,
-- notifies every affected worker once, and writes one audit event.

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
  boundary date := public.business_today();
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
  where se.tenant_id = tenant_key and se.planned_date >= boundary;

  if entry_count = 0 then
    return jsonb_build_object('removedEntries', 0, 'affectedWorkers', 0, 'affectedTasks', 0);
  end if;

  for recipient in
    select distinct w.id as worker_id, w.user_id, (w.sms_opt_in and tn.sms_enabled) as sms_allowed
    from public.schedule_entry se
    join public.worker w on w.id = se.worker_id and w.tenant_id = tenant_key
    join public.tenant tn on tn.id = w.tenant_id
    where se.tenant_id = tenant_key and se.planned_date >= boundary
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
        'Your upcoming schedule was cleared. Open the app for your current assigned work.',
        '/worker/upcoming'
      );
    end if;
    notification_count := notification_count + 1;
  end loop;

  delete from public.schedule_entry
  where tenant_id = tenant_key and planned_date >= boundary;
  get diagnostics deleted_count = row_count;

  -- Tasks keep their assignment, so a scheduled task drops back to 'assigned'
  -- and lands in the Assigned but unscheduled queue rather than becoming
  -- unassigned work.
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
    'affectedWorkers', cardinality(affected_worker_ids),
    'affectedTasks', cardinality(affected_order_ids)
  );
end $$;

comment on function public.unschedule_all_upcoming(text) is
  'Manager-only clearing of every upcoming schedule entry. Assignments are kept, so scheduled tasks return to Assigned but unscheduled. Boundary follows business_today().';
