import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilters, defaultFilters, type FeedJob } from "../src/jobs/feed.js";

test("an unassessed discovery result never sorts as the lowest posting risk", () => {
  const base: FeedJob = { key: "known", title: "Accountant", company: "Example", country: "in", location: "India", url: "https://example.com/jobs/1", source: "greenhouse", publishedAt: null, firstSeenAt: "2026-09-13", sponsorship: "unknown", hasSalaryInfo: false, ghost: { score: 50, band: "high", reasons: [] } };
  const discovery: FeedJob = { ...base, key: "discovery", source: "jsearch", ghost: { score: 0, band: "low", reasons: [] }, discovery: { provider: "JSearch", publisher: "Example", direct: true, originalUrl: base.url } };
  assert.deepEqual(applyFilters([discovery, base], defaultFilters()).map(j => j.key), ["known", "discovery"]);
});
