create or replace function public.soft_delete_attachment(p_attachment_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'Forbidden'; end if;
  update public.attachment set deleted_at = now()
  where id = p_attachment_id and tenant_id = public.current_tenant_id() and deleted_at is null;
end $$;

create view public.attachment_purge_candidate with (security_invoker = true) as
select a.id, a.storage_key, a.content_type, a.size_bytes, a.deleted_at, t.retention_years
from public.attachment a
join public.tenant t on t.id = a.tenant_id
where a.deleted_at is not null
  and a.deleted_at < now() - make_interval(years => t.retention_years);

revoke all on function public.soft_delete_attachment(bigint) from public;
grant execute on function public.soft_delete_attachment(bigint) to authenticated;
grant select on public.attachment_purge_candidate to authenticated;

comment on view public.attachment_purge_candidate is 'Manager-only through underlying attachment RLS. Deletion from R2 remains an explicit background job.';
