import { createHash } from "node:crypto";
import { matchJob, normalizePreferences, classifyRoles, ROLE_VERSION, type SearchPreferences, type Market } from "../../shared/search.js";
import { publicationMarkets } from "../../shared/locations.js";
import { canonicalJobUrl, type DiscoveryJob, type DiscoveryQuery } from "../../shared/discovery.js";

const text = (v: unknown, max = 500) => typeof v === "string" ? v.trim().slice(0, max) : "";
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const MAX_POSTING_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function iso(value: unknown): string | null { const s = text(value); return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null; }

export function discoveryQueries(raw: unknown, roleId: string): { preferences: SearchPreferences; queries: DiscoveryQuery[] } {
  const preferences = normalizePreferences(raw);
  const role = preferences?.roles.find(r => r.id === roleId);
  if (!preferences || !role) throw new Error("Choose one of your selected roles and USA or India first.");
  const queries = preferences.markets.map(market => ({ roleId: role.id, role: role.label, market,
    query: `${role.label} jobs in ${preferences.location ? preferences.location + ", " : ""}${market === "us" ? "United States" : "India"}`,
    remote: preferences.workplace === "remote" }));
  return { preferences: { ...preferences, roles: [role] }, queries };
}
export function queryKey(query: DiscoveryQuery): string {
  return createHash("sha256").update(JSON.stringify({ query: query.query, country: query.market, remote: query.remote, window: "month", version: 1 })).digest("hex");
}

export function parseJSearch(body: unknown): { rows: unknown[]; cursor: string } {
  const r = object(body);
  if (r.status !== "OK") throw new Error("JSearch returned an unsuccessful response. Check your subscription and quota.");
  // The current search-v2 response wraps jobs and cursor inside data.
  const d = object(r.data);
  const rows = Array.isArray(r.data) ? r.data : Array.isArray(d.jobs) ? d.jobs : null;
  if (!rows) throw new Error("JSearch returned an unfamiliar result format; the response was not treated as an empty search.");
  return { rows, cursor: text(d.cursor, 10000) };
}

export function normalizeJSearch(row: unknown, market: Market, now: Date): DiscoveryJob | null {
  const r = object(row), title = text(r.job_title), company = text(r.employer_name), id = text(r.job_id, 2000);
  if (!title || !company || !id) return null;
  const expiry = iso(r.job_offer_expiration_datetime_utc ?? r.job_expiration_datetime_utc);
  if (expiry && Date.parse(expiry) <= now.getTime()) return null;
  const publishedAt = iso(r.job_posted_at_datetime_utc);
  // Live search-v2 results can ignore date_posted=month. Enforce the window on
  // every read, including cached pages, while leaving unknown dates explicit.
  if (publishedAt && now.getTime() - Date.parse(publishedAt) > MAX_POSTING_AGE_MS) return null;
  const country = text(r.job_country).toLowerCase();
  const location = text(r.job_location) || [text(r.job_city), text(r.job_state), text(r.job_country)].filter(Boolean).join(", ");
  const markets = publicationMarkets(location, country ? [country] : undefined);
  if (!markets.includes(market)) return null;
  const options = Array.isArray(r.apply_options) ? r.apply_options.map(object) : [];
  const direct = options.find(o => o.is_direct === true && canonicalJobUrl(text(o.apply_link, 5000)));
  const primary = text(r.job_apply_link, 5000);
  const chosen = direct ? text(direct.apply_link, 5000) : primary || text(options[0]?.apply_link, 5000);
  const url = canonicalJobUrl(chosen); if (!url) return null;
  const publisher = text(direct?.publisher ?? r.job_publisher) || "Publisher not provided";
  return {
    key: "jsearch:" + createHash("sha256").update(id).digest("hex"), company, title, location,
    country: market, markets, url, source: "jsearch", publishedAt, firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(),
    remote: typeof r.job_is_remote === "boolean" ? r.job_is_remote : null,
    roleClassification: { version: ROLE_VERSION, ids: classifyRoles(title) }, sponsorship: "unknown",
    hasSalaryInfo: typeof r.job_min_salary === "number" || typeof r.job_max_salary === "number" || Boolean(text(r.job_salary)),
    // Discovery has no employer history. Do not manufacture a reassuring risk score.
    ghost: { score: 0, band: "low", reasons: ["Posting risk has not been assessed for this discovery result. Confirm availability on the employer page."] },
    discovery: { provider: "JSearch", publisher, originalUrl: chosen, direct: Boolean(direct || r.job_apply_is_direct === true) },
  };
}
export function matchingDiscovery(rows: unknown[], query: DiscoveryQuery, preferences: SearchPreferences, now: Date): DiscoveryJob[] {
  const jobs = rows.map(r => normalizeJSearch(r, query.market, now)).filter((j): j is DiscoveryJob => Boolean(j));
  return jobs.filter(j => matchJob(j, preferences));
}

export async function fetchJSearch(query: DiscoveryQuery, key: string, fetcher: typeof fetch = fetch): Promise<{ rows: unknown[]; cursor: string }> {
  if (!key.trim()) throw new Error("Add OPENWEBNINJA_API_KEY to jobradar/.env.local first.");
  const url = new URL("https://api.openwebninja.com/jsearch/search-v2");
  url.search = new URLSearchParams({ query: query.query, country: query.market, language: "en", date_posted: "month", num_pages: "1", ...(query.remote ? { work_from_home: "true" } : {}) }).toString();
  let response: Response;
  try { response = await fetcher(url, { headers: { "x-api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(25000), redirect: "error" }); }
  catch { throw new Error("JSearch could not be reached within the request limit. No automatic retry was made."); }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error("JSearch rejected access. Check the API key and activate its Free subscription in your provider account.");
    if (response.status === 429) throw new Error("JSearch's rate or account quota limit was reached. No automatic retry was made.");
    throw new Error("JSearch returned HTTP " + response.status + ". No automatic retry was made.");
  }
  try { return parseJSearch(await response.json()); } catch (e) {
    if (e instanceof SyntaxError) throw new Error("JSearch returned invalid JSON."); throw e;
  }
}
