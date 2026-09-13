import { mkdir, open, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { additionalJobs, type DiscoveryResult } from "../../shared/discovery.js";
import { discoveryQueries, fetchJSearch, matchingDiscovery, queryKey } from "./jsearch.js";

export const LOCAL_MONTHLY_LIMIT = 180;
export const LOCAL_DAILY_LIMIT = 20;
const TTL = 24 * 60 * 60 * 1000;
interface Ledger { month: string; used: number; day: string; daily: number }
interface CachedPage { version: 1; at: string; rows: unknown[]; more: boolean }

export async function readJSearchKey(envFile: string): Promise<string> {
  if (process.env.OPENWEBNINJA_API_KEY?.trim()) return process.env.OPENWEBNINJA_API_KEY.trim();
  try {
    const content = await readFile(envFile, "utf8");
    const match = /^\s*OPENWEBNINJA_API_KEY\s*=\s*([^\r\n]*)/m.exec(content);
    const value = match?.[1]?.trim() ?? "";
    return /^(["']).*\1$/.test(value) ? value.slice(1, -1).trim() : value;
  } catch { return ""; }
}
export async function saveJSearchKey(envFile: string, value: unknown): Promise<void> {
  if (typeof value !== "string" || !/^[A-Za-z0-9._~+/=-]{10,300}$/.test(value.trim())) throw new Error("Paste a valid API key without spaces or quotes.");
  let content = "";
  try { content = await readFile(envFile, "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("The local credential file could not be opened."); }
  const line = "OPENWEBNINJA_API_KEY=" + value.trim();
  content = /^\s*OPENWEBNINJA_API_KEY\s*=/m.test(content) ? content.replace(/^\s*OPENWEBNINJA_API_KEY\s*=[^\r\n]*/m, () => line) : content + "\n" + line + "\n";
  await writeFile(envFile, content, { mode: 0o600 });
}
async function json(file: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("The local JSearch data file is unreadable. Check it before spending more quota."); }
}
export class JSearchService {
  constructor(private options: { directory: string; getKey: () => Promise<string>; fetcher?: typeof fetch; now?: () => Date }) {}
  private now() { return this.options.now?.() ?? new Date(); }
  private async ledger(now: Date): Promise<Ledger> {
    const value = await json(join(this.options.directory, "usage.json")) as Ledger | null;
    const month = now.toISOString().slice(0, 7), day = now.toISOString().slice(0, 10);
    if (value && (!/^\d{4}-\d{2}$/.test(value.month) || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !Number.isSafeInteger(value.used) || value.used < 0 || !Number.isSafeInteger(value.daily) || value.daily < 0)) throw new Error("The local JSearch usage counter is invalid.");
    return { month, used: value?.month === month ? value.used : 0, day, daily: value?.day === day ? value.daily : 0 };
  }
  async status() {
    const ledger = await this.ledger(this.now());
    return { configured: Boolean(await this.options.getKey()), localMonthlyRequests: ledger.used, localDailyRequests: ledger.daily, monthlyLimit: LOCAL_MONTHLY_LIMIT, dailyLimit: LOCAL_DAILY_LIMIT };
  }
  async search(raw: unknown, roleId: string): Promise<DiscoveryResult> {
    const { preferences, queries } = discoveryQueries(raw, roleId);
    const key = await this.options.getKey();
    if (!key) throw new Error("Add OPENWEBNINJA_API_KEY to jobradar/.env.local and save the file.");
    await mkdir(this.options.directory, { recursive: true });
    const lockPath = join(this.options.directory, "request.lock");
    let lock;
    try { lock = await open(lockPath, "wx"); }
    catch { throw new Error("Another discovery request is active. If the app was interrupted, check that no collector is running before removing data/jsearch/request.lock."); }
    try {
      const now = this.now(), ledger = await this.ledger(now);
      const result: DiscoveryResult = { jobs: [], queries: [], warnings: [], requestsUsed: 0, localMonthlyRequests: ledger.used, generatedAt: now.toISOString() };
      for (const query of queries) {
        const cacheFile = join(this.options.directory, queryKey(query) + ".json");
        const old = await json(cacheFile) as CachedPage | null;
        const cacheValid = Boolean(old?.version === 1 && Array.isArray(old.rows) && Number.isFinite(Date.parse(old.at)) && now.getTime() >= Date.parse(old.at) && now.getTime() - Date.parse(old.at) < TTL);
        let page: CachedPage;
        if (cacheValid) page = old!;
        else {
          if (ledger.used >= LOCAL_MONTHLY_LIMIT || ledger.daily >= LOCAL_DAILY_LIMIT) { result.warnings.push("Local request budget reached. Cached searches remain available; this is separate from your provider's account quota."); break; }
          // Reserve quota durably before issuing a request; crashes and failures count.
          ledger.used++; ledger.daily++; result.requestsUsed++;
          await writeFile(join(this.options.directory, "usage.json"), JSON.stringify(ledger));
          try {
            const response = await fetchJSearch(query, key, this.options.fetcher);
            page = { version: 1, at: now.toISOString(), rows: response.rows, more: Boolean(response.cursor) };
            await writeFile(cacheFile, JSON.stringify(page));
          } catch (e) { result.warnings.push((e as Error).message); break; }
        }
        const jobs = matchingDiscovery(page.rows, query, preferences, now).map(j => ({ ...j, firstSeenAt: page.at, lastSeenAt: page.at }));
        result.jobs.push(...additionalJobs(result.jobs, jobs));
        result.queries.push({ query, returned: page.rows.length, matches: jobs.length, cached: cacheValid, moreAvailable: page.more });
      }
      result.localMonthlyRequests = ledger.used;
      return result;
    } finally { await lock.close(); await unlink(lockPath); }
  }
}
