-- Run against the deployed migration with an administrative SQL connection.
-- Every fixture and temporary setting is rolled back, including quota records.
begin;
do $$
declare u uuid := gen_random_uuid(); k text := repeat('a',64); r jsonb; i integer; before_count bigint;
begin
  if has_function_privilege('anon','public.jr_discovery_status(uuid)','execute') or has_function_privilege('authenticated','public.jr_discovery_reserve(text,uuid)','execute') then raise exception 'RPC privileges are exposed'; end if;
  if has_schema_privilege('anon','jr_discovery','usage') or has_table_privilege('authenticated','jr_discovery.pages','select') then raise exception 'Cache is exposed'; end if;
  if not has_function_privilege('service_role','public.jr_discovery_reserve(text,uuid)','execute') then raise exception 'Service cannot reserve'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='jr_discovery' and c.relkind='r' and not c.relrowsecurity) then raise exception 'Missing RLS'; end if;
  select count(*) into before_count from jr_discovery.requests;
  update jr_discovery.settings set enabled=true;
  r := public.jr_discovery_reserve(k,u);
  if r->>'kind'<>'reserved' then raise exception 'Reservation failed: %',r; end if;
  if public.jr_discovery_reserve(k,u)->>'kind'<>'busy' then raise exception 'Duplicate reservation was permitted'; end if;
  if public.jr_discovery_finish(k,gen_random_uuid(),'[]',false,false) then raise exception 'Wrong lease completed a page'; end if;
  if not public.jr_discovery_finish(k,(r->>'id')::uuid,'[]',false,false) then raise exception 'Completion failed'; end if;
  update jr_discovery.settings set enabled=false;
  if public.jr_discovery_reserve(k,u)->>'kind'<>'cached' then raise exception 'Cache unavailable while paused'; end if;
  if jsonb_array_length(public.jr_discovery_restore(array[k]))<>1 then raise exception 'Cached restore failed'; end if;
  update jr_discovery.pages set expires_at=now()-interval '3 days' where query_key=k;
  if jsonb_array_length(public.jr_discovery_restore(array[k]))<>0 then raise exception 'Expired page restored'; end if;
  update jr_discovery.settings set enabled=true;
  r := public.jr_discovery_reserve(k,u);
  -- An old expiry cannot delete a newly acquired lease during cleanup.
  if public.jr_discovery_reserve(k,u)->>'kind'<>'busy' then raise exception 'Cleanup removed an active lease'; end if;
  perform public.jr_discovery_finish(k,(r->>'id')::uuid,'[]',false,true);
  if public.jr_discovery_reserve(k,u)->>'kind'<>'cooldown' then raise exception 'Failed query retried immediately'; end if;
  perform public.jr_discovery_reserve(repeat('b',64),u);
  if public.jr_discovery_reserve(repeat('c',64),u)->>'kind'<>'user_limit' then raise exception 'Per-user quota not enforced'; end if;
  update jr_discovery.settings set daily_limit=1;
  if public.jr_discovery_reserve(repeat('c',64),gen_random_uuid())->>'kind'<>'global_limit' then raise exception 'Global quota not enforced'; end if;
  for i in 1..30 loop if not public.jr_discovery_access(u) then raise exception 'Minute limiter failed early'; end if; end loop;
  if public.jr_discovery_access(u) then raise exception 'Minute limiter did not stop'; end if;
  if (select count(*) from jr_discovery.requests)<>before_count+3 then raise exception 'Credit ledger mismatch'; end if;
end $$;
rollback;
select 'PASS: privileges, RLS, leases, TTL, cooldown, quotas, access limit and ledger' as verification;
