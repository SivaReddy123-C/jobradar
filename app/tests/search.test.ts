import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRoles, customRole, levelOf, matchJob, normalizePreferences, ROLE_VERSION, type SearchPreferences, type SearchableJob } from "../../shared/search.js";
import { emptyState, exportJson, importJson, normalizeState } from "../src/lib/storage.js";

const preferences = (overrides: Partial<SearchPreferences> = {}): SearchPreferences => ({
  version: 1, roles: [{ id: "accountant", label: "Accountant" }], markets: ["in"], location: "", workplace: "any", level: "any", ...overrides,
});
const job = (overrides: Partial<SearchableJob> = {}): SearchableJob => ({ title: "Senior Accountant", location: "Bengaluru, India", country: "in", ...overrides });

test("selected occupation does not expand to adjacent roles", () => {
  assert.ok(matchJob(job(), preferences()));
  for (const title of ["Account Manager", "Account Executive", "Accounting Software Engineer", "Accounting Manager"]) assert.equal(matchJob(job({ title }), preferences()), null, title);
  assert.ok(matchJob(job({ title: "Accounts Executive" }), preferences()));
});

test("role aliases support reversed specialties without mixing full-stack roles", () => {
  for (const title of ["Senior Front-End Developer", "Software Engineer — Frontend", "Frontend Software Engineer"]) assert.ok(classifyRoles(title).includes("frontend"), title);
  assert.ok(classifyRoles("Software Engineer, Backend").includes("backend"));
  assert.ok(classifyRoles("Full Stack Software Engineer").includes("fullstack"));
  assert.ok(!classifyRoles("Full-stack Engineer (frontend and backend)").includes("frontend"));
  assert.ok(!classifyRoles("Frontend Engineering Manager").includes("frontend"));
  assert.ok(!classifyRoles("Front-End Integration Engineer").includes("frontend"));
  assert.ok(!classifyRoles("Global Quality Front-End Central Quality Assurance Engineer/Sr Engineer").includes("frontend"));
});

test("nontechnical professions preserve occupation boundaries", () => {
  const examples: [string, string, boolean][] = [
    ["Registered Nurse (RN)", "nurse", true], ["Nurse Practitioner", "nurse", false],
    ["Front Desk Agent", "front-desk", true], ["Medical Front Desk Agent", "front-desk", false],
    ["Front Desk Manager", "front-desk", false], ["Front Desk Manager", "hotel-manager", true],
    ["Room Attendant", "housekeeper", true], ["Executive Housekeeper", "housekeeper", false],
    ["Math Teacher", "teacher", true], ["Teacher Assistant", "teacher", false],
    ["Warehouse Associate", "warehouse", true], ["Warehouse Manager", "warehouse", false],
    ["Electrician Apprentice", "electrician", true], ["Electrical Engineer", "electrician", false],
  ];
  for (const [title, role, expected] of examples) assert.equal(classifyRoles(title).includes(role), expected, title);
});

test("remote location never overrides the selected country", () => {
  for (const country of ["us", "gb", "other"]) assert.equal(matchJob(job({ country, location: "Remote", remote: true }), preferences()), null);
  assert.deepEqual(matchJob(job({ country: "us", markets: ["us", "in"] }), preferences())?.markets, ["in"]);
  assert.equal(matchJob(job({ markets: [] }), preferences()), null);
});

test("unsupported or incomplete saved markets require setup and never default to all", () => {
  assert.equal(normalizePreferences(preferences({ markets: [] })), null);
  assert.equal(normalizePreferences({ ...preferences(), markets: ["gb", "ae"] }), null);
  assert.equal(normalizePreferences(preferences({ roles: [] })), null);
  assert.equal(normalizePreferences({ ...preferences(), version: 99 }), null);
  assert.equal(normalizePreferences({ ...preferences(), level: "junior-ish" }), null);
  assert.equal(normalizePreferences({ ...preferences(), workplace: "from-home" }), null);
  assert.equal(normalizePreferences({ ...preferences(), location: ["Bengaluru"] }), null);
  assert.deepEqual(normalizePreferences({ ...preferences(), markets: ["us", "us", "gb"] })?.markets, ["us"]);
});

test("custom titles match normalized phrases and preserve the user choice", () => {
  const role = customRole("  Marine   Biologist  ")!;
  assert.equal(role.id, "custom:marine biologist");
  assert.equal(customRole("PM"), null);
  assert.equal(customRole("Engineer"), null);
  assert.equal(customRole("front-end developer")?.id, "frontend");
  const p = preferences({ roles: [role] });
  assert.ok(matchJob(job({ title: "Senior Marine Biologist" }), p));
  assert.equal(matchJob(job({ title: "Marine Biology Technician" }), p), null);
  assert.equal(normalizePreferences({ ...p, roles: [role, role] })?.roles.length, 1);
});

test("level, arrangement and city filters fail closed on missing evidence", () => {
  assert.ok(matchJob(job({ remote: true }), preferences({ level: "senior", workplace: "remote", location: "Pune, Bengaluru" })));
  assert.equal(matchJob(job(), preferences({ workplace: "remote" })), null);
  assert.equal(matchJob(job({ title: "Accountant" }), preferences({ level: "entry" })), null);
  assert.equal(matchJob(job(), preferences({ location: "Hyderabad" })), null);
  assert.equal(levelOf("Staff Nurse"), "unknown");
  assert.equal(levelOf("Staff Software Engineer"), "lead");
  assert.equal(levelOf("Product Manager Intern"), "intern");
});

test("outdated precomputed roles are reclassified before matching", () => {
  assert.ok(matchJob(job({ roleClassification: { version: ROLE_VERSION - 1, ids: [] } }), preferences()));
  assert.equal(matchJob(job({ roleClassification: { version: ROLE_VERSION, ids: [] } }), preferences()), null);
});

test("migration preserves resume, tracker and answers without inferring roles", () => {
  const legacy = emptyState();
  legacy.resume.basics.name = "Test Person";
  legacy.resume.skills = [{ id: "test", group: "Skills", items: "Accounting" }];
  legacy.answers[0]!.value = "Test answer";
  legacy.applications.push({ id: "test", title: "Accountant", company: "Example", url: "https://example.com/job", location: "India", source: "manual", appliedAt: "2026-09-01", status: "applied", statusChangedAt: "2026-09-01", notes: "Saved" });
  const { search: _, ...old } = legacy;
  const migrated = normalizeState(old);
  assert.deepEqual(migrated.resume, legacy.resume);
  assert.deepEqual(migrated.applications, legacy.applications);
  assert.deepEqual(migrated.answers, legacy.answers);
  assert.equal(migrated.search, null);
  migrated.search = preferences();
  assert.deepEqual(importJson(exportJson(migrated)), migrated);
});
