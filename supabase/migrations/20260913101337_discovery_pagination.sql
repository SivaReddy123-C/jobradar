-- Private cursor storage; existing access, quota and lease rules remain in force.
alter table jr_discovery.pages add column cursor text not null default '' check (length(cursor) <= 10000);

create or replace function public.jr_discovery_restore(p_keys text[]) returns jsonb
language sql security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key',query_key,'rows',rows,'at',fetched_at,'more',more,'cursor',cursor)), '[]'::jsonb)
  from jr_discovery.pages where query_key=any(p_keys) and cardinality(p_keys)<=40 and expires_at>now();
$$;

create function public.jr_discovery_reserve_page(p_key text,p_user uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_cursor text;
begin
  -- The original RPC serializes the global budget and claims a per-page lease.
  v_result := public.jr_discovery_reserve(p_key,p_user);
  if v_result->>'kind' = 'cached' then
    select cursor into v_cursor from jr_discovery.pages where query_key=p_key;
    v_result := jsonb_set(v_result, '{page,cursor}', to_jsonb(coalesce(v_cursor,'')));
  end if;
  return v_result;
end $$;

create function public.jr_discovery_finish_page(p_key text,p_id uuid,p_rows jsonb,p_cursor text,p_failed boolean) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare v_saved boolean;
begin
  if p_cursor is null or length(p_cursor)>10000 then raise exception 'Invalid page cursor'; end if;
  v_saved := public.jr_discovery_finish(p_key,p_id,p_rows,p_cursor<>'',p_failed);
  -- Its transaction lock remains held until the cursor and rows commit together.
  if v_saved and not p_failed then update jr_discovery.pages set cursor=p_cursor where query_key=p_key; end if;
  return v_saved;
end $$;

revoke all on function public.jr_discovery_reserve_page(text,uuid), public.jr_discovery_finish_page(text,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.jr_discovery_reserve_page(text,uuid), public.jr_discovery_finish_page(text,uuid,jsonb,text,boolean) to service_role;
