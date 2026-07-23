-- Manager-only task detail editing with tenant isolation, audit history and worker notices.

create or replace function public.update_task_details(
  p_task_id bigint,
  p_description text,
  p_quantity numeric,
  p_unit text,
  p_area_label text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  task_row record;
  recipient record;
  next_description text := trim(p_description);
  next_area_label text := nullif(trim(coalesce(p_area_label, '')), '');
  affected_worker_ids bigint[] := '{}'::bigint[];
  notification_count integer := 0;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if p_description is null or length(trim(p_description)) not between 2 and 1000 then
    raise exception 'Description must be between 2 and 1000 characters';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 999999 then
    raise exception 'Quantity must be greater than zero and no more than 999999';
  end if;
  if p_unit is null or p_unit not in ('ea','m2','lm','m3','hr') then
    raise exception 'Invalid task unit';
  end if;
  if length(trim(coalesce(p_area_label, ''))) > 120 then
    raise exception 'Area must be no more than 120 characters';
  end if;

  select
    t.id, t.work_order_id, t.description, t.quantity, t.unit, t.area_label, t.status,
    wo.work_order_number
  into task_row
  from public.task t
  join public.work_order wo on wo.id = t.work_order_id and wo.tenant_id = tenant_key
  where t.id = p_task_id and t.tenant_id = tenant_key
  for update of t;

  if not found then raise exception 'Task not found'; end if;
  if task_row.status in ('completed','cancelled') then
    raise exception 'Completed or cancelled tasks cannot be edited';
  end if;

  if task_row.description = next_description
    and task_row.quantity = p_quantity
    and task_row.unit = p_unit
    and task_row.area_label is not distinct from next_area_label then
    return jsonb_build_object(
      'changed', false,
      'workOrderId', task_row.work_order_id,
      'notifiedWorkers', 0
    );
  end if;

  select coalesce(array_agg(distinct a.worker_id), '{}'::bigint[])
  into affected_worker_ids
  from public.assignment a
  where a.tenant_id = tenant_key
    and a.task_id = p_task_id
    and a.status <> 'reassigned';

  update public.task
  set description = next_description,
    quantity = p_quantity,
    unit = p_unit,
    area_label = next_area_label,
    revised_since_viewed = true
  where id = p_task_id and tenant_id = tenant_key;

  for recipient in
    select distinct w.id as worker_id, w.user_id, (w.sms_opt_in and tn.sms_enabled) as sms_allowed
    from public.assignment a
    join public.worker w on w.id = a.worker_id and w.tenant_id = tenant_key
    join public.tenant tn on tn.id = w.tenant_id
    where a.tenant_id = tenant_key
      and a.task_id = p_task_id
      and a.status <> 'reassigned'
  loop
    perform public.queue_notification(
      recipient.user_id, 'in_app', 'Task scope updated',
      'Task details on order ' || task_row.work_order_number || ' were updated. Review the revised scope before continuing.',
      '/worker/tasks/' || p_task_id
    );
    perform public.queue_notification(
      recipient.user_id, 'email', 'Task scope updated',
      'Task details on order ' || task_row.work_order_number || ' were updated. Sign in and review the revised scope before continuing.',
      '/worker/tasks/' || p_task_id
    );
    if recipient.sms_allowed then
      perform public.queue_notification(
        recipient.user_id, 'sms', 'Task scope updated',
        'REME: task details on order ' || task_row.work_order_number || ' were updated. Open the app to review the revised scope.',
        '/worker/tasks/' || p_task_id
      );
    end if;
    notification_count := notification_count + 1;
  end loop;

  insert into public.audit_event (
    tenant_id, actor_user_id, actor_role, action, entity_type, entity_id,
    before, after, affected_worker_ids, notified
  ) values (
    tenant_key, auth.uid(), 'manager', 'task.details_updated', 'task', p_task_id::text,
    jsonb_build_object(
      'description', task_row.description,
      'quantity', task_row.quantity,
      'unit', task_row.unit,
      'areaLabel', task_row.area_label
    ),
    jsonb_build_object(
      'description', next_description,
      'quantity', p_quantity,
      'unit', p_unit,
      'areaLabel', next_area_label,
      'revisedSinceViewed', true
    ),
    affected_worker_ids, notification_count > 0
  );

  return jsonb_build_object(
    'changed', true,
    'workOrderId', task_row.work_order_id,
    'notifiedWorkers', notification_count
  );
end $$;

revoke all on function public.update_task_details(bigint,text,numeric,text,text) from public;
grant execute on function public.update_task_details(bigint,text,numeric,text,text) to authenticated;

comment on function public.update_task_details(bigint,text,numeric,text,text) is
  'Manager-only operational task editing with validation, tenant scoping, audit history and one revision notice per assigned worker.';
