-- Bulk-unassign the exact jobs shown in the manager's Assigned but unscheduled queue.

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
      and not exists (
        select 1
        from public.schedule_entry se
        where se.tenant_id = tenant_key
          and se.planned_date >= current_date
          and (se.task_id = t.id or se.work_order_id = t.work_order_id)
      )
    for update of t
  ) candidate;

  if cardinality(candidate_task_ids) = 0 then
    return jsonb_build_object(
      'unassignedTasks', 0,
      'affectedWorkers', 0,
      'removedAssignments', 0
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
      'workerIds', affected_worker_ids
    ),
    jsonb_build_object('reason', trim(p_reason), 'status', 'ready'),
    affected_worker_ids, notification_count > 0
  );

  return jsonb_build_object(
    'unassignedTasks', cardinality(candidate_task_ids),
    'affectedWorkers', cardinality(affected_worker_ids),
    'removedAssignments', removed_assignment_count
  );
end $$;

revoke all on function public.unassign_all_unscheduled_tasks(text) from public;
grant execute on function public.unassign_all_unscheduled_tasks(text) to authenticated;

comment on function public.unassign_all_unscheduled_tasks(text) is
  'Manager-only bulk unassignment for planning-stage tasks with active assignments and no upcoming task or whole-order schedule.';
