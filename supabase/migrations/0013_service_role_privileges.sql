-- Backend-only operations use the Supabase secret key, which authenticates as
-- service_role. RLS bypass does not imply SQL privileges, so grant them
-- explicitly while leaving anon and authenticated grants unchanged.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Keep future migrations consistent when they create additional application
-- objects as the postgres migration owner.
alter default privileges for role postgres in schema public
  grant all privileges on tables to service_role;
alter default privileges for role postgres in schema public
  grant all privileges on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
