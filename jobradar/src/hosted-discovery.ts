import { discoveryQueries, fetchJSearch, matchingDiscovery, queryKey } from './jsearch.js';
import { normalizePreferences, type SearchPreferences } from '../../shared/search.js';
import { additionalJobs, type DiscoveryQuery, type DiscoveryResult } from '../../shared/discovery.js';
import { createHash } from 'node:crypto';

export interface HostedPage { key: string; at: string; rows: unknown[]; more: boolean; cursor?: string }
export interface HostedStatus { enabled: boolean; monthlyLimit: number; dailyLimit: number; userDailyLimit: number; localMonthlyRequests: number; localDailyRequests: number; userDailyRequests: number }
export type Reservation = { kind: 'cached'; page: HostedPage } | { kind: 'reserved'; id: string } | { kind: 'busy' | 'cooldown' | 'disabled' | 'global_limit' | 'user_limit' };
export interface HostedStore {
  access(user: string): Promise<boolean>;
  status(user: string): Promise<HostedStatus>;
  restore(keys: string[]): Promise<HostedPage[]>;
  reserve(key: string, user: string): Promise<Reservation>;
  finish(key: string, id: string, rows: unknown[], cursor: string, failed: boolean): Promise<boolean>;
}
export const MAX_DISCOVERY_PAGES = 5;
/** Separate old cursorless cache entries; provider cursors never go to clients. */
export function discoveryPageKey(query: DiscoveryQuery, cursor = ''): string {
  return createHash('sha256').update(JSON.stringify([queryKey(query), 'paginated-v1', cursor])).digest('hex');
}
interface PageChain { query: DiscoveryQuery; pages: HostedPage[]; nextKey?: string; cursor: string }
async function cachedChains(store: HostedStore, queries: DiscoveryQuery[]): Promise<PageChain[]> {
  const chains: PageChain[] = queries.map(query => ({ query, pages: [], nextKey: discoveryPageKey(query), cursor: '' }));
  // Batch each depth across markets and roles; never query an arbitrary client key.
  for (let depth = 0; depth < MAX_DISCOVERY_PAGES; depth++) {
    const active = chains.filter(c => c.nextKey && c.pages.length === depth);
    if (!active.length) break;
    const pages = new Map((await store.restore(active.map(c => c.nextKey!))).map(p => [p.key, p]));
    for (const chain of active) {
      const page = pages.get(chain.nextKey!); if (!page) continue;
      advance(chain, page);
    }
  }
  return chains;
}
function advance(chain: PageChain, page: HostedPage) {
  chain.pages.push(page); chain.cursor = page.cursor || '';
  const next = chain.cursor ? discoveryPageKey(chain.query, chain.cursor) : undefined;
  chain.nextKey = chain.pages.length < MAX_DISCOVERY_PAGES && !chain.pages.some(p => p.key === next) ? next : undefined;
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
      if (!['search','restore','more'].includes(String(payload.action))) return respond(400, { error: 'Unsupported discovery action.' });
      const preferences = normalizePreferences(payload.preferences);
      if (!preferences) return respond(400, { error: 'Choose your roles and USA or India first.' });
      if (payload.action !== 'restore' && !preferences.roles.some(r => r.id === payload.roleId)) return respond(400, { error: 'Choose one of your selected roles.' });
      if (payload.searchTerm !== undefined && (typeof payload.searchTerm !== 'string' || !preferences.roles.some(r => r.id === payload.roleId))) return respond(400, { error: 'Choose a search title belonging to your selected role.' });
      const tokens = payload.continuations;
      if (payload.action === 'more' && (!tokens || typeof tokens !== 'object' || Array.isArray(tokens) || !Object.keys(tokens).length || Object.entries(tokens).some(([market, token]) => !preferences.markets.includes(market as 'in' | 'us') || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)))) return respond(400, { error: 'Load saved results before fetching the next page.' });
      const selected = payload.action === 'restore' ? preferences.roles : preferences.roles.filter(r => r.id === payload.roleId);
      const now = options.now?.() ?? new Date();
      const result: DiscoveryResult = { jobs: [], queries: [], warnings: [], requestsUsed: 0, localMonthlyRequests: status.localMonthlyRequests, generatedAt: now.toISOString() };
      const add = (chain: PageChain, scoped: SearchPreferences, cached: boolean) => {
        if (!chain.pages.length) return;
        const jobs = chain.pages.reduce<DiscoveryResult['jobs']>((all, page) => [...all, ...additionalJobs(all, matchingDiscovery(page.rows, chain.query, scoped, now).map(j => ({ ...j, firstSeenAt: page.at, lastSeenAt: page.at })))], []);
        result.jobs.push(...additionalJobs(result.jobs, jobs));
        result.queries.push({ query: chain.query, returned: chain.pages.reduce((n,p) => n+p.rows.length, 0), matches: jobs.length, cached, moreAvailable: Boolean(chain.nextKey), pages: chain.pages.length, nextPageToken: chain.nextKey, pageLimitReached: chain.pages.length >= MAX_DISCOVERY_PAGES && Boolean(chain.cursor) });
      };
      let scopes: ReturnType<typeof discoveryQueries>[];
      try { scopes = selected.map(r => discoveryQueries(preferences, r.id, r.id === payload.roleId ? payload.searchTerm as string | undefined : undefined)); }
      catch { return respond(400, { error: 'Choose a search title belonging to your selected role.' }); }
      const chains = await cachedChains(options.store, scopes.flatMap(s => s.queries));
      if (payload.action === 'restore') {
        for (const chain of chains) add(chain, preferences, true);
        return respond(200, result);
      }
      const key = options.getKey();
      if (!key) return respond(503, { error: 'Additional job search is not configured yet.' });
      const scoped = scopes[0]!;
      let stopped = false;
      for (const chain of chains) {
        const { query } = chain;
        const token = (tokens as Record<string, string> | undefined)?.[query.market];
        if (payload.action === 'more') {
          if (!token) { add(chain, scoped.preferences, true); continue; }
          // Replaying a previously fetched page is free, including after a lost response.
          if (chain.pages.some(p => p.key === token)) { add(chain, scoped.preferences, true); continue; }
          if (!chain.pages.length || token !== chain.nextKey) { result.warnings.push('Saved search pages changed or expired. Find additional jobs again before fetching more.'); add(chain, scoped.preferences, true); continue; }
        } else if (chain.pages.length) { add(chain, scoped.preferences, true); continue; }
        if (stopped || !chain.nextKey) { add(chain, scoped.preferences, true); continue; }
        const hash = chain.nextKey, reservation = await options.store.reserve(hash, user);
        if (reservation.kind === 'cached') { advance(chain, reservation.page); add(chain, scoped.preferences, true); continue; }
        if (reservation.kind !== 'reserved') { result.warnings.push(reasons[reservation.kind]); stopped = true; add(chain, scoped.preferences, true); continue; }
        result.requestsUsed++; result.localMonthlyRequests++;
        try {
          const response = await fetchJSearch(query, key, options.fetcher, chain.cursor);
          const rows = discoveryCacheRows(response.rows);
          if (!await options.store.finish(hash, reservation.id, rows, response.cursor, false)) throw new Error('Search result could not be saved. No automatic retry was made.');
          advance(chain, { key: hash, at: now.toISOString(), rows, more: Boolean(response.cursor), cursor: response.cursor });
          add(chain, scoped.preferences, false);
        } catch (e) {
          await options.store.finish(hash, reservation.id, [], '', true);
          result.warnings.push((e as Error).message); stopped = true; add(chain, scoped.preferences, true);
        }
      }
      return respond(200, result);
    } catch {
      return respond(503, { error: 'Additional job search is temporarily unavailable. Your existing jobs are still available.' });
    }
  };
}
