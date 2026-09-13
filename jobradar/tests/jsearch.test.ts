import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { discoveryQueries, normalizeJSearch, matchingDiscovery, fetchJSearch, parseJSearch, queryKey } from "../src/jsearch.js";
import { JSearchService, saveJSearchKey, readJSearchKey } from "../src/jsearch-service.js";
import { trustedLocalRequest } from "../src/jsearch-http.js";
import { additionalJobs, canonicalJobUrl } from "../../shared/discovery.js";

const now = new Date("2026-09-13T12:00:00Z");
const preferences = { version: 1, roles: [{ id: "accountant", label: "Accountant" }], markets: ["in"], location: "", workplace: "any", level: "any" };
const row = (patch: Record<string, unknown> = {}) => ({ job_id: "fixture-1", job_title: "Accountant", employer_name: "Fixture Company", job_country: "IN", job_location: "Pune, India", job_apply_link: "https://employer.example/jobs/123?utm_source=google", job_publisher: "Employer", job_posted_at_datetime_utc: "2026-09-12T00:00:00Z", ...patch });
const ok = (rows: unknown[] = [row()]) => new Response(JSON.stringify({ status: "OK", data: { jobs: rows, cursor: "next" } }), { headers: { "content-type": "application/json" } });
async function directory(t: TestContext) {
  const root = resolve("data/jsearch"); await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "test-"));
  t.after(async () => { if (!resolve(path).startsWith(root + sep)) throw new Error("Invalid test cleanup path"); await rm(path, { recursive: true, force: true }); });
  return path;
}

test("discovery searches one selected role in selected USA/India markets only", () => {
  const value = discoveryQueries({ ...preferences, markets: ["in", "gb", "us"] }, "accountant");
  assert.deepEqual(value.queries.map(q => q.market), ["in", "us"]);
  assert.match(value.queries[0]!.query, /India$/);
  assert.throws(() => discoveryQueries(preferences, "software"), /selected roles/);
  assert.throws(() => discoveryQueries({ ...preferences, markets: ["gb"] }, "accountant"));
});
test("response validation distinguishes empty results from an unknown provider schema", () => {
  assert.equal(parseJSearch({ status: "OK", data: { jobs: [], cursor: null } }).rows.length, 0);
  assert.equal(parseJSearch({ status: "OK", data: [row()] }).rows.length, 1);
  assert.throws(() => parseJSearch({ status: "OK", data: { results: [] } }), /unfamiliar/);
  assert.throws(() => parseJSearch({ status: "ERROR", message: "private provider error" }), /unsuccessful/);
});
test("normalization rejects expired, malformed, unsafe and out-of-market listings", () => {
  for (const patch of [{ job_title: "" }, { job_id: null }, { employer_name: "" }, { job_apply_link: "javascript:alert(1)" }, { job_country: "GB" }, { job_offer_expiration_datetime_utc: "2026-09-01" }]) assert.equal(normalizeJSearch(row(patch), "in", now), null);
  assert.equal(normalizeJSearch(row({ job_country: "GB", job_location: "Pune, India" }), "in", now), null);
  const j = normalizeJSearch(row(), "in", now)!;
  assert.equal(j.sponsorship, "unknown"); assert.equal(j.source, "jsearch"); assert.equal(j.discovery.publisher, "Employer");
});
test("direct application links are preferred while identity parameters survive deduplication", () => {
  const j = normalizeJSearch(row({ apply_options: [{ publisher: "Employer", is_direct: true, apply_link: "https://employer.example/apply?job_id=456&utm_source=google" }] }), "in", now)!;
  assert.equal(j.url, "https://employer.example/apply?job_id=456"); assert.equal(j.discovery.direct, true);
  assert.notEqual(canonicalJobUrl("https://employer.example/apply?job_id=1"), canonicalJobUrl("https://employer.example/apply?job_id=2"));
});
test("local freshness rejects provider results older than 30 days without inventing missing dates", () => {
  const boundary = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  assert.equal(normalizeJSearch(row({ job_posted_at_datetime_utc: new Date(boundary - 1).toISOString() }), "in", now), null);
  assert.ok(normalizeJSearch(row({ job_posted_at_datetime_utc: new Date(boundary).toISOString() }), "in", now));
  assert.equal(normalizeJSearch(row({ job_posted_at_datetime_utc: null }), "in", now)?.publishedAt, null);
});
test("cached pages reapply the moving freshness window without another provider request", async t => {
  const dir = await directory(t); let calls = 0, current = now;
  const posted = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
  const service = new JSearchService({ directory: dir, getKey: async () => "synthetic-key", now: () => current,
    fetcher: (async () => { calls++; return ok([row({ job_posted_at_datetime_utc: posted })]); }) as typeof fetch });
  assert.equal((await service.search(preferences, "accountant")).jobs.length, 1);
  current = new Date(now.getTime() + 60 * 60 * 1000);
  const next = await service.search(preferences, "accountant");
  assert.equal(next.jobs.length, 0); assert.equal(next.requestsUsed, 0);
  assert.equal(next.queries[0]?.cached, true); assert.equal(calls, 1);
  assert.equal((await service.restore(preferences)).jobs.length, 0);
});
test("automatic restoration combines only selected cached roles and markets without keys or quota changes", async t => {
  const dir = await directory(t);
  const selected = { ...preferences, roles: [...preferences.roles, { id: "teacher", label: "Teacher" }], markets: ["in", "us"] };
  const accountantQuery = discoveryQueries(selected, "accountant").queries.find(q => q.market === "in")!;
  const teacherQuery = discoveryQueries(selected, "teacher").queries.find(q => q.market === "us")!;
  const save = (query: typeof accountantQuery, rows: unknown[]) => writeFile(join(dir, queryKey(query) + ".json"), JSON.stringify({ version: 1, at: now.toISOString(), rows, more: false }));
  await save(accountantQuery, [row(), row({ job_id: "wrong-role", job_title: "Account Executive" }), row({ job_id: "wrong-country", job_country: "US" })]);
  await save(teacherQuery, [row({ job_id: "teacher", job_title: "Teacher", job_country: "US", job_location: "Austin, TX", job_apply_link: "https://school.example/jobs/1" })]);
  const ledger = JSON.stringify({ month: "2026-09", used: 180, day: "2026-09-13", daily: 20 });
  await writeFile(join(dir, "usage.json"), ledger);
  const service = new JSearchService({ directory: dir, now: () => now,
    getKey: async () => { throw new Error("Restore must not read credentials"); },
    fetcher: (async () => { throw new Error("Restore must never request provider data"); }) as typeof fetch });
  const restored = await service.restore(selected);
  assert.deepEqual(restored.jobs.map(j => j.title), ["Accountant", "Teacher"]);
  assert.equal(restored.queries.length, 2); assert.ok(restored.queries.every(q => q.cached));
  assert.equal(restored.requestsUsed, 0); assert.equal(restored.localMonthlyRequests, 180);
  assert.equal((await service.restore(preferences)).jobs.length, 1);
  assert.equal((await service.restore({ ...preferences, level: "senior" })).jobs.length, 0);
  assert.equal(await readFile(join(dir, "usage.json"), "utf8"), ledger);
  await assert.rejects(service.restore({ ...preferences, markets: [] }), /Choose your roles/);
});
test("missing and expired cache pages never become paid searches during restoration", async t => {
  const dir = await directory(t);
  const service = new JSearchService({ directory: dir, now: () => now,
    getKey: async () => { throw new Error("No credential lookup expected"); },
    fetcher: (async () => { throw new Error("No provider request expected"); }) as typeof fetch });
  assert.equal((await service.restore(preferences)).queries.length, 0);
  const query = discoveryQueries(preferences, "accountant").queries[0]!;
  await writeFile(join(dir, queryKey(query) + ".json"), JSON.stringify({ version: 1, at: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), rows: [row()], more: true }));
  const restored = await service.restore(preferences);
  assert.equal(restored.jobs.length, 0); assert.equal(restored.queries.length, 0); assert.equal(restored.requestsUsed, 0);
  await assert.rejects(readFile(join(dir, "usage.json")), { code: "ENOENT" });
});
test("matching rejects unrelated titles despite the provider returning them for the query", () => {
  const { preferences: p, queries } = discoveryQueries(preferences, "accountant");
  const matches = matchingDiscovery([row(), row({ job_title: "Account Executive" }), row({ job_country: "US" })], queries[0]!, p, now);
  assert.equal(matches.length, 1);
});
test("duplicate URL variants are removed without merging separate requisitions", () => {
  const base = [{ key: "direct", url: "https://employer.example/jobs/123?utm_source=feed" }];
  assert.deepEqual(additionalJobs(base, [{ key: "other", url: "https://employer.example/jobs/123" }, { key: "unique", url: "https://employer.example/jobs/124" }]).map(j => j.key), ["unique"]);
  assert.equal(canonicalJobUrl("https://127.0.0.1/secret"), null);
});
test("provider requests use a server header, one page, bounded dates and no automatic retries", async () => {
  const query = discoveryQueries(preferences, "accountant").queries[0]!;
  let count = 0;
  const fetcher = (async (input, options) => {
    count++; const url = new URL(String(input));
    assert.equal(url.origin, "https://api.openwebninja.com"); assert.equal(url.pathname, "/jsearch/search-v2");
    assert.equal(url.searchParams.get("num_pages"), "1"); assert.equal(url.searchParams.get("date_posted"), "month");
    assert.equal(url.searchParams.get("country"), "in"); assert.equal(url.href.includes("synthetic-key"), false);
    assert.equal(new Headers(options?.headers).get("x-api-key"), "synthetic-key"); assert.equal(options?.redirect, "error");
    return new Response("sensitive provider error", { status: 429 });
  }) as typeof fetch;
  await assert.rejects(fetchJSearch(query, "synthetic-key", fetcher), /quota/); assert.equal(count, 1);
});
test("cached searches survive service restarts without consuming another request", async t => {
  const dir = await directory(t); let calls = 0;
  const options = { directory: dir, getKey: async () => "synthetic-key", now: () => now, fetcher: (async () => { calls++; return ok(); }) as typeof fetch };
  const first = await new JSearchService(options).search(preferences, "accountant");
  const next = await new JSearchService(options).search(preferences, "accountant");
  assert.equal(first.jobs.length, 1); assert.equal(next.requestsUsed, 0); assert.equal(next.queries[0]?.cached, true); assert.equal(calls, 1);
  assert.equal(next.localMonthlyRequests, 1);
});
test("failed requests consume the local reservation and stop remaining country requests", async t => {
  const dir = await directory(t); let calls = 0;
  const service = new JSearchService({ directory: dir, getKey: async () => "synthetic-key", now: () => now, fetcher: (async () => { calls++; return new Response("private", { status: 403 }); }) as typeof fetch });
  const result = await service.search({ ...preferences, markets: ["us", "in"] }, "accountant");
  assert.equal(calls, 1); assert.equal(result.localMonthlyRequests, 1); assert.match(result.warnings[0]!, /rejected access/); assert.equal(result.warnings.join().includes("private"), false);
});
test("daily and monthly budgets block new requests while cached searches remain available", async t => {
  const dir = await directory(t); let calls = 0;
  const service = new JSearchService({ directory: dir, getKey: async () => "synthetic-key", now: () => now, fetcher: (async () => { calls++; return ok(); }) as typeof fetch });
  await service.search(preferences, "accountant");
  await writeFile(join(dir, "usage.json"), JSON.stringify({ month: "2026-09", used: 180, day: "2026-09-13", daily: 20 }));
  assert.equal((await service.search(preferences, "accountant")).jobs.length, 1);
  const blocked = await service.search({ ...preferences, location: "Mumbai" }, "accountant");
  assert.match(blocked.warnings[0]!, /budget/); assert.equal(calls, 1);
});
test("concurrent service instances cannot spend quota for the same in-flight query", async t => {
  const dir = await directory(t); let release!: () => void; let entered!: () => void;
  const waiting = new Promise<void>(r => { entered = r; }); const gate = new Promise<void>(r => { release = r; });
  const options = { directory: dir, getKey: async () => "synthetic-key", now: () => now, fetcher: (async () => { entered(); await gate; return ok(); }) as typeof fetch };
  const first = new JSearchService(options).search(preferences, "accountant"); await waiting;
  await assert.rejects(new JSearchService(options).search(preferences, "accountant"), /active/); release(); await first;
});
test("local endpoints reject missing origin, cross-origin and rebinding host requests", () => {
  assert.equal(trustedLocalRequest({ headers: { host: "localhost:5174", origin: "http://localhost:5174", "sec-fetch-site": "same-origin" } }), true);
  for (const headers of [{ host: "localhost:5174" }, { host: "localhost:5174", origin: "https://evil.example" }, { host: "evil.example", origin: "http://evil.example" }, { host: "localhost:5174", origin: "http://localhost:5174", "sec-fetch-site": "cross-site" }]) assert.equal(trustedLocalRequest({ headers }), false);
});
test("key setup preserves unrelated settings and status never returns the secret", async t => {
  const dir = await directory(t), file = join(dir, ".env.local");
  const previous = process.env.OPENWEBNINJA_API_KEY; delete process.env.OPENWEBNINJA_API_KEY;
  t.after(() => { if (previous !== undefined) process.env.OPENWEBNINJA_API_KEY = previous; });
  await writeFile(file, "OTHER_SETTING=keep\nOPENWEBNINJA_API_KEY=old\n");
  await saveJSearchKey(file, "syntheticKey012345");
  assert.equal(await readJSearchKey(file), "syntheticKey012345"); assert.match(await readFile(file, "utf8"), /OTHER_SETTING=keep/);
  const service = new JSearchService({ directory: dir, getKey: () => readJSearchKey(file), now: () => now });
  assert.equal((await service.status()).configured, true); assert.equal(JSON.stringify(await service.status()).includes("syntheticKey"), false);
  await assert.rejects(saveJSearchKey(file, "bad\nSECOND=value"), /valid API key/);
});
