import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyState, normalizeState, exportJson, importJson } from "../src/lib/storage.js";
import { addQueueJob } from "../../shared/applications.js";

test("candidate and queue additions do not infer personal eligibility from legacy answers", () => {
  const old = { version: 1, resume: { basics: { name: "Legacy Name" } }, answers: [{ id: "work_auth", label: "Authorized?", value: "Yes" }], applications: [] };
  const state = normalizeState(old);
  assert.equal(state.resume.basics.name, "Legacy Name"); assert.equal(state.candidate.fullName, "");
  assert.equal(state.candidate.markets.us.authorized, ""); assert.equal(state.candidate.markets.in.authorized, "");
  assert.deepEqual(state.queue, []); assert.equal(state.answers[0]?.value, "Yes");
});
test("profile revisions, scoped answers, resume references and queue state survive export", () => {
  const s = emptyState();
  s.candidate.fullName = "Synthetic Candidate"; s.candidate.revision = 12;
  s.candidate.answers = [{ id: "answer", market: "in", roleId: "accountant", question: "Notice period", value: "30 days" }];
  s.search = { version: 1, roles: [{ id: "accountant", label: "Accountant" }], markets: ["in"], location: "", level: "any", workplace: "any" };
  s.queue = addQueueJob([], { key: "fixture", company: "Example", title: "Accountant", url: "https://jobs.ashbyhq.com/example/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", country: "in", location: "India", source: "ashby" }, s.search);
  s.queue[0]!.status = "submission_uncertain";
  const imported = importJson(exportJson(s));
  assert.deepEqual(imported, s);
});
test("invalid imported jobs are not turned into application queue entries", () => {
  const s = normalizeState({ queue: [{ id: "bad", job: { url: "https://evil.example/apply" }, status: "queued" }] });
  assert.deepEqual(s.queue, []);
});
