import { isMarket, type Market } from "./search.js";

export type YesNo = "" | "yes" | "no";
export interface ResumeAsset { id: string; name: string; mime: string; size: number; sha256: string; createdAt: string }
export interface Salary { amount: string; currency: "USD" | "INR"; period: "year" | "month" | "hour"; basis: "base" | "total" | "ctc" }
export interface MarketFacts { authorized: YesNo; sponsorship: YesNo; notice: string; salary: Salary }
export interface ScopedAnswer { id: string; question: string; value: string; market: Market; roleId: string }
export interface CandidateProfile {
  version: 1; revision: number; updatedAt: string;
  fullName: string; firstName: string; lastName: string; email: string; phone: string; location: string;
  linkedin: string; portfolio: string;
  markets: Record<Market, MarketFacts>;
  answers: ScopedAnswer[]; documents: ResumeAsset[]; resumeId: string;
}
export interface ApplicationRules { version: 1; mode: "selected" | "batch"; maxPerRun: number; excludedCompanies: string[] }
export function emptyCandidate(): CandidateProfile {
  const facts = (currency: Salary["currency"], basis: Salary["basis"]): MarketFacts => ({ authorized: "", sponsorship: "", notice: "", salary: { amount: "", currency, basis, period: "year" } });
  return { version: 1, revision: 1, updatedAt: "", fullName: "", firstName: "", lastName: "", email: "", phone: "", location: "", linkedin: "", portfolio: "",
    markets: { us: facts("USD", "base"), in: facts("INR", "ctc") }, answers: [], documents: [], resumeId: "" };
}
export function defaultRules(): ApplicationRules { return { version: 1, mode: "selected", maxPerRun: 3, excludedCompanies: [] }; }
const clean = (value: unknown, limit = 500): string => typeof value === "string" ? value.trim().slice(0, limit) : "";
export function normalizeCandidate(raw: unknown): CandidateProfile {
  const base = emptyCandidate();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<CandidateProfile>;
  if (r.version !== 1) return base;
  for (const key of ["fullName", "firstName", "lastName", "email", "phone", "location", "linkedin", "portfolio"] as const) base[key] = clean(r[key]);
  base.revision = Number.isSafeInteger(r.revision) && r.revision! > 0 ? r.revision! : 1;
  base.updatedAt = clean(r.updatedAt);
  for (const market of ["us", "in"] as const) {
    const f = r.markets?.[market];
    if (!f) continue;
    base.markets[market].authorized = ["yes", "no"].includes(f.authorized) ? f.authorized : "";
    base.markets[market].sponsorship = ["yes", "no"].includes(f.sponsorship) ? f.sponsorship : "";
    base.markets[market].notice = clean(f.notice);
    const s = f.salary;
    if (s && ["USD", "INR"].includes(s.currency) && ["year", "month", "hour"].includes(s.period) && ["base", "total", "ctc"].includes(s.basis)) {
      base.markets[market].salary = { amount: /^\d+(\.\d{1,2})?$/.test(s.amount) ? s.amount : "", currency: s.currency, period: s.period, basis: s.basis };
    }
  }
  base.answers = Array.isArray(r.answers) ? r.answers.filter(a => a && isMarket(a.market)).slice(0, 100).map(a => ({ id: clean(a.id), question: clean(a.question, 1500), value: clean(a.value, 10000), market: a.market, roleId: clean(a.roleId) || "*" })) : [];
  base.documents = Array.isArray(r.documents) ? r.documents.filter(d => d && /^[a-f0-9]{64}$/.test(d.sha256) && d.id === d.sha256 && Number.isSafeInteger(d.size) && d.size > 0 && d.size <= 2 * 1024 * 1024 && ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(d.mime)).slice(0, 3).map(d => ({ id: d.id, name: clean(d.name, 200), mime: d.mime, size: d.size, sha256: d.sha256, createdAt: clean(d.createdAt) })) : [];
  base.resumeId = base.documents.some(d => d.id === r.resumeId) ? r.resumeId! : "";
  return base;
}
export function normalizeRules(raw: unknown): ApplicationRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ApplicationRules>;
  return { version: 1, mode: r.mode === "batch" ? "batch" : "selected", maxPerRun: Math.max(1, Math.min(10, Math.floor(Number(r.maxPerRun) || 3))),
    excludedCompanies: Array.isArray(r.excludedCompanies) ? r.excludedCompanies.filter((v): v is string => typeof v === "string").map(v => v.trim()).filter(Boolean).slice(0, 100) : [] };
}
export function candidateProblems(p: CandidateProfile): string[] {
  const issues: string[] = [];
  if (!p.fullName) issues.push("Save your full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) issues.push("Save a valid email address.");
  if (!p.documents.some(d => d.id === p.resumeId)) issues.push("Choose a saved résumé.");
  return issues;
}
