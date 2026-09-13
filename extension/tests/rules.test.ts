import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCandidate, normalizeCandidate, defaultRules } from "../../shared/candidate.js";
import { addQueueJob, ashbyUrl, buildPlan, queueProblems, recoverEntry, type QueueEntry, type FieldSpec } from "../../shared/applications.js";
import type { SearchPreferences } from "../../shared/search.js";
const prefs: SearchPreferences = { version: 1, roles: [{ id: "software", label: "Software engineer" }], markets: ["us"], location: "", level: "any", workplace: "any" };
const url = "https://jobs.ashbyhq.com/example/11111111-1111-4111-8111-111111111111";
const entry = (): QueueEntry => addQueueJob([], { key: "job", company: "Example", title: "Software Engineer", url, country: "us", location: "USA", source: "ashby" }, prefs)[0]!;
const field = (label: string, type = "text", options: string[] = []): FieldSpec => ({ id: label, label, type, options, required: true });
function candidate() {
  const p = emptyCandidate(); p.fullName = "Test Candidate"; p.firstName = "Test"; p.lastName = "Candidate"; p.email = "test@example.invalid";
  p.resumeId = "a".repeat(64); p.documents = [{ id: p.resumeId, sha256: p.resumeId, name: "test.pdf", mime: "application/pdf", size: 12, createdAt: "2026-09-13" }];
  return p;
}
test("Ashby URL validation binds host and job ID, rejects lookalikes and other domains", () => {
  assert.equal(ashbyUrl(url + "?utm_source=test"), url + "/application");
  for (const wrong of ["https://jobs.ashbyhq.com.evil.test/a/b", "http://jobs.ashbyhq.com/example/11111111-1111-4111-8111-111111111111", url + "/other", "https://other.test", "javascript:alert(1)"]) assert.equal(ashbyUrl(wrong), null);
});
test("query strings and application URL variants cannot create duplicate queue entries", () => {
  const a = entry(); assert.equal(addQueueJob([a], { ...a.job, url: url + "?source=x" }, prefs).length, 1);
});
test("name is never used for company name or an unrelated question", () => {
  const result = buildPlan([field("Name"), field("First name"), field("Company name"), field("Manager's name")], candidate(), entry());
  assert.deepEqual(result.assignments.map(a => a.value), ["Test Candidate", "Test"]); assert.equal(result.missing.length, 2);
});
test("market-specific eligibility is not transferred between countries", () => {
  const p = candidate(); p.markets.in.authorized = "yes";
  assert.equal(buildPlan([field("Are you authorized to work in the United States?", "yesno", ["Yes", "No"])], p, entry()).missing.length, 1);
  p.markets.us.authorized = "no";
  assert.equal(buildPlan([field("Are you authorized to work in the United States?", "yesno", ["Yes", "No"])], p, entry()).assignments[0]?.value, "No");
  assert.equal(buildPlan([field("Are you authorized to work in India?")], p, entry()).missing.length, 1);
});
test("salary matching preserves amount, currency, period and base versus CTC", () => {
  const p = candidate(); p.markets.us.salary.amount = "90000";
  assert.equal(buildPlan([field("Expected annual base salary in USD", "number")], p, entry()).assignments[0]?.value, "90000");
  for (const label of ["Salary expectation", "Expected monthly base salary in USD", "Expected annual total salary in USD", "Expected annual CTC in INR"]) assert.equal(buildPlan([field(label, "number")], p, entry()).missing.length, 1, label);
});

test("eligibility questions with other countries or extra conditions need exact answers", () => {
  const p = candidate(); p.markets.us.authorized = "yes"; p.markets.us.sponsorship = "no";
  const questions = ["Are you authorized to work in the United Kingdom?", "Are you authorized to work in the United States without sponsorship?", "Do you need visa sponsorship in India?", "Will you require sponsorship in the UK?", "Do you not need sponsorship?", "Will you require sponsorship for your spouse?"];
  for (const question of questions) assert.equal(buildPlan([field(question, "yesno", ["Yes", "No"])], p, entry()).missing.length, 1, question);
  assert.equal(buildPlan([field("Will you now or in the future require visa sponsorship?", "yesno", ["Yes", "No"])], p, entry()).assignments[0]?.value, "No");
  assert.equal(buildPlan([field("Do you need sponsorship to work in the United States?", "yesno", ["Yes", "No"])], p, entry()).assignments[0]?.value, "No");
});
test("custom answers are exact-question, market and role scoped", () => {
  const p = candidate(); p.answers = [{ id: "one", question: "Why this company?", value: "My saved answer", market: "in", roleId: "*" }];
  assert.equal(buildPlan([field("Why this company?")], p, entry()).missing.length, 1);
  p.answers[0]!.market = "us"; p.answers[0]!.roleId = "frontend";
  assert.equal(buildPlan([field("Why this company?")], p, entry()).missing.length, 1);
  p.answers[0]!.roleId = "software";
  assert.equal(buildPlan([field("Why this company?")], p, entry()).assignments[0]?.value, "My saved answer");
  assert.equal(buildPlan([field("Why this industry?")], p, entry()).missing.length, 1);
});
test("conflicting saved answers, unavailable choices and required unknown fields block", () => {
  const p = candidate();
  p.answers = [{ id: "a", question: "Select one", value: "A", market: "us", roleId: "*" }, { id: "b", question: "Select one", value: "B", market: "us", roleId: "*" }];
  assert.equal(buildPlan([field("Select one", "select", ["A", "B"])], p, entry()).missing.length, 1);
  p.answers.pop(); assert.equal(buildPlan([field("Select one", "select", ["B"])], p, entry()).missing.length, 1);
  assert.equal(buildPlan([field("I agree to the privacy terms", "checkbox", ["Yes", "No"])], p, entry()).missing.length, 1);
});
test("resume uploads never fill cover letters, and required numbers cannot contain prose", () => {
  const p = candidate();
  assert.equal(buildPlan([field("Resume", "file")], p, entry()).assignments[0]?.value, p.resumeId);
  assert.equal(buildPlan([field("Cover letter", "file")], p, entry()).missing.length, 1);
  p.answers = [{ id: "a", question: "Experience", value: "Several thousand", market: "us", roleId: "*" }];
  assert.equal(buildPlan([field("Experience", "number")], p, entry()).missing.length, 1);
});
test("URL, changed role, market, exclusion and terminal state gates all apply", () => {
  const p = candidate(), e = entry(), rules = defaultRules();
  assert.deepEqual(queueProblems(e, p, prefs, rules), []);
  assert.ok(queueProblems({ ...e, market: "in" }, p, prefs, rules).length);
  assert.ok(queueProblems({ ...e, roleIds: ["frontend"] }, p, prefs, rules).length);
  assert.ok(queueProblems(e, p, prefs, { ...rules, excludedCompanies: ["Example"] }).length);
  for (const status of ["confirmed", "submitting", "submission_uncertain"] as const) assert.ok(queueProblems({ ...e, status }, p, prefs, rules).length);
});
test("restart after submit becomes uncertain; interrupted preparation can be inspected again", () => {
  assert.equal(recoverEntry({ ...entry(), status: "submitting" }).status, "submission_uncertain");
  assert.equal(recoverEntry({ ...entry(), status: "inspecting" }).status, "needs_attention");
  assert.equal(recoverEntry({ ...entry(), status: "confirmed" }).status, "confirmed");
});
test("candidate normalization preserves unknown eligibility and distinct compensation units", () => {
  const p = candidate(); p.markets.in.salary = { amount: "1200000", currency: "INR", basis: "ctc", period: "year" };
  const roundtrip = normalizeCandidate(JSON.parse(JSON.stringify(p)));
  assert.equal(roundtrip.markets.us.authorized, ""); assert.deepEqual(roundtrip.markets.in.salary, p.markets.in.salary);
  assert.equal(normalizeCandidate({ ...p, version: 99 }).resumeId, "");
});
