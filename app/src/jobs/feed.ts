/** Types and fetch/cache logic for the public jobs feed the daily Action publishes. */
import { isMarket, MARKETS, type Market } from "../../../shared/search.js";

export interface FeedJob {
  key: string;
  company: string;
  title: string;
  location: string;
  country: string;
  url: string;
  source: string;
  publishedAt: string | null;
  firstSeenAt: string;
  ghost: { score: number; band: "low" | "medium" | "high" | "critical"; reasons: string[] };
  sponsorship: "yes" | "no" | "unknown";
  hasSalaryInfo: boolean;
  /** Canonical skill/role tags extracted from the posting by the pipeline. */
  tags?: string[];
  /**
   * H-1B petitions this employer actually filed, from USCIS federal records.
   * Absent means no filings were found for that fiscal year - which is
   * evidence, not proof, that they do not sponsor.
   */
  sponsor?: { approvals: number; denials: number; fy: number; name: string } | null;
  /** The vertical this employer operates in, from the curated list. */
  industry?: string | null;
  markets?: Market[];
  remote?: boolean | null;
  workplace?: "remote" | "hybrid" | "onsite" | null;
  lastSeenAt?: string;
  roleClassification?: { version: number; ids: string[] };
}

export interface Feed {
  generatedAt: string;
  total: number;
  jobs: FeedJob[];
  warnings?: string[];
}

// Served from GitHub raw (free, CORS-enabled).
//
// Sharded by country. The single feed reached 24.6 MB, which a browser cannot
// cache - localStorage caps near 5 MB - so every refresh re-downloaded and
// re-parsed the whole file and the cache write failed silently every time.
// That is what "nothing synced and refreshed" looked like from the outside.
const BASE = import.meta.env?.DEV ? "/__feed" : "https://raw.githubusercontent.com/SivaReddy123-C/sivareddy/main/jobradar/data/feed";

/** Countries fetched when the user has expressed no preference. */
const DEFAULT_COUNTRIES = ["us", "in"];
function requestedCountries(countries?: string[]): Market[] {
  return [...new Set((countries ?? DEFAULT_COUNTRIES).map((c) => c.toLowerCase()).filter(isMarket))];
}

export interface ShardIndex {
  generatedAt: string;
  total: number;
  shards: { country: string; jobs: number; bytes: number; file: string }[];
  warnings?: string[];
}

interface Shard {
  generatedAt: string;
  country: string;
  total: number;
  sponsors: Record<string, NonNullable<FeedJob["sponsor"]>>;
  industries: Record<string, string>;
  jobs: Omit<FeedJob, "country" | "sponsor" | "industry">[];
}

// One cache entry per country, not one for the whole selection.
//
// A single blob meant adding a seventh country pushed the total past what
// localStorage would take and the ENTIRE cache was refused - so widening a
// search made the app slower, which is precisely backwards. Per shard, adding
// a country costs only that country, and one oversized shard (the US is 10MB)
// simply does not cache while every other one still does.
const SHARD_KEY = (c: string) => `jobradar.shard.v3.${c}`;
const CACHE_TTL_MS = 30 * 60 * 1000;
/** No single shard above this is worth trying to store. */
const MAX_SHARD_BYTES = 2_500_000;

interface ShardEnvelope { cachedAt: number; shard: Shard }

/** Set when a shard could not be stored, so the UI can say why. */
export let lastCacheNote = "";

function readShardCache(country: string, allowStale = false): Shard | null {
  try {
    const raw = localStorage.getItem(SHARD_KEY(country));
    if (!raw) return null;
    const env = JSON.parse(raw) as ShardEnvelope;
    if (env.shard?.country !== country || !Array.isArray(env.shard.jobs)) return null;
    return allowStale || Date.now() - env.cachedAt < CACHE_TTL_MS ? env.shard : null;
  } catch {
    // silent-ok: an unreadable cache entry is the same as a miss, and the
    // shard is about to be refetched anyway.
    return null;
  }
}

/** Drop other cached shards, oldest first, to make room. */
function evictOldestShard(except: string): boolean {
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith("jobradar.shard.v3.") || k === SHARD_KEY(except)) continue;
    try {
      const env = JSON.parse(localStorage.getItem(k) ?? "{}") as ShardEnvelope;
      if (env.cachedAt < oldestAt) { oldestAt = env.cachedAt; oldestKey = k; }
    } catch {
      // silent-ok: unparseable entry - evicting it is exactly what we want.
      oldestKey = k; oldestAt = 0;
    }
  }
  if (!oldestKey) return false;
  localStorage.removeItem(oldestKey);
  return true;
}

function writeShardCache(country: string, shard: Shard): void {
  const body = JSON.stringify({ cachedAt: Date.now(), shard });
  if (body.length > MAX_SHARD_BYTES) {
    lastCacheNote = `${country.toUpperCase()} is too large to keep offline `
      + `(${(body.length / 1048576).toFixed(1)}MB); it reloads each time.`;
    return;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(SHARD_KEY(country), body);
      return;
    } catch {
      // silent-ok: quota is expected here; we handle it by evicting and
      // retrying, and report below if that does not work.
      if (!evictOldestShard(country)) break;
    }
  }
  lastCacheNote = "Browser storage is full; some countries reload each time.";
}

/** Remove cache entries written by older versions of this code. */
function dropLegacyCaches(): void {
  for (const k of ["jobradar.feed.v1", "jobradar.feed.v2"]) {
    try {
      localStorage.removeItem(k);
    } catch {
      // silent-ok: nothing depends on the old key going away.
    }
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function loadIndex(): Promise<ShardIndex> {
  const index = await getJson<ShardIndex>(`${BASE}/index.json`);
  const shards = index.shards.filter((s) => isMarket(s.country));
  return { ...index, shards, total: shards.reduce((n, s) => n + s.jobs, 0) };
}

/** Re-attach what the shard hoisted out, so callers still see whole jobs. */
function expand(shard: Shard): FeedJob[] {
  return shard.jobs.map((j) => ({
    ...j,
    country: shard.country,
    sponsor: shard.sponsors[j.company] ?? null,
    industry: shard.industries[j.company] ?? null,
  }) as FeedJob);
}

/** Whatever is already cached for these countries, without touching the network. */
export function readCache(countries?: string[]): { feed: Feed } | null {
  const want = requestedCountries(countries);
  const jobs: FeedJob[] = [];
  let generatedAt = "";
  for (const c of want) {
    const shard = readShardCache(c);
    if (!shard) continue;
    jobs.push(...expand(shard));
    if (!generatedAt || shard.generatedAt < generatedAt) generatedAt = shard.generatedAt;
  }
  const unique = [...new Map(jobs.map((j) => [j.key, j])).values()];
  return unique.length > 0 ? { feed: { generatedAt, total: unique.length, jobs: unique } } : null;
}

export async function loadFeed(force = false, countries?: string[]): Promise<Feed> {
  dropLegacyCaches();
  lastCacheNote = "";
  const want = requestedCountries(countries);
  if (!want.length) throw new Error("Choose USA or India to load jobs.");

  const index = await loadIndex();
  const available = new Set(index.shards.map((s) => s.country));
  const targets = want.filter((c) => available.has(c));
  const warnings = [...(index.warnings ?? []), ...want.filter((c) => !available.has(c)).map((c) => `No published feed for ${MARKETS[c]} in this snapshot.`)];
  if (targets.length === 0) return { generatedAt: index.generatedAt, total: 0, jobs: [], warnings };

  const failed: string[] = [];
  const dates: string[] = [];
  const results = await Promise.all(targets.map(async (c) => {
    if (!force) {
      const hit = readShardCache(c);
      if (hit) { dates.push(hit.generatedAt); return expand(hit); }
    }
    try {
      const shard = await getJson<Shard>(`${BASE}/${c}.json`);
      if (shard.country !== c) throw new Error("Unexpected feed country");
      dates.push(shard.generatedAt);
      writeShardCache(c, shard);
      return expand(shard);
    } catch {
      // silent-ok per shard, reported in aggregate below: one country failing
      // must not deny the user their other selected country.
      failed.push(c);
      const stale = readShardCache(c, true);
      if (stale) dates.push(stale.generatedAt);
      return stale ? expand(stale) : [];
    }
  }));
  const jobs = [...new Map(results.flat().map((j) => [j.key, j])).values()];

  if (jobs.length === 0 && failed.length) throw new Error(`Could not load ${failed.join(", ").toUpperCase()}`);
  if (failed.length > 0) {
    lastCacheNote = `Could not refresh ${failed.join(", ").toUpperCase()}; showing what loaded.`;
    warnings.push(lastCacheNote);
  }
  return { generatedAt: dates.sort()[0] ?? index.generatedAt, total: jobs.length, jobs, warnings };
}

/**
 * Stale-while-revalidate: hand back whatever is cached immediately so the UI
 * paints, then fetch in the background and call `onFresh` if the feed actually
 * changed. Nobody waits for a megabyte to download to see their list.
 */
export function loadFeedSWR(onFresh: (feed: Feed) => void, countries?: string[]): Feed | null {
  const cached = readCache(countries);
  void (async () => {
    try {
      const fresh = await loadFeed(true, countries);
      if (!cached || fresh.generatedAt !== cached.feed.generatedAt) onFresh(fresh);
    } catch {
      // silent-ok: background revalidation. The cached feed is already on
      // screen, and a foreground load reports its own failures.
    }
  })();
  return cached?.feed ?? null;
}

export type SortKey = "ghost" | "newest" | "company";

export const COUNTRY_LABELS: Record<string, string> = {
  in: "India", us: "USA", gb: "UK", de: "Germany", nl: "Netherlands",
  ae: "UAE", ca: "Canada", sg: "Singapore", au: "Australia",
  se: "Sweden", fr: "France", ie: "Ireland",
  th: "Thailand", my: "Malaysia", ph: "Philippines", id: "Indonesia",
  vn: "Vietnam", jp: "Japan", kr: "South Korea", tw: "Taiwan",
  hk: "Hong Kong", cn: "China", sa: "Saudi Arabia", qa: "Qatar",
  eg: "Egypt", il: "Israel", tr: "Turkey", za: "South Africa",
  ke: "Kenya", nz: "New Zealand", es: "Spain", it: "Italy",
  pl: "Poland", pt: "Portugal", ch: "Switzerland", dk: "Denmark",
  no: "Norway", fi: "Finland", be: "Belgium", at: "Austria",
  cz: "Czechia", ro: "Romania", br: "Brazil", mx: "Mexico",
  ar: "Argentina", cl: "Chile", co: "Colombia",
};

export interface JobFilters {
  q: string;
  country: string; // "all" or a COUNTRY_LABELS key
  hideHighGhost: boolean;
  sponsorshipOnly: boolean;
  /** Only employers with H-1B petitions on federal record. */
  sponsorsOnly: boolean;
  sort: SortKey;
}

export function defaultFilters(): JobFilters {
  return { q: "", country: "all", hideHighGhost: false, sponsorshipOnly: false, sponsorsOnly: false, sort: "ghost" };
}

export function applyFilters(jobs: FeedJob[], f: JobFilters): FeedJob[] {
  const q = f.q.trim().toLowerCase();
  let out = jobs.filter((j) => {
    if (!isMarket(j.country)) return false;
    if (f.country !== "all" && j.country !== f.country) return false;
    if (f.hideHighGhost && (j.ghost.band === "high" || j.ghost.band === "critical")) return false;
    if (f.sponsorshipOnly && j.sponsorship === "no") return false;
    if (f.sponsorsOnly && !(j.sponsor && j.sponsor.approvals > 0)) return false;
    if (q && !`${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const posted = (j: FeedJob) => j.publishedAt ?? j.firstSeenAt;
  if (f.sort === "ghost") out = out.sort((a, b) => a.ghost.score - b.ghost.score || posted(b).localeCompare(posted(a)));
  if (f.sort === "newest") out = out.sort((a, b) => posted(b).localeCompare(posted(a)));
  if (f.sort === "company") out = out.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
  return out;
}
