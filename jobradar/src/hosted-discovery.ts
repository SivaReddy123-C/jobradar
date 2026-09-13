import { discoveryQueries, fetchJSearch, matchingDiscovery, queryKey } from './jsearch.js';
import { normalizePreferences, type SearchPreferences } from '../../shared/search.js';
import { additionalJobs, type DiscoveryQuery, type DiscoveryResult } from '../../shared/discovery.js';

export interface HostedPage { key: string; at: string; rows: unknown[]; more: boolean }
export interface HostedStatus { enabled: boolean; monthlyLimit: number; dailyLimit: number; userDailyLimit: number; localMonthlyRequests: number; localDailyRequests: number; userDailyRequests: number }
export type Reservation = { kind: 'cached'; page: HostedPage } | { kind: 'reserved'; id: string } | { kind: 'busy' | 'cooldown' | 'disabled' | 'global_limit' | 'user_limit' };
export interface HostedStore {
  access(user: string): Promise<boolean>;
  status(user: string): Promise<HostedStatus>;
  restore(keys: string[]): Promise<HostedPage[]>;
  reserve(key: string, user: string): Promise<Reservation>;
  finish(key: string, id: string, rows: unknown[], more: boolean, failed: boolean): Promise<boolean>;
}
const reasons = { busy: 'This search is already running. Try again shortly to reuse its results.', cooldown: 'This search recently failed. Wait ten minutes before trying again.', disabled: 'New searches are temporarily paused. Saved results remain available.', global_limit: 'The shared search allowance has been reached. Saved results remain available.', user_limit: 'You have used your new-search allowance for today. Saved results remain available.' };
const ORIGINS = new Set(['https://sivareddy123-c.github.io', 'http://localhost:5174', 'http://127.0.0.1:5174']);

/** Cache only the posting fields used by normalization, never full descriptions or contacts. */
export function discoveryCacheRows(rows: unknown[]): unknown[] {
  const fields = ['job_id','job_title','employer_name','job_country','job_location','job_city','job_state','job_apply_link','job_publisher','job_posted_at_datetime_utc','job_offer_expiration_datetime_utc','job_expiration_datetime_utc','job_is_remote','job_apply_is_direct','job_min_salary','job_max_salary','job_salary'];
  return rows.slice(0, 100).map(row => {
    const source = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    const value: Record<string, unknown> = {};
    for (const field of fields) { const v = source[field]; if (typeof v === 'string') value[field] = v.slice(0, 5000); else if (typeof v === 'boolean' || typeof v === 'number') value[field] = v; }
    if (Array.isArray(source.apply_options)) value.apply_options = source.apply_options.slice(0, 10).flatMap(option => {
      if (!option || typeof option !== 'object') return [];
      const o = option as Record<string, unknown>;
      return [{ publisher: typeof o.publisher === 'string' ? o.publisher.slice(0, 500) : '', apply_link: typeof o.apply_link === 'string' ? o.apply_link.slice(0, 5000) : '', is_direct: o.is_direct === true }];
    });
    return value;
  });
}

export function hostedDiscoveryHandler(options: { store: HostedStore; authenticate: (token: string) => Promise<string | null>; getKey: () => string; fetcher?: typeof fetch; now?: () => Date }) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin') ?? '';
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin', ...(ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } : {}) };
    const respond = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
    if (!ORIGINS.has(origin)) return respond(403, { error: 'This origin is not supported.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return respond(405, { error: 'Use POST.' });
    const token = /^Bearer (.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return respond(401, { error: 'Sign in to search more job sites.' });
    try {
      const user = await options.authenticate(token);
      if (!user) return respond(401, { error: 'Sign in with a confirmed account to search more job sites.' });
      if (!await options.store.access(user)) return respond(429, { error: 'Too many requests. Please wait a minute.' });
      const reader = request.body?.getReader();
      if (!reader) return respond(400, { error: 'A request body is required.' });
      let length = 0; const chunks: Uint8Array[] = [];
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > 12000) { await reader.cancel(); return respond(413, { error: 'Request too large.' }); } chunks.push(chunk.value); }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { return respond(400, { error: 'Invalid request JSON.' }); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return respond(400, { error: 'Invalid request.' });
      const status = await options.store.status(user);
      if (payload.action === 'status') return respond(200, { ...status, configured: Boolean(options.getKey()), hosted: true });
      if (!['search','restore'].includes(String(payload.action))) return respond(400, { error: 'Unsupported discovery action.' });
      const preferences = normalizePreferences(payload.preferences);
      if (!preferences) return respond(400, { error: 'Choose your roles and USA or India first.' });
      if (payload.action === 'search' && !preferences.roles.some(r => r.id === payload.roleId)) return respond(400, { error: 'Choose one of your selected roles.' });
      const selected = payload.action === 'restore' ? preferences.roles : preferences.roles.filter(r => r.id === payload.roleId);
      const now = options.now?.() ?? new Date();
      const result: DiscoveryResult = { jobs: [], queries: [], warnings: [], requestsUsed: 0, localMonthlyRequests: status.localMonthlyRequests, generatedAt: now.toISOString() };
      const add = (page: HostedPage, query: DiscoveryQuery, scoped: SearchPreferences, cached: boolean) => {
        const jobs = matchingDiscovery(page.rows, query, scoped, now).map(j => ({ ...j, firstSeenAt: page.at, lastSeenAt: page.at }));
        result.jobs.push(...additionalJobs(result.jobs, jobs));
        result.queries.push({ query, returned: page.rows.length, matches: jobs.length, cached, moreAvailable: page.more });
      };
      if (payload.action === 'restore') {
        const scopes = selected.map(r => discoveryQueries(preferences, r.id));
        const pages = new Map((await options.store.restore(scopes.flatMap(s => s.queries.map(queryKey)))).map(p => [p.key, p]));
        for (const scoped of scopes) for (const query of scoped.queries) { const page = pages.get(queryKey(query)); if (page) add(page, query, scoped.preferences, true); }
        return respond(200, result);
      }
      const key = options.getKey();
      if (!key) return respond(503, { error: 'Additional job search is not configured yet.' });
      const scoped = discoveryQueries(preferences, selected[0]!.id);
      for (const query of scoped.queries) {
        const hash = queryKey(query), reservation = await options.store.reserve(hash, user);
        if (reservation.kind === 'cached') { add(reservation.page, query, scoped.preferences, true); continue; }
        if (reservation.kind !== 'reserved') { result.warnings.push(reasons[reservation.kind]); break; }
        result.requestsUsed++; result.localMonthlyRequests++;
        try {
          const response = await fetchJSearch(query, key, options.fetcher);
          const rows = discoveryCacheRows(response.rows);
          if (!await options.store.finish(hash, reservation.id, rows, Boolean(response.cursor), false)) throw new Error('Search result could not be saved. No automatic retry was made.');
          add({ key: hash, at: now.toISOString(), rows, more: Boolean(response.cursor) }, query, scoped.preferences, false);
        } catch (e) {
          await options.store.finish(hash, reservation.id, [], false, true);
          result.warnings.push((e as Error).message); break;
        }
      }
      return respond(200, result);
    } catch {
      return respond(503, { error: 'Additional job search is temporarily unavailable. Your existing jobs are still available.' });
    }
  };
}
