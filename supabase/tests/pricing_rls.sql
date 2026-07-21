begin;
select plan(8);

select has_table('public', 'task_pricing', 'task_pricing exists');
select has_table('public', 'work_order_totals', 'work_order_totals exists');
select row_security_is_enabled('public', 'task_pricing', 'task_pricing RLS enabled');
select row_security_is_enabled('public', 'work_order_totals', 'work_order_totals RLS enabled');
select policies_are('public', 'task_pricing', array['task_pricing_manager_select','task_pricing_manager_insert','task_pricing_manager_update'], 'task pricing policies are manager-only');
select policies_are('public', 'work_order_totals', array['totals_manager_select','totals_manager_insert','totals_manager_update'], 'totals policies are manager-only');
select has_view('public', 'worker_task_safe', 'worker task allowlist exists');
select has_view('public', 'worker_job_safe', 'worker job allowlist exists');

select * from finish();
rollback;
