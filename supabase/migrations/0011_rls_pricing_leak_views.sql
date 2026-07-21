create or replace function public.create_work_order_bundle(p_payload jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  tenant_key uuid := public.current_tenant_id();
  actor_key uuid := auth.uid();
  client_key bigint;
  customer_key bigint;
  site_key bigint;
  order_key bigint;
  trade_key bigint;
  section_key bigint;
  task_key bigint;
  task_row jsonb;
  task_position bigint;
  area_value text;
  rate_value bigint;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if jsonb_array_length(coalesce(p_payload -> 'tasks', '[]'::jsonb)) < 1 then raise exception 'At least one task is required'; end if;

  select id into client_key from public.client
  where tenant_id = tenant_key and lower(name) = lower(trim(p_payload ->> 'clientName')) limit 1;
  if client_key is null then
    insert into public.client (tenant_id, name) values (tenant_key, trim(p_payload ->> 'clientName')) returning id into client_key;
  end if;

  if nullif(trim(coalesce(p_payload ->> 'customerName', '')), '') is not null then
    select id into customer_key from public.customer
    where tenant_id = tenant_key and lower(name) = lower(trim(p_payload ->> 'customerName'))
      and coalesce(phone, '') = coalesce(p_payload ->> 'customerPhone', '') limit 1;
    if customer_key is null then
      insert into public.customer (tenant_id, name, phone)
      values (tenant_key, trim(p_payload ->> 'customerName'), nullif(trim(p_payload ->> 'customerPhone'), ''))
      returning id into customer_key;
    end if;
  end if;

  select id into site_key from public.site
  where tenant_id = tenant_key
    and lower(street_address) = lower(trim(p_payload ->> 'streetAddress'))
    and postcode = p_payload ->> 'postcode' limit 1;
  if site_key is null then
    insert into public.site (tenant_id, street_address, suburb, state, postcode)
    values (tenant_key, trim(p_payload ->> 'streetAddress'), trim(p_payload ->> 'suburb'), upper(p_payload ->> 'state'), p_payload ->> 'postcode')
    returning id into site_key;
  end if;

  if nullif(trim(coalesce(p_payload ->> 'siteContactName', '')), '') is not null then
    insert into public.site_contact (tenant_id, site_id, name, phone, relationship)
    values (tenant_key, site_key, trim(p_payload ->> 'siteContactName'), nullif(trim(p_payload ->> 'siteContactPhone'), ''), 'site contact');
  end if;

  insert into public.work_order (
    tenant_id, client_id, customer_id, site_id, work_order_number, job_number, client_reference,
    client_supervisor_name, client_supervisor_phone, issued_at, start_date, completion_due_date,
    status, notes, additional_instructions, duplicate_reason, created_by
  ) values (
    tenant_key, client_key, customer_key, site_key, trim(p_payload ->> 'workOrderNumber'),
    nullif(trim(p_payload ->> 'jobNumber'), ''), nullif(trim(p_payload ->> 'clientReference'), ''),
    nullif(trim(p_payload ->> 'supervisorName'), ''), nullif(trim(p_payload ->> 'supervisorPhone'), ''),
    nullif(p_payload ->> 'issuedAt', '')::timestamptz, nullif(p_payload ->> 'startDate', '')::date,
    nullif(p_payload ->> 'dueDate', '')::date, 'ready', nullif(trim(p_payload ->> 'notes'), ''),
    nullif(trim(p_payload ->> 'additionalInstructions'), ''), nullif(trim(p_payload ->> 'duplicateReason'), ''), actor_key
  ) returning id into order_key;

  for task_row, task_position in
    select value, ordinality from jsonb_array_elements(p_payload -> 'tasks') with ordinality
  loop
    select id into trade_key from public.trade_category
    where tenant_id = tenant_key and lower(name) = lower(trim(task_row ->> 'trade')) limit 1;
    if trade_key is null then
      insert into public.trade_category (tenant_id, name, sort_order)
      values (tenant_key, trim(task_row ->> 'trade'), 900) returning id into trade_key;
    end if;
    area_value := nullif(trim(coalesce(task_row ->> 'area', '')), '');
    select id into section_key from public.trade_section
    where work_order_id = order_key and trade_category_id = trade_key and area_label is not distinct from area_value limit 1;
    if section_key is null then
      insert into public.trade_section (tenant_id, work_order_id, trade_category_id, area_label, sort_order)
      values (tenant_key, order_key, trade_key, area_value, task_position::integer) returning id into section_key;
    end if;
    insert into public.task (tenant_id, work_order_id, trade_section_id, description, quantity, unit, area_label, sort_order, status)
    values (
      tenant_key, order_key, section_key, trim(task_row ->> 'description'), (task_row ->> 'quantity')::numeric,
      task_row ->> 'unit', area_value, task_position::integer, 'ready'
    ) returning id into task_key;
    rate_value := nullif(task_row ->> 'unitRateCents', '')::bigint;
    if rate_value is not null then
      insert into public.task_pricing (task_id, tenant_id, unit_rate_cents, line_total_cents, updated_by)
      values (task_key, tenant_key, rate_value, round((task_row ->> 'quantity')::numeric * rate_value)::bigint, actor_key);
    end if;
  end loop;

  insert into public.work_order_totals (
    work_order_id, tenant_id, subtotal_cents, gst_rate, gst_cents, total_cents, total_override, updated_by
  ) values (
    order_key, tenant_key, (p_payload ->> 'subtotalCents')::bigint, (p_payload ->> 'gstRate')::numeric,
    (p_payload ->> 'gstCents')::bigint, (p_payload ->> 'totalCents')::bigint,
    coalesce((p_payload ->> 'totalOverride')::boolean, true), actor_key
  );
  return order_key;
end $$;

create or replace function public.assign_whole_order(p_work_order_id bigint, p_worker_id bigint, p_preserve_existing boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare task_row record; affected integer := 0; tenant_key uuid := public.current_tenant_id();
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if not exists (select 1 from public.worker w join public.user_profile up on up.id = w.user_id where w.id = p_worker_id and w.tenant_id = tenant_key and up.is_active) then
    raise exception 'Worker is unavailable';
  end if;
  for task_row in select id from public.task where work_order_id = p_work_order_id and tenant_id = tenant_key and status <> 'cancelled' loop
    if p_preserve_existing and exists (select 1 from public.assignment where task_id = task_row.id and status <> 'reassigned') then continue; end if;
    update public.assignment set status = 'reassigned', is_lead = false, reassigned_at = now(), reassigned_reason = 'Whole order reassigned'
      where task_id = task_row.id and status <> 'reassigned';
    insert into public.assignment (tenant_id, task_id, worker_id, is_lead, assigned_by)
      values (tenant_key, task_row.id, p_worker_id, true, auth.uid());
    update public.task set status = 'assigned' where id = task_row.id and status in ('draft','ready','assigned','scheduled');
    affected := affected + 1;
  end loop;
  update public.work_order set lead_worker_id = p_worker_id where id = p_work_order_id and tenant_id = tenant_key;
  perform public.recompute_work_order_status(p_work_order_id);
  return affected;
end $$;

create or replace function public.assign_task(p_task_id bigint, p_worker_ids bigint[], p_lead_worker_id bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare worker_key bigint; tenant_key uuid := public.current_tenant_id(); count_added integer := 0;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if not exists (select 1 from public.task where id = p_task_id and tenant_id = tenant_key) then
    raise exception 'Task not found';
  end if;
  if array_length(p_worker_ids, 1) is null or not (p_lead_worker_id = any(p_worker_ids)) then raise exception 'Choose one assigned worker as lead'; end if;
  update public.assignment set status = 'reassigned', is_lead = false, reassigned_at = now(), reassigned_reason = 'Task assignment changed'
    where task_id = p_task_id and status <> 'reassigned' and not (worker_id = any(p_worker_ids));
  update public.assignment set is_lead = false where task_id = p_task_id and status <> 'reassigned';
  foreach worker_key in array p_worker_ids loop
    if not exists (select 1 from public.worker w join public.user_profile up on up.id = w.user_id where w.id = worker_key and w.tenant_id = tenant_key and up.is_active) then
      raise exception 'Worker % is unavailable', worker_key;
    end if;
    if exists (select 1 from public.assignment where task_id = p_task_id and worker_id = worker_key and status <> 'reassigned') then
      update public.assignment set is_lead = worker_key = p_lead_worker_id where task_id = p_task_id and worker_id = worker_key and status <> 'reassigned';
    else
      insert into public.assignment (tenant_id, task_id, worker_id, is_lead, assigned_by)
      values (tenant_key, p_task_id, worker_key, worker_key = p_lead_worker_id, auth.uid());
    end if;
    count_added := count_added + 1;
  end loop;
  update public.task set status = 'assigned' where id = p_task_id and tenant_id = tenant_key and status in ('draft','ready','assigned','scheduled');
  return count_added;
end $$;

create or replace function public.schedule_task(p_task_id bigint, p_worker_id bigint, p_dates date[], p_start_time time default null, p_estimated_hours numeric default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare schedule_date date; sequence_no integer := 1; inserted_count integer := 0; tenant_key uuid := public.current_tenant_id(); order_key bigint; has_lead boolean;
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  select work_order_id into order_key from public.task where id = p_task_id and tenant_id = tenant_key;
  if order_key is null then raise exception 'Task not found'; end if;
  if array_length(p_dates, 1) is null then raise exception 'Choose at least one schedule date'; end if;
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
  foreach schedule_date in array p_dates loop
    insert into public.schedule_entry (tenant_id, task_id, worker_id, planned_date, start_time, estimated_hours, multi_day_sequence, created_by)
    values (tenant_key, p_task_id, p_worker_id, schedule_date, p_start_time, p_estimated_hours, sequence_no, auth.uid());
    sequence_no := sequence_no + 1; inserted_count := inserted_count + 1;
  end loop;
  update public.task set status = 'scheduled' where id = p_task_id and status in ('ready','assigned','scheduled');
  perform public.recompute_work_order_status(order_key);
  return inserted_count;
end $$;

create or replace function public.worker_start_task(p_task_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_app_role() <> 'worker' or not public.worker_can_access_task(p_task_id) then raise exception 'Forbidden'; end if;
  update public.task set status = 'in_progress', started_at = coalesce(started_at, now())
    where id = p_task_id and status in ('assigned','scheduled','changes_requested','blocked');
  if not found then raise exception 'Task cannot be started from its current status'; end if;
end $$;

create or replace function public.worker_submit_completion(p_task_id bigint, p_notes text, p_cannot_complete boolean, p_problem_report text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare assignment_key bigint; submission_key bigint; tenant_key uuid := public.current_tenant_id(); worker_key bigint := public.current_worker_id();
begin
  if public.current_app_role() <> 'worker' or not public.worker_can_access_task(p_task_id) then raise exception 'Forbidden'; end if;
  select id into assignment_key from public.assignment
  where task_id = p_task_id and worker_id = worker_key and status <> 'reassigned' limit 1;
  if assignment_key is null then raise exception 'Assignment not found'; end if;
  if p_cannot_complete and nullif(trim(coalesce(p_problem_report, '')), '') is null then raise exception 'A problem reason is required'; end if;
  insert into public.completion_submission (tenant_id, task_id, assignment_id, worker_id, notes, cannot_complete, problem_report)
  values (tenant_key, p_task_id, assignment_key, worker_key, nullif(trim(coalesce(p_notes, '')), ''), p_cannot_complete, nullif(trim(coalesce(p_problem_report, '')), ''))
  returning id into submission_key;
  update public.task set status = case when p_cannot_complete then 'blocked'::public.task_status else 'completion_submitted'::public.task_status end where id = p_task_id;
  return submission_key;
end $$;

create or replace function public.manager_review_submission(p_submission_id bigint, p_decision text, p_review_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare task_key bigint; tenant_key uuid := public.current_tenant_id();
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  if p_decision not in ('approved','changes_requested','rejected') then raise exception 'Invalid decision'; end if;
  if p_decision <> 'approved' and nullif(trim(coalesce(p_review_notes, '')), '') is null then raise exception 'Review notes are required'; end if;
  update public.completion_submission
    set status = p_decision::public.submission_status, reviewed_by = auth.uid(), reviewed_at = now(), review_notes = nullif(trim(coalesce(p_review_notes, '')), '')
    where id = p_submission_id and tenant_id = tenant_key returning task_id into task_key;
  if task_key is null then raise exception 'Submission not found'; end if;
  update public.task set status = case when p_decision = 'approved' then 'completed'::public.task_status else 'changes_requested'::public.task_status end,
    completed_at = case when p_decision = 'approved' then now() else null end where id = task_key;
end $$;

create or replace function public.mark_notification_read(p_notification_id bigint)
returns void language sql security definer set search_path = '' as $$
  update public.notification set read_at = coalesce(read_at, now()) where id = p_notification_id and recipient_user_id = auth.uid()
$$;

create or replace function public.update_my_profile(p_display_name text, p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if nullif(trim(p_display_name), '') is null then raise exception 'Display name is required'; end if;
  update public.user_profile set display_name = trim(p_display_name), phone = nullif(trim(coalesce(p_phone, '')), '') where id = auth.uid();
end $$;

create or replace function public.set_mfa_enrolled(p_enrolled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_app_role() <> 'manager' then raise exception 'Forbidden'; end if;
  if p_enrolled and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'Verify the authenticator first'; end if;
  update public.user_profile set mfa_enrolled = p_enrolled where id = auth.uid();
end $$;

create or replace function public.worker_change_notices(p_task_id bigint)
returns table(action text, changed_at timestamptz, summary text) language plpgsql security definer set search_path = '' as $$
begin
  if public.current_app_role() <> 'worker' or not public.worker_can_access_task(p_task_id) then raise exception 'Forbidden'; end if;
  return query select ae.action, ae.created_at,
    case
      when ae.action like 'schedule_entry.%' then 'Schedule updated'
      when ae.action like 'assignment.%' then 'Assignment updated'
      when ae.action like 'task.%' then 'Task scope or status updated'
      else 'Work order updated'
    end
  from public.audit_event ae
  where ae.tenant_id = public.current_tenant_id()
    and not (ae.action like 'task_pricing.%' or ae.action like 'work_order_totals.%')
    and (
      (ae.entity_type = 'task' and ae.entity_id = p_task_id::text)
      or (ae.entity_type = 'work_order' and ae.entity_id = (select work_order_id::text from public.task where id = p_task_id))
      or (ae.entity_type = 'schedule_entry' and exists (
        select 1 from public.schedule_entry se where se.id::text = ae.entity_id and se.task_id = p_task_id
      ))
      or (ae.entity_type = 'assignment' and exists (
        select 1 from public.assignment a where a.id::text = ae.entity_id and a.task_id = p_task_id
      ))
    )
  order by ae.created_at desc limit 30;
end $$;

create view public.worker_task_safe with (security_invoker = true) as
select
  t.id, t.work_order_id, t.description, t.quantity, t.unit, t.area_label, t.status,
  t.started_at, t.completed_at, t.revised_since_viewed, tc.name as trade_name,
  a.id as assignment_id, a.is_lead, a.status as assignment_status,
  (select count(*) from public.assignment team where team.task_id = t.id and team.status <> 'reassigned') as participant_count
from public.task t
join public.trade_section ts on ts.id = t.trade_section_id
join public.trade_category tc on tc.id = ts.trade_category_id
join public.assignment a on a.task_id = t.id and a.worker_id = public.current_worker_id() and a.status <> 'reassigned';

create view public.worker_job_safe with (security_invoker = true) as
select
  wo.id, wo.site_id, wo.work_order_number, wo.job_number, wo.client_reference, wo.status, wo.start_date, wo.completion_due_date,
  wo.additional_instructions, c.name as client_name, s.street_address, s.suburb, s.state, s.postcode
from public.work_order wo
join public.client c on c.id = wo.client_id
join public.site s on s.id = wo.site_id
where public.worker_can_access_work_order(wo.id);

revoke all on function public.create_work_order_bundle(jsonb) from public;
revoke all on function public.assign_whole_order(bigint,bigint,boolean) from public;
revoke all on function public.assign_task(bigint,bigint[],bigint) from public;
revoke all on function public.schedule_task(bigint,bigint,date[],time,numeric) from public;
revoke all on function public.worker_start_task(bigint) from public;
revoke all on function public.worker_submit_completion(bigint,text,boolean,text) from public;
revoke all on function public.manager_review_submission(bigint,text,text) from public;
revoke all on function public.mark_notification_read(bigint) from public;
revoke all on function public.update_my_profile(text,text) from public;
revoke all on function public.set_mfa_enrolled(boolean) from public;
revoke all on function public.worker_change_notices(bigint) from public;
grant execute on function public.create_work_order_bundle(jsonb) to authenticated;
grant execute on function public.assign_whole_order(bigint,bigint,boolean) to authenticated;
grant execute on function public.assign_task(bigint,bigint[],bigint) to authenticated;
grant execute on function public.schedule_task(bigint,bigint,date[],time,numeric) to authenticated;
grant execute on function public.worker_start_task(bigint) to authenticated;
grant execute on function public.worker_submit_completion(bigint,text,boolean,text) to authenticated;
grant execute on function public.manager_review_submission(bigint,text,text) to authenticated;
grant execute on function public.mark_notification_read(bigint) to authenticated;
grant execute on function public.update_my_profile(text,text) to authenticated;
grant execute on function public.set_mfa_enrolled(boolean) to authenticated;
grant execute on function public.worker_change_notices(bigint) to authenticated;
grant select on public.worker_task_safe, public.worker_job_safe to authenticated;

comment on view public.worker_task_safe is 'Worker-safe allowlist. Intentionally contains no financial columns or joins.';
comment on view public.worker_job_safe is 'Worker-safe work order allowlist. Original documents and pricing are excluded.';
