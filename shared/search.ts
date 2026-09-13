/** Product search rules shared by collection, the app, and future runners. No model calls. */
export const MARKETS = { us: "USA", in: "India" } as const;
export type Market = keyof typeof MARKETS;
export const isMarket = (v: unknown): v is Market => v === "us" || v === "in";
export const ROLE_VERSION = 2;

export interface Role { id: string; label: string; family: string; aliases: string[]; exclude?: string[] }
const role = (id: string, label: string, family: string, aliases: string[], exclude?: string[]): Role =>
  ({ id, label, family, aliases, exclude });

// A deliberately explicit starting vocabulary, not a claim of universal occupation coverage.
// Custom titles remain available. Adjacent occupations are never added automatically.
export const ROLES: Role[] = [
  role("frontend", "Frontend developer", "Technology", ["frontend developer", "front end developer", "frontend engineer", "front end engineer", "ui developer", "ui engineer"], ["full stack", "fullstack"]),
  role("backend", "Backend developer", "Technology", ["backend developer", "back end developer", "backend engineer", "back end engineer"], ["full stack", "fullstack"]),
  role("fullstack", "Full-stack developer", "Technology", ["full stack developer", "fullstack developer", "full stack engineer", "fullstack engineer"]),
  role("software", "Software engineer", "Technology", ["software engineer", "software developer", "sde", "swe"], ["engineering manager", "sales engineer"]),
  role("data-analyst", "Data analyst", "Data", ["data analyst", "data analytics analyst"]),
  role("data-engineer", "Data engineer", "Data", ["data engineer", "data engineering specialist"]),
  role("data-scientist", "Data scientist", "Data", ["data scientist"]),
  role("ml-engineer", "Machine learning engineer", "Data", ["machine learning engineer", "ml engineer", "ai engineer"]),
  role("qa", "Software QA engineer", "Technology", ["qa engineer", "software test engineer", "software tester", "quality assurance engineer", "sdet"], ["manufacturing", "civil", "mechanical"]),
  role("devops", "DevOps engineer", "Technology", ["devops engineer", "dev ops engineer"]),
  role("sre", "Site reliability engineer", "Technology", ["site reliability engineer", "sre"]),
  role("it-support", "IT support specialist", "Technology", ["it support", "desktop support", "help desk technician", "helpdesk technician", "service desk analyst"]),
  role("sap-abap", "SAP ABAP developer", "Technology", ["abap developer", "abap consultant", "abap engineer"]),
  role("product-manager", "Product manager", "Product & design", ["product manager", "product management specialist"]),
  role("project-manager", "Project manager", "Operations", ["project manager", "project management specialist"]),
  role("program-manager", "Program manager", "Operations", ["program manager", "programme manager"]),
  role("business-analyst", "Business analyst", "Operations", ["business analyst", "business systems analyst"]),
  role("product-designer", "Product designer", "Product & design", ["product designer", "ux designer", "user experience designer", "ui ux designer"]),
  role("graphic-designer", "Graphic designer", "Product & design", ["graphic designer", "graphics designer"]),
  role("accountant", "Accountant", "Finance", ["accountant", "accounting associate", "accounts executive", "accounts officer"], ["account manager", "account executive"]),
  role("bookkeeper", "Bookkeeper", "Finance", ["bookkeeper", "book keeper", "bookkeeping specialist"]),
  role("financial-analyst", "Financial analyst", "Finance", ["financial analyst", "finance analyst", "fp a analyst"]),
  role("auditor", "Auditor", "Finance", ["auditor", "audit associate"]),
  role("account-executive", "Account executive", "Sales", ["account executive", "sales account executive"]),
  role("account-manager", "Account manager", "Sales", ["account manager", "key account manager"]),
  role("sales-rep", "Sales representative", "Sales", ["sales representative", "sales development representative", "business development representative", "sales executive", "business development executive"]),
  role("customer-success", "Customer success manager", "Customer service", ["customer success manager", "client success manager"]),
  role("customer-support", "Customer support representative", "Customer service", ["customer support representative", "customer service representative", "customer support associate", "customer service associate", "customer care executive", "customer support executive"]),
  role("recruiter", "Recruiter", "Human resources", ["recruiter", "talent acquisition specialist"]),
  role("hr-generalist", "HR generalist", "Human resources", ["hr generalist", "human resources generalist", "hr executive", "human resources executive"]),
  role("digital-marketer", "Digital marketing specialist", "Marketing", ["digital marketing specialist", "digital marketing executive", "digital marketer", "performance marketing specialist"]),
  role("content-writer", "Content writer", "Marketing", ["content writer", "copywriter", "copy writer"]),
  role("front-desk", "Hotel front-desk agent", "Hospitality", ["front desk agent", "front office associate", "guest service agent", "guest services agent", "hotel receptionist", "front desk associate"], ["manager", "supervisor", "dental", "medical", "clinic"]),
  role("hotel-manager", "Hotel manager", "Hospitality", ["hotel manager", "hotel general manager", "front office manager", "front desk manager"]),
  role("housekeeper", "Housekeeper", "Hospitality", ["housekeeper", "room attendant", "housekeeping attendant"], ["executive", "manager", "supervisor"]),
  role("cook", "Cook / chef", "Hospitality", ["cook", "chef", "commis"], ["chef de projet", "chef de produit"]),
  role("nurse", "Registered nurse", "Healthcare", ["registered nurse", "staff nurse", "rn"], ["nurse practitioner", "nursing assistant", "nurse manager"]),
  role("nurse-practitioner", "Nurse practitioner", "Healthcare", ["nurse practitioner", "advanced practice nurse"]),
  role("medical-assistant", "Medical assistant", "Healthcare", ["medical assistant"], ["physician assistant"]),
  role("pharmacist", "Pharmacist", "Healthcare", ["pharmacist"], ["technician"]),
  role("teacher", "Teacher", "Education", ["teacher", "school educator"], ["assistant", "aide"]),
  role("teaching-assistant", "Teaching assistant", "Education", ["teaching assistant", "teacher assistant", "teacher aide"]),
  role("mechanical-engineer", "Mechanical engineer", "Engineering", ["mechanical engineer", "mechanical design engineer"]),
  role("civil-engineer", "Civil engineer", "Engineering", ["civil engineer", "civil design engineer"]),
  role("electrical-engineer", "Electrical engineer", "Engineering", ["electrical engineer", "electrical design engineer"]),
  role("electrician", "Electrician", "Skilled trades", ["electrician"]),
  role("warehouse", "Warehouse associate", "Logistics", ["warehouse associate", "warehouse operative", "warehouse worker", "warehouse assistant", "fulfillment associate"], ["manager", "supervisor"]),
  role("driver", "Delivery driver", "Logistics", ["delivery driver", "delivery executive", "delivery partner"]),
  role("retail", "Retail sales associate", "Retail", ["retail sales associate", "retail associate", "store associate", "shop assistant"]),
  role("admin", "Administrative assistant", "Administration", ["administrative assistant", "admin assistant", "office assistant"], ["executive assistant"]),
  role("executive-assistant", "Executive assistant", "Administration", ["executive assistant"]),
];

export function words(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
const phrase = (text: string, term: string) => ` ${text} `.includes(` ${words(term)} `);
export interface RoleChoice { id: string; label: string }
export function customRole(label: string): RoleChoice | null {
  const clean = label.trim().replace(/\s+/g, " ").slice(0, 80);
  const normalized = words(clean);
  if (normalized.length < 3 || ["pm", "manager", "engineer", "developer", "analyst"].includes(normalized)) return null;
  const known = ROLES.find((r) => words(r.label) === normalized || r.aliases.some((a) => words(a) === normalized));
  return known ? { id: known.id, label: known.label } : { id: `custom:${normalized}`, label: clean };
}
export function classifyRoles(title: string): string[] {
  const text = words(title);
  const specialty: Record<string, string[]> = {
    frontend: ["frontend", "front end"], backend: ["backend", "back end"], fullstack: ["full stack", "fullstack"],
  };
  return ROLES.filter((r) => {
    const explicit = r.aliases.some((a) => phrase(text, a));
    // ATS titles commonly put the specialty last: "Software Engineer — Frontend".
    const reversed = specialty[r.id]?.some((a) => phrase(text, a)) && /\b(engineer|developer)\b/.test(text) && /\b(software|web|platform|ui)\b/.test(text);
    if (specialty[r.id] && /\b(quality|qa|test|verification|asic|rtl|hardware|semiconductor|silicon|manufacturing)\b/.test(text)) return false;
    return (explicit || reversed) && !r.exclude?.some((a) => phrase(text, a));
  }).map((r) => r.id);
}
export const LEVELS = { any: "Any level", entry: "Entry level", mid: "Mid level", senior: "Senior", lead: "Lead / staff / principal", manager: "Management", intern: "Internship" } as const;
export const WORKPLACES = { any: "Any work arrangement", remote: "Remote", hybrid: "Hybrid", onsite: "On-site" } as const;
export interface SearchPreferences {
  version: 1;
  roles: RoleChoice[];
  markets: Market[];
  location: string;
  level: keyof typeof LEVELS;
  workplace: keyof typeof WORKPLACES;
}

/** Invalid/legacy profiles require setup; never broaden a saved search as a fallback. */
export function normalizePreferences(raw: unknown): SearchPreferences | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.roles) || !Array.isArray(r.markets)) return null;
  if (r.level !== undefined && (typeof r.level !== "string" || !Object.hasOwn(LEVELS, r.level))) return null;
  if (r.workplace !== undefined && (typeof r.workplace !== "string" || !Object.hasOwn(WORKPLACES, r.workplace))) return null;
  if (r.location !== undefined && typeof r.location !== "string") return null;
  const roles: RoleChoice[] = [];
  for (const item of r.roles) {
    if (!item || typeof item !== "object") continue;
    const known = ROLES.find((x) => x.id === item.id);
    const choice = known ? { id: known.id, label: known.label }
      : typeof item.id === "string" && item.id.startsWith("custom:") && typeof item.label === "string" ? customRole(item.label) : null;
    if (choice && !roles.some((x) => x.id === choice.id)) roles.push(choice);
  }
  const markets = [...new Set(r.markets.filter(isMarket))];
  if (!roles.length || !markets.length) return null;
  return { version: 1, roles: roles.slice(0, 20), markets,
    location: typeof r.location === "string" ? r.location.trim().slice(0, 200) : "",
    level: typeof r.level === "string" && Object.hasOwn(LEVELS, r.level) ? r.level as SearchPreferences["level"] : "any",
    workplace: typeof r.workplace === "string" && Object.hasOwn(WORKPLACES, r.workplace) ? r.workplace as SearchPreferences["workplace"] : "any" };
}

export interface SearchableJob {
  title: string; location: string; country: string;
  markets?: Market[]; remote?: boolean | null; workplace?: "remote" | "hybrid" | "onsite" | null;
  roleClassification?: { version: number; ids: string[] };
}
export function workplaceOf(job: Pick<SearchableJob, "location" | "remote" | "workplace">): SearchPreferences["workplace"] | "unknown" {
  if (job.workplace) return job.workplace;
  if (/\bhybrid\b/i.test(job.location)) return "hybrid";
  if (job.remote === true || /\bremote\b|work from home/i.test(job.location)) return "remote";
  if (job.remote === false || /\bon[ -]?site\b/i.test(job.location)) return "onsite";
  return "unknown";
}
export function levelOf(title: string): SearchPreferences["level"] | "unknown" {
  const t = words(title);
  if (/\b(intern|internship|trainee|apprentice)\b/.test(t)) return "intern";
  if (/\b(manager|director|head|vp|vice president|chief)\b/.test(t)) return "manager";
  if (/\b(lead|principal|distinguished)\b/.test(t) || /\bstaff (software |data |product )?(engineer|developer|designer|scientist)\b/.test(t)) return "lead";
  if (/\b(senior|sr|iii|iv)\b/.test(t)) return "senior";
  if (/\b(junior|jr|entry|graduate|fresher|freshers)\b/.test(t)) return "entry";
  if (/\b(mid|intermediate|ii)\b/.test(t)) return "mid";
  return "unknown";
}
export function matchJob(job: SearchableJob, preferences: SearchPreferences): { roles: string[]; markets: Market[] } | null {
  const knownMarkets = job.markets ?? (isMarket(job.country) ? [job.country] : []);
  const markets = preferences.markets.filter((m) => knownMarkets.includes(m));
  if (!markets.length) return null;
  const ids = job.roleClassification?.version === ROLE_VERSION ? job.roleClassification.ids : classifyRoles(job.title);
  const title = words(job.title);
  const roles = preferences.roles.filter((r) => r.id.startsWith("custom:") ? phrase(title, r.label) : ids.includes(r.id)).map((r) => r.label);
  if (!roles.length) return null;
  if (preferences.level !== "any" && levelOf(job.title) !== preferences.level) return null;
  if (preferences.workplace !== "any" && workplaceOf(job) !== preferences.workplace) return null;
  const locations = preferences.location.split(/[,;]/).map(words).filter(Boolean);
  if (locations.length && !locations.some((l) => phrase(words(job.location), l))) return null;
  return { roles, markets };
}
