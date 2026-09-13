import { matchJob, words, type Market, type SearchableJob, type SearchPreferences } from "./search.js";
import { candidateProblems, type ApplicationRules, type CandidateProfile, type ResumeAsset } from "./candidate.js";

export interface QueueJob extends SearchableJob { key: string; company: string; url: string; source: string }
export type QueueStatus = "queued" | "inspecting" | "ready" | "needs_attention" | "submitting" | "confirmed" | "submission_uncertain" | "stopped";
export interface FieldSpec { id: string; label: string; type: string; required: boolean; options: string[] }
export interface Assignment { field: FieldSpec; value: string; source: string }
export interface ApplicationPlan { assignments: Assignment[]; missing: string[]; skipped: string[] }
export interface QueueEntry {
  id: string; job: QueueJob; market: Market | ""; roleIds: string[]; status: QueueStatus; updatedAt: string;
  profileRevision?: number; profileSnapshotId?: string; resumeId?: string; plan?: ApplicationPlan; message?: string; evidence?: { url: string; text: string; at: string };
}
export function ashbyUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.hostname !== "jobs.ashbyhq.com" || u.port || u.username || u.password) return null;
    const m = /^\/([a-z0-9_-]+)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/application)?\/?$/i.exec(u.pathname);
    return m ? "https://jobs.ashbyhq.com/" + m[1] + "/" + m[2]!.toLowerCase() + "/application" : null;
  } catch { return null; }
}
export function queueId(url: string): string | null { return ashbyUrl(url)?.toLowerCase() ?? null; }
export function addQueueJob(entries: QueueEntry[], job: QueueJob, preferences: SearchPreferences): QueueEntry[] {
  const id = queueId(job.url), match = matchJob(job, preferences);
  if (!id || job.source !== "ashby" || !match || entries.some(e => e.id === id)) return entries;
  const roleIds = preferences.roles.filter(r => match.roles.includes(r.label)).map(r => r.id);
  return [...entries, { id, job: { ...job, url: ashbyUrl(job.url)! }, market: match.markets.length === 1 ? match.markets[0]! : "", roleIds, status: "queued", updatedAt: new Date().toISOString() }];
}
export function queueProblems(entry: QueueEntry, p: CandidateProfile, preferences: SearchPreferences, rules: ApplicationRules): string[] {
  const issues = candidateProblems(p);
  if (!ashbyUrl(entry.job.url) || entry.job.source !== "ashby") issues.push("Unsupported application URL.");
  const match = matchJob(entry.job, preferences);
  if (!match || !entry.market || !match.markets.includes(entry.market)) issues.push("Choose a market that still matches your search and this job.");
  const selectedRoleIds = preferences.roles.filter(r => match?.roles.includes(r.label)).map(r => r.id);
  if (!entry.roleIds?.length || entry.roleIds.some(id => !selectedRoleIds.includes(id))) issues.push("The role context changed. Remove this item and queue it again.");
  if (rules.excludedCompanies.some(c => words(c) === words(entry.job.company))) issues.push("This company is excluded by your rules.");
  if (["submitting", "confirmed", "submission_uncertain", "inspecting"].includes(entry.status)) issues.push("This application cannot be retried automatically.");
  return issues;
}
export function recoverEntry(entry: QueueEntry): QueueEntry {
  if (entry.status === "submitting") return { ...entry, status: "submission_uncertain", message: "The runner stopped after submission began. Check the employer receipt before any further action." };
  if (entry.status === "inspecting") return { ...entry, status: "needs_attention", message: "Preparation was interrupted before submission. Inspect again." };
  return entry;
}
function normalizedQuestion(value: string): string { return words(value).replace(/\b(required|optional)\b/g, "").trim(); }
function standardAnswer(field: FieldSpec, p: CandidateProfile, market: Market): { value: string; source: string } | null {
  const q = normalizedQuestion(field.label);
  const contacts: Record<string, keyof Pick<CandidateProfile, "fullName" | "firstName" | "lastName" | "email" | "phone" | "location" | "linkedin" | "portfolio">> = {
    name: "fullName", "full name": "fullName", "your name": "fullName", "first name": "firstName", "given name": "firstName", "last name": "lastName", surname: "lastName",
    email: "email", "email address": "email", phone: "phone", "phone number": "phone", "mobile number": "phone", "current location": "location", location: "location",
    "linkedin url": "linkedin", linkedin: "linkedin", "linkedin profile": "linkedin", "portfolio url": "portfolio", "personal website": "portfolio",
  };
  const key = contacts[q];
  if (key) return { value: p[key], source: "Candidate profile · " + key };
  if (field.type === "file" && ["resume", "cv", "resume cv"].includes(q)) return { value: p.resumeId, source: "Selected résumé · " + p.resumeId };
  const f = p.markets[market];
  const country = market === "us" ? "(?:the )?(?:united states(?: of america)?|usa|us|u s)" : "india";
  // Match the whole eligibility question: extra conditions or another country
  // need an exact saved answer, even when the opening words look familiar.
  if (new RegExp("^(?:are you (?:legally )?authorized to work in|do you have (?:the )?right to work in) " + country + "$").test(q)) {
    return { value: f.authorized === "yes" ? "Yes" : f.authorized === "no" ? "No" : "", source: market.toUpperCase() + " work authorization" };
  }
  if (new RegExp("^(?:will you|do you) (?:(?:now or in the future|now or at any time in the future) )?(?:require|need) (?:visa |employment |work visa )?sponsorship(?: (?:now or in the future|for employment|to work))?(?: in " + country + ")?$").test(q)) {
    return { value: f.sponsorship === "yes" ? "Yes" : f.sponsorship === "no" ? "No" : "", source: market.toUpperCase() + " sponsorship answer" };
  }
  if (["notice period", "what is your notice period"].includes(q)) return { value: f.notice, source: market.toUpperCase() + " notice period" };
  if (/\b(salary|compensation|ctc)\b/.test(q)) {
    const salary = f.salary;
    const currency = /\b(usd|us dollars)\b/.test(q) ? "USD" : /\b(inr|rupees)\b/.test(q) ? "INR" : null;
    const period = /\b(annual|annually|year|yearly)\b/.test(q) ? "year" : /\b(month|monthly)\b/.test(q) ? "month" : /\b(hour|hourly)\b/.test(q) ? "hour" : null;
    const basis = /\bctc\b/.test(q) ? "ctc" : /\bbase\b/.test(q) ? "base" : /\btotal\b/.test(q) ? "total" : null;
    if (currency === salary.currency && period === salary.period && basis === salary.basis) return { value: salary.amount, source: market.toUpperCase() + " salary · " + [currency, period, basis].join(" / ") };
  }
  return null;
}
export function buildPlan(fields: FieldSpec[], profile: CandidateProfile, entry: QueueEntry): ApplicationPlan {
  const plan: ApplicationPlan = { assignments: [], missing: [], skipped: [] };
  if (!entry.market) return { ...plan, missing: ["Choose an application market."] };
  for (const field of fields) {
    const q = normalizedQuestion(field.label);
    const answers = profile.answers.filter(a => a.market === entry.market && (a.roleId === "*" || entry.roleIds.includes(a.roleId)) && normalizedQuestion(a.question) === q && a.value);
    const values = [...new Set(answers.map(a => a.value))];
    let answer = values.length === 1 ? { value: values[0]!, source: "Saved exact question · " + answers[0]!.id } : values.length > 1 ? null : standardAnswer(field, profile, entry.market);
    if (answer && field.type === "file" && answer.value !== profile.resumeId) answer = null;
    if (answer && field.type === "number" && !/^-?\d+(\.\d+)?$/.test(answer.value)) answer = null;
    if (answer && field.options.length && !field.options.some(o => words(o) === words(answer!.value))) answer = null;
    if (answer?.value && !["unsupported", "hidden"].includes(field.type)) plan.assignments.push({ field, ...answer });
    else (field.required ? plan.missing : plan.skipped).push(field.label || "Unrecognized field " + field.id);
  }
  return plan;
}
export interface ResumeTransfer { asset: ResumeAsset; data: string }
export interface RunRequest { entries: QueueEntry[]; profile: CandidateProfile; preferences: SearchPreferences; rules: ApplicationRules; resume: ResumeTransfer; submit: boolean }
