import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { emptyCandidate, defaultRules } from "../../shared/candidate.js";
import { addQueueJob, type QueueEntry, type RunRequest } from "../../shared/applications.js";
import type { SearchPreferences } from "../../shared/search.js";

const directory = resolve(".test-profiles"); await mkdir(directory, { recursive: true });
const profileDir = await mkdtemp(directory + sep + "run-");
const fixture = await readFile("tests/fixture.html", "utf8");
let context!: BrowserContext; let app!: Page; let submitted = 0, uploaded = 0;
const variants = new Map<string, string>();
const prefs: SearchPreferences = { version: 1, roles: [{ id: "software", label: "Software engineer" }], markets: ["us"], location: "", level: "any", workplace: "any" };
const profile = emptyCandidate();
Object.assign(profile, { fullName: "Synthetic Candidate", firstName: "Synthetic", lastName: "Candidate", email: "synthetic@example.invalid", revision: 8 });
profile.markets.us.authorized = "yes"; profile.markets.us.notice = "2 weeks"; profile.markets.us.salary.amount = "85000";
profile.answers = [{ id: "project", market: "us", roleId: "software", question: "Describe a relevant project", value: "Synthetic fixture project, not a real candidate." }];
const data = Buffer.from("%PDF-1.4\n%Synthetic JobRadar fixture only\n%%EOF");
const hash = createHash("sha256").update(data).digest("hex");
const asset = { id: hash, sha256: hash, mime: "application/pdf", name: "synthetic-fixture.pdf", size: data.length, createdAt: new Date().toISOString() };
profile.documents = [asset]; profile.resumeId = hash;
const jobs = (n: number) => addQueueJob([], { key: "fixture-" + n, title: "Software Engineer", company: "Example", location: "USA", country: "us", source: "ashby", url: "https://jobs.ashbyhq.com/example/" + String(n).padStart(8, "0") + "-1111-4111-8111-111111111111" }, prefs)[0]!;
const request = (entries: QueueEntry[], submit: boolean): RunRequest => ({ entries, submit, preferences: prefs, rules: defaultRules(), profile, resume: { asset, data: data.toString("base64") } });
async function launch() {
  context = await chromium.launchPersistentContext(profileDir, { channel: "chromium", headless: true, args: ["--disable-extensions-except=" + resolve("dist"), "--load-extension=" + resolve("dist")] });
  await context.exposeBinding("recordFixtureSubmit", () => { submitted++; });
  await context.exposeBinding("recordFixtureUpload", () => { uploaded++; });
  context.on("requestfailed", r => console.log("Fixture request failed", r.url(), r.failure()?.errorText));
  await context.route("**/*", async route => {
    const u = new URL(route.request().url());
    if (u.origin === "http://127.0.0.1:5174") return route.fulfill({ body: "<html><body><h1>Local runner harness</h1></body></html>", contentType: "text/html" });
    if (u.hostname === "jobs.ashbyhq.com") {
      console.log("Serving local Ashby fixture", u.pathname);
      const variant = variants.get(u.pathname.split("/")[2]!.slice(0, 8)) ?? "";
      if (variant === "delay") await new Promise(r => setTimeout(r, 1600));
      let html = fixture.replace("window.submissions++;", "window.submissions++; window.recordFixtureSubmit();").replace("()=>window.uploads++", "()=>{window.uploads++;window.recordFixtureUpload();}");
      if (variant === "missing") html = html.replace("Describe a relevant project", "Employer-specific question we have not answered");
      if (variant === "uncertain") html = html.replace("window.submissions=0;", "window.noConfirmation=true;window.submissions=0;");
      if (variant === "changed") html = html.replace("</script>", "document.querySelector('input[type=email]').addEventListener('change',()=>{document.querySelector('input[type=email]').value='changed@example.invalid';});</script>");
      if (variant === "dynamic") html = html.replace("</script>", "document.querySelector('input[type=email]').addEventListener('change',()=>{if(!document.querySelector('[data-field-path=new]'))document.querySelector('form').insertAdjacentHTML('beforeend', '<div class=ashby-application-form-field-entry data-field-path=new><label class=ashby-application-form-question-title for=new>New required question</label><input id=new required></div>');});</script>");
      if (variant === "outside") html = html.replace("</form>", "<input aria-label='Unsupported required question' required></form>");
      if (variant === "moved") html = html.replace("<p>USA</p>", "<p>India</p>");
      return route.fulfill({ body: html, contentType: "text/html" });
    }
    if (u.protocol === "chrome-extension:") return route.continue();
    return route.abort(); // All employer requests are fixtures. Nothing reaches the internet.
  });
  app = await context.newPage(); await app.goto("http://127.0.0.1:5174/runner-harness");
  await app.waitForTimeout(300);
}
async function send(action: string, payload?: unknown): Promise<any> {
  return await app.evaluate(({ action, payload }) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID(), timer = setTimeout(() => reject(new Error("Bridge timeout")), 5000);
    const handler = (event: MessageEvent) => { if (event.data?.channel === "jobradar-response" && event.data.id === id) { clearTimeout(timer); removeEventListener("message", handler); resolve(event.data); } };
    addEventListener("message", handler); postMessage({ channel: "jobradar-request", id, action, payload }, location.origin);
  }), { action, payload });
}
async function waitStatus(id: string, status: string, timeout = 23000) {
  const until = Date.now() + timeout; let last: any;
  while (Date.now() < until) {
    const response = await send("STATUS"); last = response.result?.entries.find((e: QueueEntry) => e.id === id);
    if (last?.status === status && !response.result.active) return last;
    await new Promise(r => setTimeout(r, 200));
  }
  for (const page of context.pages()) console.log("Fixture diagnostics", page.url(), (await page.locator("body").innerText().catch(() => "unavailable")).slice(0, 240));
  throw new Error("Expected " + status + "; got " + JSON.stringify({ status: last?.status, message: last?.message }));
}
try {
  await launch();
  assert.ok((await send("STATUS")).result);
  const first = jobs(1);
  assert.equal((await send("RUN", request([first], false))).result.accepted, 1);
  const prepared = await waitStatus(first.id, "ready");
  assert.equal(prepared.plan.assignments.length, 7); assert.equal(uploaded, 0); assert.equal(submitted, 0);
  console.log("PASS: extension bridge inspects the complete form without uploading or submitting");
  assert.equal((await send("RUN", request([first], true))).result.accepted, 1);
  const confirmed = await waitStatus(first.id, "confirmed");
  assert.equal(submitted, 1); assert.equal(uploaded, 1); assert.equal(confirmed.evidence.text, "Application submitted");
  const firstTab = context.pages().find(p => p.url() === first.job.url)!;
  assert.equal(await firstTab.evaluate(() => (window as any).submittedEmail), profile.email);
  assert.ok((await send("RUN", request([first], true))).error);
  assert.equal(submitted, 1);
  console.log("PASS: résumé, text, yes/no, select and custom answers submit once with confirmation; duplicate blocked");
  const missing = jobs(2); variants.set("00000002", "missing");
  await send("RUN", request([missing], true)); const paused = await waitStatus(missing.id, "needs_attention");
  assert.ok(paused.plan.missing[0].includes("Employer-specific")); assert.equal(submitted, 1); assert.equal(uploaded, 1);
  console.log("PASS: required unknown answer pauses before uploads or submission");
  const changed = jobs(3); variants.set("00000003", "changed");
  await send("RUN", request([changed], true)); const invalid = await waitStatus(changed.id, "needs_attention");
  assert.match(invalid.message, /Value changed/); assert.equal(submitted, 1);
  console.log("PASS: a changed controlled-input value blocks submission");
  const uncertain = jobs(4); variants.set("00000004", "uncertain");
  await send("RUN", request([uncertain], true)); await waitStatus(uncertain.id, "submission_uncertain");
  assert.equal(submitted, 2); assert.ok((await send("RUN", request([uncertain], true))).error);
  console.log("PASS: no confirmation means uncertain, and automatic retry is blocked");
  const stopped = jobs(5); variants.set("00000005", "delay");
  await send("RUN", request([stopped], true)); await send("STOP"); await waitStatus(stopped.id, "stopped");
  assert.equal(submitted, 2);
  console.log("PASS: stop during page load prevents the next submission");
  const mismatch = request([jobs(6)], true); mismatch.resume = { ...mismatch.resume, data: Buffer.from("wrong").toString("base64") };
  assert.ok((await send("RUN", mismatch)).error); assert.equal(submitted, 2);
  console.log("PASS: a document hash mismatch is rejected before opening the job");
  const racing = jobs(8); variants.set("00000008", "delay");
  const doubleClick = await Promise.all([send("RUN", request([racing], false)), send("RUN", request([racing], false))]);
  assert.equal(doubleClick.filter(r => r.result?.accepted).length, 1); assert.equal(doubleClick.filter(r => r.error).length, 1); await waitStatus(racing.id, "ready");
  console.log("PASS: simultaneous start requests cannot launch two runs");
  const dynamic = jobs(9); variants.set("00000009", "dynamic");
  await send("RUN", request([dynamic], true)); assert.match((await waitStatus(dynamic.id, "needs_attention")).message, /form changed/); assert.equal(submitted, 2);
  console.log("PASS: a new required field after filling blocks submission");
  const outside = jobs(10); variants.set("00000010", "outside");
  await send("RUN", request([outside], true)); assert.match((await waitStatus(outside.id, "needs_attention")).message, /outside the supported/); assert.equal(submitted, 2);
  console.log("PASS: unsupported required form structure blocks submission");
  const moved = jobs(11); variants.set("00000011", "moved");
  await send("RUN", request([moved], true)); assert.match((await waitStatus(moved.id, "needs_attention")).message, /selected country/); assert.equal(submitted, 2);
  console.log("PASS: changed live job country blocks a stale queued application");
  // Simulate a worker/browser interruption after the durable submitting write.
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(async (entry) => { await chrome.storage.local.set({ jr_runner: { active: true, stopped: false, entries: [{ ...entry, status: "submitting" }] } }); }, jobs(7));
  await context.close(); await launch();
  const recovered = (await send("STATUS")).result.entries[0];
  assert.equal(recovered.status, "submission_uncertain"); assert.ok((await send("RUN", request([jobs(7)], true))).error);
  console.log("PASS: browser restart recovers a submission in progress as uncertain");
  await send("ERASE");
  assert.equal((await send("STATUS")).result.entries.length, 0);
  console.log("PASS: private runner data can be deleted");
} finally {
  await context?.close();
  const target = resolve(profileDir);
  if (!target.startsWith(directory + sep)) throw new Error("Refusing cleanup outside test workspace.");
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
}
