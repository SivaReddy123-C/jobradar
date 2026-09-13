import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostedDiscoveryHandler, discoveryCacheRows, discoveryPageKey, MAX_DISCOVERY_PAGES, type HostedStore, type HostedPage, type Reservation } from '../src/hosted-discovery.js';
import { discoveryQueries } from '../src/jsearch.js';

const now = new Date('2026-09-13T12:00:00Z');
const preferences = { version: 1, roles: [{ id: 'accountant', label: 'Accountant' }], markets: ['in'], location: '', workplace: 'any', level: 'any' };
const row = { job_id: 'hosted-fixture', job_title: 'Accountant', employer_name: 'Fixture Company', job_country: 'IN', job_location: 'Pune, India', job_apply_link: 'https://employer.example/jobs/123', job_publisher: 'Employer', job_posted_at_datetime_utc: now.toISOString() };
test('hosted cache excludes provider contacts and descriptions while preserving matching fields', () => {
  assert.deepEqual(discoveryCacheRows([{ ...row, job_description: 'Unneeded full text', recruiter_email: 'private@example.com' }]), [row]);
  assert.equal(discoveryCacheRows(Array(120).fill(row)).length, 100);
});
function fixture() {
  const pages = new Map<string, HostedPage>();
  let calls = 0, keys = 0, access = true, failure = false;
  let reservation: Reservation | undefined;
  let responses = [{ jobs: [row], cursor: '' }];
  const leases = new Map<string,string>();
  const ledger: { key: string; user: string; failed?: boolean }[] = [];
  const store: HostedStore = {
    access: async () => access,
    status: async user => ({ enabled: true, monthlyLimit: 180, dailyLimit: 20, userDailyLimit: 3, localMonthlyRequests: ledger.length, localDailyRequests: ledger.length, userDailyRequests: ledger.filter(r => r.user === user).length }),
    restore: async hashes => hashes.flatMap(h => pages.has(h) ? [pages.get(h)!] : []),
    reserve: async (key, user) => { if (pages.has(key)) return { kind: 'cached', page: pages.get(key)! }; if (reservation) return reservation; if (leases.has(key)) return {kind:'busy'}; ledger.push({ key, user }); const id=String(ledger.length); leases.set(key,id); return { kind: 'reserved', id }; },
    finish: async (key, id, rows, cursor, failed) => { if(leases.get(key)!==id) return false; leases.delete(key); ledger[Number(id) - 1]!.failed = failed; if (!failed) pages.set(key, { key, rows, cursor, more: Boolean(cursor), at: now.toISOString() }); return true; },
  };
  const handler = hostedDiscoveryHandler({ store, now: () => now, authenticate: async token => ['user1','user2'].includes(token) ? token : null,
    getKey: () => { keys++; return 'SYNTHETIC_PRIVATE_KEY'; }, fetcher: (async (input: string | URL | Request) => {
      calls++; if (failure) return new Response('private provider diagnostics', { status: 403 });
      const u=new URL(String(input)); assert.equal(u.searchParams.get('num_pages'),'1');
      const cursor=u.searchParams.get('cursor');
      const index=cursor ? responses.findIndex(r=>r.cursor===cursor)+1 : 0;
      assert.ok(!cursor || index>0, 'only provider-issued cursors can be used');
      return Response.json({status:'OK',data:responses[index]});
    }) as typeof fetch });
  const request = (payload: unknown, token = 'user1', origin = 'https://sivareddy123-c.github.io', method = 'POST') => handler(new Request('https://service.example', { method, headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(method === 'POST' ? { body: typeof payload === 'string' ? payload : JSON.stringify(payload) } : {}) }));
  return { request, pages, ledger, setResponses: (value: typeof responses) => {responses=value;}, setReservation: (value: Reservation) => { reservation = value; }, denyAccess: () => { access = false; }, fail: () => { failure = true; }, calls: () => calls, keys: () => keys };
}
test('hosted endpoint requires an authenticated account and exact allowed origin', async () => {
  const f = fixture();
  for (const token of ['', 'unconfirmed', 'publishable-key']) assert.equal((await f.request({ action: 'status' }, token)).status, 401);
  assert.equal((await f.request({}, 'user1', 'https://evil.example')).status, 403);
  const preflight = await f.request({}, '', 'https://sivareddy123-c.github.io', 'OPTIONS');
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://sivareddy123-c.github.io');
  assert.equal((await f.request({}, 'user1', 'https://sivareddy123-c.github.io', 'GET')).status, 405);
  assert.equal(f.calls(), 0); assert.equal(f.keys(), 0);
});
test('hosted requests reject oversized, malformed, unselected and unsupported inputs', async () => {
  const f = fixture();
  assert.equal((await f.request('x'.repeat(12001))).status, 413);
  for (const payload of ['{', '[]', 'null', { action: 'configure', key: 'do-not-save' }, { action: 'search', preferences, roleId: 'teacher' }, { action: 'search', preferences: { ...preferences, markets: ['gb'] }, roleId: 'accountant' }]) assert.equal((await f.request(payload)).status, 400);
  assert.equal(f.calls(), 0); assert.equal(f.keys(), 0);
});
test('saved pages restore with no credential lookup or provider call and filter wrong titles', async () => {
  const f = fixture(), key = discoveryPageKey(discoveryQueries(preferences, 'accountant').queries[0]!);
  f.pages.set(key, { key, at: now.toISOString(), rows: [row, { ...row, job_id: 'wrong', job_title: 'Account Executive' }], more: true });
  const result = await (await f.request({ action: 'restore', preferences })).json();
  assert.equal(result.jobs.length, 1); assert.equal(result.requestsUsed, 0); assert.equal(result.queries[0].cached, true);
  assert.equal(f.calls(), 0); assert.equal(f.keys(), 0); assert.equal(f.ledger.length, 0);
});
test('two authenticated users share a cached page but only the initiating user spends credit', async () => {
  const f = fixture(), payload = { action: 'search', preferences, roleId: 'accountant' };
  const first = await (await f.request(payload)).json(), second = await (await f.request(payload, 'user2')).json();
  assert.equal(first.jobs.length, 1); assert.equal(first.requestsUsed, 1);
  assert.equal(second.jobs.length, 1); assert.equal(second.requestsUsed, 0); assert.equal(f.calls(), 1);
  assert.deepEqual(f.ledger.map(r => r.user), ['user1']);
  assert.ok(!JSON.stringify(first).includes('SYNTHETIC_PRIVATE_KEY'));
  assert.equal((await f.request(payload, 'revoked')).status, 401);
});
test('database refusal cannot fall through to a provider call', async () => {
  for (const kind of ['busy','cooldown','disabled','global_limit','user_limit'] as const) {
    const f = fixture(); f.setReservation({ kind });
    const result = await (await f.request({ action: 'search', preferences, roleId: 'accountant' })).json();
    assert.equal(f.calls(), 0); assert.equal(result.requestsUsed, 0); assert.equal(result.warnings.length, 1);
  }
  const f = fixture(); f.denyAccess(); assert.equal((await f.request({ action: 'status' })).status, 429);
});
test('a failed provider call consumes its reserved credit and stops before a second market', async () => {
  const f = fixture(); f.fail();
  const result = await (await f.request({ action: 'search', preferences: { ...preferences, markets: ['in','us'] }, roleId: 'accountant' })).json();
  assert.equal(f.calls(), 1); assert.equal(f.ledger[0]?.failed, true); assert.equal(result.requestsUsed, 1);
  assert.equal(f.pages.size, 0); assert.equal(result.warnings.length, 1); assert.ok(!JSON.stringify(result).includes('private provider diagnostics'));
});

const firstSearch = { action:'search', preferences, roleId:'accountant' };
const moreSearch = (result: {queries: {nextPageToken?:string}[]}) => ({...firstSearch,action:'more',continuations:{in:result.queries[0]!.nextPageToken}});
function paginatedFixture() {
  const f=fixture();
  f.setResponses([{jobs:[row],cursor:'private-provider-cursor'}, {jobs:[row,{...row,job_id:'page-two',job_apply_link:'https://employer.example/jobs/456'}],cursor:''}]);
  return f;
}
test('pagination follows the provider cursor, deduplicates, and restores all pages across users', async () => {
  const f=paginatedFixture();
  const first=await (await f.request(firstSearch)).json();
  assert.equal(first.queries[0].pages,1); assert.match(first.queries[0].nextPageToken,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(first).includes('private-provider-cursor'));
  const second=await (await f.request(moreSearch(first))).json();
  assert.equal(second.jobs.length,2); assert.equal(second.queries[0].returned,3); assert.equal(second.queries[0].pages,2);
  assert.equal(second.requestsUsed,1); assert.equal(second.queries[0].moreAvailable,false);
  const restored=await (await f.request({action:'restore',preferences},'user2')).json();
  assert.equal(restored.jobs.length,2); assert.equal(restored.requestsUsed,0); assert.equal(restored.queries[0].pages,2);
  const replay=await (await f.request(moreSearch(first),'user2')).json();
  assert.equal(replay.jobs.length,2); assert.equal(replay.requestsUsed,0); assert.equal(f.calls(),2);
});
test('concurrent next-page requests reserve one credit; replay does not advance further', async () => {
  const f=paginatedFixture(); const first=await (await f.request(firstSearch)).json();
  const results=await Promise.all([f.request(moreSearch(first)),f.request(moreSearch(first),'user2')]);
  const bodies=await Promise.all(results.map(r=>r.json()));
  assert.equal(bodies.reduce((n,b)=>n+b.requestsUsed,0),1); assert.equal(f.calls(),2);
  const replay=await (await f.request(moreSearch(first))).json(); assert.equal(replay.requestsUsed,0);
});
test('untrusted or expired continuation tokens never spend provider credits', async () => {
  const f=paginatedFixture();const first=await (await f.request(firstSearch)).json();
  for(const continuations of [null,[],{}, {gb:'a'.repeat(64)}, {in:'raw-cursor'}, {in:25}]) {
    assert.equal((await f.request({...firstSearch,action:'more',continuations})).status,400);
  }
  const forged=await (await f.request({...firstSearch,action:'more',continuations:{in:'a'.repeat(64)}})).json();
  assert.equal(forged.requestsUsed,0); assert.equal(forged.warnings.length,1);
  f.pages.clear(); const expired=await (await f.request(moreSearch(first))).json();
  assert.equal(expired.requestsUsed,0); assert.equal(f.calls(),1);
});
test('next-page failures and quota refusals preserve earlier matching jobs', async () => {
  for(const refusal of [true,false]) {
    const f=paginatedFixture(); const first=await (await f.request(firstSearch)).json();
    if(refusal)f.setReservation({kind:'user_limit'}); else f.fail();
    const next=await (await f.request(moreSearch(first))).json();
    assert.equal(next.jobs.length,1);assert.equal(next.queries[0].pages,1);
    assert.equal(next.requestsUsed,refusal?0:1);assert.equal(next.warnings.length,1);
  }
});
test('pagination stops at five pages and terminates repeated cursor cycles', async () => {
  const f=fixture();f.setResponses(Array.from({length:7},(_,i)=>({jobs:[{...row,job_id:String(i),job_apply_link:`https://employer.example/jobs/${i}`}],cursor:`cursor-${i}`})));
  let result=await (await f.request(firstSearch)).json();
  for(let i=1;i<MAX_DISCOVERY_PAGES;i++) result=await (await f.request(moreSearch(result))).json();
  assert.equal(result.jobs.length,5);assert.equal(result.queries[0].nextPageToken,undefined);assert.equal(result.queries[0].pageLimitReached,true);assert.equal(f.calls(),5);
  const cycle=fixture();cycle.setResponses([{jobs:[row],cursor:'repeat'},{jobs:[row],cursor:'repeat'}]);
  const initial=await (await cycle.request(firstSearch)).json();
  const repeated=await (await cycle.request(moreSearch(initial))).json();
  assert.equal(repeated.queries[0].nextPageToken,undefined);assert.equal(cycle.calls(),2);
});

test('equivalent search titles retain role and city scope and cannot be used to submit arbitrary queries', async () => {
  const selected={...preferences,location:'Pune'};
  const query=discoveryQueries(selected,'accountant','Accounts Executive');
  assert.equal(query.queries[0]?.query,'accounts executive jobs in Pune, India');
  assert.equal(query.preferences.roles[0]?.id,'accountant');
  const f=fixture();
  for(const searchTerm of ['Sales manager','accountant via linkedin',12]) {
    assert.equal((await f.request({...firstSearch,searchTerm})).status,400);
  }
  assert.equal(f.calls(),0);
  f.setResponses([{jobs:[{...row,job_title:'Accounts Executive'}],cursor:''}]);
  const result=await (await f.request({...firstSearch,searchTerm:'accounts executive'})).json();
  assert.equal(result.jobs.length,1); assert.equal(result.queries[0].query.roleId,'accountant');
  const restored=await (await f.request({action:'restore',preferences,roleId:'accountant',searchTerm:'accounts executive'},'user2')).json();
  assert.equal(restored.jobs.length,1);assert.equal(restored.requestsUsed,0);assert.equal(f.calls(),1);
});

test('fetching more for one market cannot spend a credit in the other market', async () => {
  const f=paginatedFixture(); const first=await (await f.request(firstSearch)).json();
  const result=await (await f.request({...moreSearch(first),preferences:{...preferences,markets:['in','us']}})).json();
  assert.equal(result.requestsUsed,1);assert.equal(result.queries.length,1);assert.equal(result.queries[0].query.market,'in');
  assert.equal(f.calls(),2);
});
