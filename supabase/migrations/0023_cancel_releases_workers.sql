-- Cancelling a work order now releases its workers, and no queue shows anything
-- belonging to a cancelled order.
--
-- 0020 cancelled the tasks, cleared upcoming dates and notified the workers, but
-- it never touched public.assignment and never cleared work_order.lead_worker_id.
-- The assignments stayed live, so as far as every query that joins on
-- "status <> 'reassigned'" was concerned the work was still assigned to somebody.
--
-- Work orders cancelled before 0020 shipped are in a worse state again: only
-- work_order.status was ever set, so their tasks are still sitting at 'ready',
-- 'assigned' or 'scheduled' and continue to appear in the manager queues. The
-- backfill at the end repairs those.
--
-- Assignments are retired (status = 'reassigned'), not deleted. That is how this
-- schema has always withdrawn an assignment -- every live query filters on
-- status <> 'reassigned' -- and completion_submission.assignment_id has a foreign
-- key onto it, so a hard delete would fail for any task that was ever submitted.
-- The effect is the same: the row stops existing everywhere the app looks.

create or replace function public.cancel_work_order(p_work_order_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  cancelled_task_ids bigint[];
  all_task_ids bigint[];
  affected_worker_ids bigint[] := '{}'::bigint[];
  recipient record;
  removed_entries integer := 0;
  released_assignments integer := 0;
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
  into all_task_ids
  from public.task t
  where t.work_order_id = p_work_order_id and t.tenant_id = tenant_key;

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

  -- Every date for the whole order, not only the ones attached to the tasks
  -- being cancelled. A cancelled order should occupy no day on the calendar.
  delete from public.schedule_entry
  where tenant_id = tenant_key
    and (work_order_id = p_work_order_id or task_id = any(all_task_ids));
  get diagnostics removed_entries = row_count;

  -- New in this migration: release the workers. Completed tasks keep their
  -- assignments, because those are part of a finished record rather than
  -- outstanding work.
  update public.assignment
  set status = 'reassigned',
      is_lead = false,
      reassigned_at = now(),
      reassigned_reason = 'Work order cancelled: ' || trim(p_reason)
  where tenant_id = tenant_key
    and task_id = any(cancelled_task_ids)
    and status <> 'reassigned';
  get diagnostics released_assignments = row_count;

  update public.task
  set status = 'cancelled', revised_since_viewed = true
  where tenant_id = tenant_key and id = any(cancelled_task_ids);

  -- Must follow the task update. That update fires the roll-up, which would
  -- otherwise settle the order on 'signed_off' when some tasks were already
  -- complete. Once the order is cancelled the roll-up leaves it alone.
  update public.work_order
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_reason = trim(p_reason),
      lead_worker_id = null
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
      'removedScheduleEntries', removed_entries,
      'releasedAssignments', released_assignments
    ),
    jsonb_build_object('reason', trim(p_reason), 'status', 'cancelled'),
    affected_worker_ids, notification_count > 0
  );

  return jsonb_build_object(
    'cancelledTasks', cardinality(cancelled_task_ids),
    'affectedWorkers', cardinality(affected_worker_ids),
    'removedScheduleEntries', removed_entries,
    'releasedAssignments', released_assignments
  );
end $$;

comment on function public.cancel_work_order(bigint, text) is
  'Manager-only cancellation. Cancels active tasks, releases their assignments, clears every schedule entry for the order, notifies each affected worker once and writes an audit event.';

-- ---------------------------------------------------------------------------
-- Backfill: repair orders cancelled under the old behaviour
-- ---------------------------------------------------------------------------

-- Runs as the migration owner across every tenant. No notifications are sent:
-- these cancellations already happened, sometimes long ago, and telling workers
-- about them now would be noise. The repair is recorded in audit_event instead.
do $$
declare
  order_row record;
  stale_task_ids bigint[];
  removed_entries integer := 0;
  released_assignments integer := 0;
begin
  for order_row in
    select wo.id, wo.tenant_id
    from public.work_order wo
    where wo.status = 'cancelled'
      and (
        wo.lead_worker_id is not null
        or exists (
          select 1 from public.task t
          where t.work_order_id = wo.id and t.status not in ('cancelled', 'completed')
        )
        or exists (
          select 1 from public.schedule_entry se
          left join public.task t on t.id = se.task_id
          where se.work_order_id = wo.id or t.work_order_id = wo.id
        )
      )
  loop
    select coalesce(array_agg(t.id), '{}'::bigint[])
    into stale_task_ids
    from public.task t
    where t.work_order_id = order_row.id
      and t.status not in ('cancelled', 'completed');

    delete from public.schedule_entry se
    where se.work_order_id = order_row.id
      or se.task_id in (select t.id from public.task t where t.work_order_id = order_row.id);
    get diagnostics removed_entries = row_count;

    update public.assignment
    set status = 'reassigned',
        is_lead = false,
        reassigned_at = now(),
        reassigned_reason = 'Work order cancelled'
    where task_id = any(stale_task_ids) and status <> 'reassigned';
    get diagnostics released_assignments = row_count;

    update public.task
    set status = 'cancelled', revised_since_viewed = true
    where id = any(stale_task_ids);

    update public.work_order set lead_worker_id = null where id = order_row.id;

    insert into public.audit_event (
      tenant_id, actor_user_id, actor_role, action, entity_type, entity_id,
      before, after, affected_worker_ids, notified
    ) values (
      order_row.tenant_id, null, 'system', 'work_order.cancellation_repaired', 'work_order',
      order_row.id::text,
      jsonb_build_object(
        'taskIds', stale_task_ids,
        'removedScheduleEntries', removed_entries,
        'releasedAssignments', released_assignments
      ),
      jsonb_build_object('reason', 'Backfill for cancellations made before 0023', 'status', 'cancelled'),
      '{}'::bigint[], false
    );
  end loop;
end $$;
