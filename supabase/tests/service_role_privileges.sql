begin;
select plan(5);

select ok(
  has_schema_privilege('service_role', 'public', 'USAGE'),
  'service role can use the public schema'
);
select ok(
  has_table_privilege('service_role', 'public.tenant', 'SELECT, INSERT'),
  'service role can bootstrap tenants'
);
select ok(
  has_table_privilege('service_role', 'public.notification', 'SELECT, UPDATE'),
  'service role can dispatch queued notifications'
);
select ok(
  has_function_privilege('service_role', 'public.create_work_order_bundle(jsonb)', 'EXECUTE'),
  'service role can execute application functions'
);
select ok(
  not has_table_privilege('authenticated', 'public.tenant', 'INSERT'),
  'signed-in users cannot create tenants directly'
);

select * from finish();
rollback;
