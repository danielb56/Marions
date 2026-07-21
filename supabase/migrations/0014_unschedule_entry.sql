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

revoke all on function public.unschedule_entry(bigint, text) from public;
grant execute on function public.unschedule_entry(bigint, text) to authenticated;

comment on function public.unschedule_entry(bigint, text) is
  'Manager-only removal of a scheduled date. Preserves history in audit_event and sends pricing-free worker notifications.';
