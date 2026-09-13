import { ashbyPage, type FormInspection, type PageCommand } from "./ashby.js";
import { ashbyUrl, buildPlan, queueId, queueProblems, recoverEntry, type QueueEntry, type RunRequest } from "../../shared/applications.js";
import { normalizeCandidate, normalizeRules } from "../../shared/candidate.js";
import { normalizePreferences } from "../../shared/search.js";
import { publicationMarkets } from "../../shared/locations.js";

interface RunnerState { entries: QueueEntry[]; stopped: boolean; active: boolean }
let state: RunnerState = { entries: [], stopped: true, active: false }, busy = false, preparing = false;
let stopVersion = 0;
let writes = Promise.resolve();
function persist() { writes = writes.then(() => chrome.storage.local.set({ jr_runner: structuredClone(state) })); return writes; }
const initialized = (async () => {
  const stored = (await chrome.storage.local.get("jr_runner")).jr_runner as RunnerState | undefined;
  if (stored?.entries) state = { entries: stored.entries.map(recoverEntry), stopped: true, active: false };
  await persist();
})();
function trustedApp(url?: string): boolean {
  if (!url) return false;
  const u = new URL(url);
  return u.origin === "http://127.0.0.1:5174" || u.origin === "http://localhost:5174" || u.origin === "https://sivareddy123-c.github.io" && u.pathname.startsWith("/sivareddy/");
}
async function update(entry: QueueEntry, patch: Partial<QueueEntry>) {
  Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
  await persist();
}
async function page(tabId: number, command: PageCommand): Promise<FormInspection> {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: ashbyPage, args: [command] });
  if (!results[0]?.result) throw new Error("The application tab is unavailable.");
  return results[0].result;
}
async function readyTab(tabId: number) {
  for (let i = 0; i < 50; i++) { if (state.stopped) throw new Error("Stopped before submission."); if ((await chrome.tabs.get(tabId)).status === "complete") return; await new Promise(r => setTimeout(r, 500)); }
  throw new Error("The application page did not finish loading.");
}
async function stopEntry(entry: QueueEntry): Promise<boolean> {
  if (!state.stopped) return false;
  await update(entry, { status: "stopped", message: "Stopped before submission." }); return true;
}
async function run(request: RunRequest, entries: QueueEntry[]) {
  try {
    for (const entry of entries) {
      if (await stopEntry(entry)) continue;
      let tabId: number | undefined;
      try {
        const issues = queueProblems({ ...entry, status: "queued" }, request.profile, request.preferences, request.rules);
        if (issues.length) { await update(entry, { status: "needs_attention", message: issues.join(" ") }); continue; }
        await update(entry, { status: "inspecting", message: "", profileRevision: request.profile.revision, resumeId: request.resume.asset.id });
        const tab = await chrome.tabs.create({ url: "about:blank", active: false }); tabId = tab.id!;
        await new Promise(r => setTimeout(r, 150));
        if (await stopEntry(entry)) continue;
        await chrome.tabs.update(tabId, { url: ashbyUrl(entry.job.url)! });
        await readyTab(tabId);
        const base: PageCommand = { action: "inspect", expectedUrl: ashbyUrl(entry.job.url)!, expectedTitle: entry.job.title };
        let inspection: FormInspection | undefined;
        for (let attempt = 0; attempt < 12; attempt++) {
          inspection = await page(tabId, base);
          if (inspection.fields.length) break;
          if (await stopEntry(entry)) break;
          await new Promise(r => setTimeout(r, 500));
        }
        if (await stopEntry(entry)) continue;
        if (!inspection || inspection.errors.length) throw new Error(inspection?.errors.join(" ") || "Supported form not found.");
        if (!entry.market || !publicationMarkets(inspection.location).includes(entry.market)) throw new Error("The live posting does not establish a work location in the selected country. Review it before applying.");
        const plan = buildPlan(inspection.fields, request.profile, entry);
        await update(entry, { plan });
        if (plan.missing.length) { await update(entry, { status: "needs_attention", message: "Save an exact answer for: " + plan.missing.join("; ") }); continue; }
        if (!request.submit) { await update(entry, { status: "ready", message: "Answers checked against the form. No fields filled or files uploaded." }); await chrome.tabs.remove(tabId); tabId = undefined; continue; }
        if (await stopEntry(entry)) continue;
        const command = { ...base, expectedLocation: inspection.location, signature: inspection.signature, assignments: plan.assignments, resume: request.resume };
        const filled = await page(tabId, { ...command, action: "fill" });
        if (filled.errors.length) throw new Error(filled.errors.join(" "));
        if (await stopEntry(entry)) continue;
        let validated = await page(tabId, { ...command, action: "validate" });
        for (let attempt = 0; validated.errors.length && validated.errors.every(e => /still in progress|disabled/.test(e)) && attempt < 20; attempt++) {
          if (state.stopped) break;
          await new Promise(r => setTimeout(r, 700)); validated = await page(tabId, { ...command, action: "validate" });
        }
        if (validated.errors.length) throw new Error(validated.errors.join(" "));
        if (await stopEntry(entry)) continue;
        // Durable write BEFORE the click: a restart cannot cause a second submission.
        await update(entry, { status: "submitting", message: "Submitting; awaiting confirmation." });
        if (state.stopped) { await update(entry, { status: "stopped", message: "Stopped before the submit click." }); continue; }
        const clicked = await page(tabId, { ...command, action: "submit" });
        if (clicked.errors.length) { await update(entry, { status: "needs_attention", message: clicked.errors.join(" ") }); continue; }
        let evidence: FormInspection | undefined;
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise(r => setTimeout(r, 500));
          try { evidence = await page(tabId, base); } catch { /* Navigation after submit is uncertain until confirmation is observed. */ }
          if (evidence?.confirmation) break;
        }
        if (evidence?.confirmation) await update(entry, { status: "confirmed", message: "The employer page confirmed submission.", evidence: { url: evidence.url, text: evidence.confirmation, at: new Date().toISOString() } });
        else await update(entry, { status: "submission_uncertain", message: "Submit was clicked but no supported confirmation was observed. Check the application tab and email receipt. It will not be retried automatically." });
      } catch (error) {
        await update(entry, { status: entry.status === "submitting" ? "submission_uncertain" : state.stopped ? "stopped" : "needs_attention", message: (error as Error).message });
      }
    }
  } finally { state.active = false; busy = false; await persist(); }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    await initialized;
    const fromPopup = sender.url === chrome.runtime.getURL("popup.html");
    if (!trustedApp(sender.url) && !(fromPopup && ["STATUS", "STOP"].includes(message.action))) throw new Error("This page cannot control JobRadar Assist.");
    if (message.action === "STATUS") return state;
    if (message.action === "STOP") { stopVersion++; state.stopped = true; await persist(); return state; }
    if (message.action === "ERASE") {
      if (busy || preparing || state.active) throw new Error("Stop the current run before deleting runner data.");
      const keys = Object.keys(await chrome.storage.local.get(null)).filter(k => k.startsWith("jr_"));
      await chrome.storage.local.remove(keys); state = { entries: [], stopped: true, active: false }; await persist(); return state;
    }
    if (message.action !== "RUN") throw new Error("Unsupported command.");
    if (busy || preparing || state.active) throw new Error("A run is already active. Stop it before starting another.");
    preparing = true;
    const runStopVersion = stopVersion;
    try {
    const raw = message.payload as RunRequest;
    const profile = normalizeCandidate(raw.profile), rules = normalizeRules(raw.rules), preferences = normalizePreferences(raw.preferences);
    if (!preferences || !Array.isArray(raw.entries) || !raw.entries.length || raw.entries.length > rules.maxPerRun) throw new Error("Choose a valid search and a batch within your limit.");
    const savedAsset = profile.documents.find(d => d.id === profile.resumeId);
    if (!raw.resume || raw.resume.asset?.id !== profile.resumeId || !savedAsset || typeof raw.resume.data !== "string" || raw.resume.data.length > 2800000) throw new Error("The selected résumé could not be verified.");
    const resume = { asset: savedAsset, data: raw.resume.data };
    const bytes = Uint8Array.from(atob(resume.data), c => c.charCodeAt(0));
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
    if (hash !== resume.asset.sha256 || hash !== profile.resumeId || bytes.length !== resume.asset.size) throw new Error("Résumé contents changed. Upload and select the file again.");
    const chosen: QueueEntry[] = [], ids = new Set<string>();
    for (const incoming of raw.entries) {
      if (queueId(incoming.job?.url) !== incoming.id || ids.has(incoming.id)) throw new Error("Invalid or duplicate queued job.");
      ids.add(incoming.id);
      const previous = state.entries.find(e => e.id === incoming.id);
      if (previous && ["confirmed", "submission_uncertain", "submitting", "inspecting"].includes(previous.status)) throw new Error("This job was already submitted or its outcome is uncertain.");
      const issues = queueProblems(incoming, profile, preferences, rules);
      if (issues.length) throw new Error(issues.join(" "));
      const entry = structuredClone(incoming); entry.status = "queued"; delete entry.evidence; delete entry.plan;
      chosen.push(entry);
    }
    // Keep an immutable profile and document version for audit without logging their contents.
    const runId = crypto.randomUUID();
    await chrome.storage.local.set({ ["jr_profile_" + runId]: profile, ["jr_resume_" + hash]: resume });
    if (runStopVersion !== stopVersion) throw new Error("The run was stopped before it began.");
    for (const entry of chosen) entry.profileSnapshotId = runId;
    state.entries = state.entries.filter(e => !ids.has(e.id)).concat(chosen);
    state.stopped = false; state.active = true; busy = true; await persist();
    void run({ ...raw, profile, rules, preferences, resume, submit: raw.submit === true }, chosen);
    return { accepted: chosen.length };
    } finally { preparing = false; }
  })().then(result => sendResponse({ result })).catch(error => sendResponse({ error: (error as Error).message }));
  return true;
});
