-- Transactional service-role integration check; no provider calls or saved test data.
begin;
set local role service_role;
do $$
declare
  v_key text := md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  v_user uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
  v_first jsonb; v_cached jsonb; v_retry jsonb;
begin
  assert not has_function_privilege('anon','public.jr_discovery_reserve_page(text,uuid)','execute');
  assert not has_function_privilege('authenticated','public.jr_discovery_finish_page(text,uuid,jsonb,text,boolean)','execute');
  v_first := public.jr_discovery_reserve_page(v_key,v_user);
  assert v_first->>'kind' = 'reserved', 'Test needs two available global credits';
  assert public.jr_discovery_reserve_page(v_key,v_other)->>'kind' = 'busy';
  assert public.jr_discovery_finish_page(v_key,(v_first->>'id')::uuid,'[{"job_id":"fixture"}]','private-next-cursor',false);
  v_cached := public.jr_discovery_reserve_page(v_key,v_other);
  assert v_cached->>'kind' = 'cached';
  assert v_cached#>>'{page,cursor}' = 'private-next-cursor';
  assert public.jr_discovery_restore(array[v_key])#>>'{0,cursor}' = 'private-next-cursor';
  assert not public.jr_discovery_finish_page(v_key,gen_random_uuid(),'[]','stale-writer',false);
  assert (select cursor from jr_discovery.pages where query_key=v_key) = 'private-next-cursor';
  assert (select count(*) from jr_discovery.requests where user_id=v_user) = 1;
  assert (select count(*) from jr_discovery.requests where user_id=v_other) = 0;
  update jr_discovery.pages set expires_at=now()-interval '1 second' where query_key=v_key;
  assert public.jr_discovery_restore(array[v_key]) = '[]'::jsonb;
  v_retry := public.jr_discovery_reserve_page(v_key,v_user);
  assert v_retry->>'kind' = 'reserved';
  assert public.jr_discovery_finish_page(v_key,(v_retry->>'id')::uuid,'[]','',true);
  assert public.jr_discovery_reserve_page(v_key,v_other)->>'kind' = 'cooldown';
  assert (select count(*) from jr_discovery.requests where user_id=v_user) = 2;
end $$;
rollback;
