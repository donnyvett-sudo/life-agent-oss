-- beat() вызывает только планировщик (service_role). revoke от anon/authenticated не снимал грант PUBLIC.
revoke execute on function public.beat() from public, anon, authenticated;
grant execute on function public.beat() to service_role;
