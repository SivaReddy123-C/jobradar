import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostedDiscoveryHandler, discoveryCacheRows, type HostedStore, type HostedPage, type Reservation } from '../src/hosted-discovery.js';
import { discoveryQueries, queryKey } from '../src/jsearch.js';

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
  const ledger: { key: string; user: string; failed?: boolean }[] = [];
  const store: HostedStore = {
    access: async () => access,
    status: async user => ({ enabled: true, monthlyLimit: 180, dailyLimit: 20, userDailyLimit: 3, localMonthlyRequests: ledger.length, localDailyRequests: ledger.length, userDailyRequests: ledger.filter(r => r.user === user).length }),
    restore: async hashes => hashes.flatMap(h => pages.has(h) ? [pages.get(h)!] : []),
    reserve: async (key, user) => { if (pages.has(key)) return { kind: 'cached', page: pages.get(key)! }; if (reservation) return reservation; ledger.push({ key, user }); return { kind: 'reserved', id: String(ledger.length) }; },
    finish: async (key, id, rows, more, failed) => { ledger[Number(id) - 1]!.failed = failed; if (!failed) pages.set(key, { key, rows, more, at: now.toISOString() }); return true; },
  };
  const handler = hostedDiscoveryHandler({ store, now: () => now, authenticate: async token => ['user1','user2'].includes(token) ? token : null,
    getKey: () => { keys++; return 'SYNTHETIC_PRIVATE_KEY'; }, fetcher: (async () => { calls++; if (failure) return new Response('private provider diagnostics', { status: 403 }); return Response.json({ status: 'OK', data: { jobs: [row], cursor: '' } }); }) as typeof fetch });
  const request = (payload: unknown, token = 'user1', origin = 'https://sivareddy123-c.github.io', method = 'POST') => handler(new Request('https://service.example', { method, headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(method === 'POST' ? { body: typeof payload === 'string' ? payload : JSON.stringify(payload) } : {}) }));
  return { request, pages, ledger, setReservation: (value: Reservation) => { reservation = value; }, denyAccess: () => { access = false; }, fail: () => { failure = true; }, calls: () => calls, keys: () => keys };
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
  const f = fixture(), key = queryKey(discoveryQueries(preferences, 'accountant').queries[0]!);
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
