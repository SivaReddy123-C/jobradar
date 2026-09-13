import type { SearchableJob, SearchPreferences, Market } from "./search.js";
import { ashbyUrl } from "./applications.js";

export interface DiscoveryJob extends SearchableJob {
  key: string; company: string; country: Market; url: string; source: "jsearch";
  publishedAt: string | null; firstSeenAt: string; lastSeenAt: string;
  ghost: { score: number; band: "low" | "medium" | "high" | "critical"; reasons: string[] };
  sponsorship: "unknown"; hasSalaryInfo: boolean;
  discovery: { provider: "JSearch"; publisher: string; originalUrl: string; direct: boolean };
}
export interface DiscoveryQuery { roleId: string; role: string; market: Market; query: string; remote: boolean }
export interface DiscoveryResult {
  jobs: DiscoveryJob[]; queries: { query: DiscoveryQuery; returned: number; matches: number; cached: boolean; moreAvailable: boolean }[];
  warnings: string[]; requestsUsed: number; localMonthlyRequests: number; generatedAt: string;
}
export interface DiscoveryRequest { preferences: SearchPreferences; roleId: string }

/** Preserve identity-bearing parameters; remove only known tracking parameters. */
export function canonicalJobUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".") || u.hostname === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) return null;
    const ashby = ashbyUrl(value); if (ashby) return ashby.toLowerCase();
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_.*|gclid|fbclid|trk|trackingid|refid)$/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return u.href.replace(/\/$/, "");
  } catch { return null; }
}
export function additionalJobs<T extends { key: string; url: string }>(base: T[], extra: T[]): T[] {
  const keys = new Set(base.map(j => j.key)), urls = new Set(base.map(j => canonicalJobUrl(j.url)).filter(Boolean));
  return extra.filter(j => {
    const url = canonicalJobUrl(j.url);
    if (!url || keys.has(j.key) || urls.has(url)) return false;
    keys.add(j.key); urls.add(url); return true;
  });
}
