-- Only the authenticated Edge Function's service client can access this schema.
create schema if not exists jr_discovery;
revoke all on schema jr_discovery from public, anon, authenticated;
grant usage on schema jr_discovery to service_role;

create table jr_discovery.settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  rolling_limit integer not null default 180 check (rolling_limit between 1 and 180),
  daily_limit integer not null default 20 check (daily_limit between 1 and 20),
  user_daily_limit integer not null default 3 check (user_daily_limit between 1 and 10)
);
insert into jr_discovery.settings default values;
create table jr_discovery.pages (
  query_key text primary key check (query_key ~ '^[a-f0-9]{64}$'),
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  fetched_at timestamptz, expires_at timestamptz,
  more boolean not null default false,
  lease_id uuid, lease_until timestamptz, retry_after timestamptz
);
create table jr_discovery.requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, query_key text not null,
  reserved_at timestamptz not null default now(),
  state text not null default 'reserved' check (state in ('reserved','complete','failed','previous-local'))
);
create index requests_reserved_at_idx on jr_discovery.requests (reserved_at);
create index requests_user_reserved_idx on jr_discovery.requests (user_id, reserved_at);
create table jr_discovery.accesses (
  id bigint generated always as identity primary key,
  user_id uuid not null, accessed_at timestamptz not null default now()
);
create index accesses_time_idx on jr_discovery.accesses (accessed_at);
create index accesses_user_time_idx on jr_discovery.accesses (user_id, accessed_at);
alter table jr_discovery.settings enable row level security;
alter table jr_discovery.pages enable row level security;
alter table jr_discovery.requests enable row level security;
alter table jr_discovery.accesses enable row level security;
revoke all on all tables in schema jr_discovery from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema jr_discovery to service_role;
grant usage, select on all sequences in schema jr_discovery to service_role;

-- Serialized in the database, so limits apply across concurrent Edge instances.
create function public.jr_discovery_access(p_user uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if p_user is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(719280001);
  delete from jr_discovery.accesses where accessed_at < now() - interval '1 day';
  if (select count(*) from jr_discovery.accesses where accessed_at > now() - interval '1 minute') >= 240
    or (select count(*) from jr_discovery.accesses where user_id=p_user and accessed_at > now() - interval '1 minute') >= 30 then return false; end if;
  insert into jr_discovery.accesses(user_id) values (p_user);
  return true;
end $$;

create function public.jr_discovery_status(p_user uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('enabled',s.enabled,'monthlyLimit',s.rolling_limit,'dailyLimit',s.daily_limit,'userDailyLimit',s.user_daily_limit,
    'localMonthlyRequests',(select count(*) from jr_discovery.requests where reserved_at > now()-interval '30 days'),
    'localDailyRequests',(select count(*) from jr_discovery.requests where reserved_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
    'userDailyRequests',(select count(*) from jr_discovery.requests where user_id=p_user and reserved_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))
  from jr_discovery.settings s where s.singleton;
$$;

create function public.jr_discovery_restore(p_keys text[]) returns jsonb
language sql security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key',query_key,'rows',rows,'at',fetched_at,'more',more)), '[]'::jsonb)
  from jr_discovery.pages where query_key=any(p_keys) and cardinality(p_keys)<=40 and expires_at>now();
$$;

create function public.jr_discovery_reserve(p_key text,p_user uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_page jr_discovery.pages; v_settings jr_discovery.settings; v_id uuid; v_day timestamptz;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_user is null then raise exception 'Invalid reservation'; end if;
  perform pg_catalog.pg_advisory_xact_lock(719280002);
  delete from jr_discovery.requests where reserved_at < now()-interval '31 days';
  delete from jr_discovery.pages where greatest(expires_at,lease_until,retry_after) < now()-interval '2 days';
  select * into v_page from jr_discovery.pages where query_key=p_key;
  if v_page.expires_at>now() then return jsonb_build_object('kind','cached','page',jsonb_build_object('key',p_key,'rows',v_page.rows,'at',v_page.fetched_at,'more',v_page.more)); end if;
  if v_page.lease_until>now() then return jsonb_build_object('kind','busy'); end if;
  if v_page.retry_after>now() then return jsonb_build_object('kind','cooldown'); end if;
  select * into v_settings from jr_discovery.settings where singleton;
  if not v_settings.enabled then return jsonb_build_object('kind','disabled'); end if;
  v_day := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if (select count(*) from jr_discovery.requests where reserved_at>now()-interval '30 days') >= v_settings.rolling_limit
    or (select count(*) from jr_discovery.requests where reserved_at>=v_day) >= v_settings.daily_limit then return jsonb_build_object('kind','global_limit'); end if;
  if (select count(*) from jr_discovery.requests where user_id=p_user and reserved_at>=v_day) >= v_settings.user_daily_limit then return jsonb_build_object('kind','user_limit'); end if;
  insert into jr_discovery.requests(user_id,query_key) values(p_user,p_key) returning id into v_id;
  insert into jr_discovery.pages(query_key,lease_id,lease_until) values(p_key,v_id,now()+interval '75 seconds')
    on conflict(query_key) do update set lease_id=v_id,lease_until=now()+interval '75 seconds';
  return jsonb_build_object('kind','reserved','id',v_id);
end $$;

create function public.jr_discovery_finish(p_key text,p_id uuid,p_rows jsonb,p_more boolean,p_failed boolean) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare v_rows integer;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'Invalid result page'; end if;
  perform pg_catalog.pg_advisory_xact_lock(719280002);
  update jr_discovery.pages set rows=case when p_failed then rows else p_rows end,
    fetched_at=case when p_failed then fetched_at else now() end,
    expires_at=case when p_failed then expires_at else now()+interval '24 hours' end,
    more=case when p_failed then more else p_more end,
    lease_id=null,lease_until=null,retry_after=case when p_failed then now()+interval '10 minutes' else null end
    where query_key=p_key and lease_id=p_id;
  get diagnostics v_rows = row_count;
  if v_rows=0 then return false; end if;
  update jr_discovery.requests set state=case when p_failed then 'failed' else 'complete' end where id=p_id;
  return true;
end $$;

revoke all on function public.jr_discovery_access(uuid), public.jr_discovery_status(uuid), public.jr_discovery_restore(text[]), public.jr_discovery_reserve(text,uuid), public.jr_discovery_finish(text,uuid,jsonb,boolean,boolean) from public, anon, authenticated;
grant execute on function public.jr_discovery_access(uuid), public.jr_discovery_status(uuid), public.jr_discovery_restore(text[]), public.jr_discovery_reserve(text,uuid), public.jr_discovery_finish(text,uuid,jsonb,boolean,boolean) to service_role;
