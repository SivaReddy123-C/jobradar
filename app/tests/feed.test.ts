import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { loadFeed, readCache } from "../src/jobs/feed.js";

const oldDate = "2026-08-01T00:00:00Z";
const freshDate = "2026-09-13T00:00:00Z";
function fixture(t: TestContext, routes: Record<string, unknown>) {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key), key: (i: number) => [...memory.keys()][i] ?? null, get length() { return memory.size; } };
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const filename = String(url).split("/").at(-1)!;
    requests.push(filename);
    const body = routes[filename];
    return { ok: body !== undefined, status: body === undefined ? 503 : 200, json: async () => body } as Response;
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => { if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage"); });
  return { memory, requests };
}
function shard(country: string, generatedAt = freshDate, keys = [country]) {
  return { country, generatedAt, sponsors: {}, industries: {}, total: keys.length, jobs: keys.map((key) => ({ key, company: "Example", title: "Accountant", location: country, url: "https://example.com/job", source: "fixture" })) };
}
const index = (countries: string[]) => ({ generatedAt: freshDate, total: countries.length, shards: countries.map((country) => ({ country, jobs: 1, bytes: 20, file: `${country}.json` })) });

test("feed fetches only selected launch markets even with a legacy global index", async (t) => {
  const { requests } = fixture(t, { "index.json": index(["gb", "us", "in"]), "in.json": shard("in") });
  const feed = await loadFeed(true, ["in", "gb"]);
  assert.deepEqual(requests, ["index.json", "in.json"]);
  assert.deepEqual(feed.jobs.map((j) => j.country), ["in"]);
});

test("missing selected shard returns an explicit empty result without country fallback", async (t) => {
  const { requests } = fixture(t, { "index.json": index(["us"]) });
  const feed = await loadFeed(true, ["in"]);
  assert.equal(feed.total, 0);
  assert.ok(feed.warnings?.[0]?.includes("India"));
  assert.deepEqual(requests, ["index.json"]);
});

test("empty selection performs no request and never defaults to all", async (t) => {
  const { requests } = fixture(t, {});
  await assert.rejects(loadFeed(true, []), /Choose USA or India/);
  assert.deepEqual(requests, []);
  assert.equal(readCache([]), null);
});

test("failed refresh preserves old snapshot date and warns about cached country", async (t) => {
  const { memory } = fixture(t, { "index.json": index(["us", "in"]), "us.json": shard("us") });
  memory.set("jobradar.shard.v3.in", JSON.stringify({ cachedAt: 1, shard: shard("in", oldDate) }));
  const feed = await loadFeed(true, ["us", "in"]);
  assert.equal(feed.total, 2);
  assert.equal(feed.generatedAt, oldDate);
  assert.ok(feed.warnings?.some((w) => w.includes("Could not refresh IN")));
});

test("multi-market listings are deduplicated and collection warnings survive", async (t) => {
  fixture(t, { "index.json": { ...index(["us", "in"]), warnings: ["One board failed."] }, "us.json": shard("us", freshDate, ["same"]), "in.json": shard("in", freshDate, ["same"]) });
  const feed = await loadFeed(true, ["us", "in"]);
  assert.equal(feed.total, 1);
  assert.deepEqual(feed.warnings, ["One board failed."]);
});

test("valid empty feed is a success but a wrong-country payload is rejected", async (t) => {
  fixture(t, { "index.json": index(["in"]), "in.json": shard("in", freshDate, []) });
  assert.equal((await loadFeed(true, ["in"])).total, 0);
});

test("wrong-country response cannot populate a selected market", async (t) => {
  fixture(t, { "index.json": index(["in"]), "in.json": shard("gb") });
  await assert.rejects(loadFeed(true, ["in"]), /Could not load IN/);
});
