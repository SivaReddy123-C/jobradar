import { useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationRules, CandidateProfile } from "../../../shared/candidate.js";
import { queueProblems, type QueueEntry, type RunRequest } from "../../../shared/applications.js";
import { MARKETS, type Market, type SearchPreferences } from "../../../shared/search.js";
import { documentBase64 } from "./documents.js";
import { extensionRequest } from "./bridge.js";
interface RunnerStatus { entries: QueueEntry[]; active: boolean; stopped: boolean }
interface Props { entries: QueueEntry[]; profile: CandidateProfile; preferences: SearchPreferences | null; rules: ApplicationRules; onChange: (entries: QueueEntry[]) => void; onRules: (rules: ApplicationRules) => void; onRunnerUpdate: (entries: QueueEntry[]) => void }
const runnable = (e: QueueEntry) => ["queued", "ready", "needs_attention", "stopped"].includes(e.status);
export function QueuePage({ entries, profile, preferences, rules, onChange, onRules, onRunnerUpdate }: Props) {
  const [selected, setSelected] = useState<string[]>([]), [connected, setConnected] = useState(false), [active, setActive] = useState(false), [error, setError] = useState(""), [pending, setPending] = useState(false), [authorized, setAuthorized] = useState(false);
  const updateRef = useRef(onRunnerUpdate); updateRef.current = onRunnerUpdate;
  async function refresh() {
    try { const state = await extensionRequest<RunnerStatus>("STATUS"); setConnected(true); setActive(state.active); updateRef.current(state.entries); setError(""); }
    catch (e) { setConnected(false); setError((e as Error).message); }
  }
  useEffect(() => {
    if (!connected) return;
    let cancelled = false, polling = false;
    const timer = setInterval(() => { if (polling) return; polling = true;
      void extensionRequest<RunnerStatus>("STATUS").then(s => { if (!cancelled) { setActive(s.active); updateRef.current(s.entries); } }).catch(e => { if (!cancelled) { setConnected(false); setError(e.message); } }).finally(() => { polling = false; });
    }, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [connected]);
  const chosen = useMemo(() => entries.filter(e => runnable(e) && (rules.mode === "batch" || selected.includes(e.id))).slice(0, rules.maxPerRun), [entries, selected, rules.mode, rules.maxPerRun]);
  const chosenIds = chosen.map(e => e.id + ":" + e.market).join("|");
  useEffect(() => { setAuthorized(false); }, [chosenIds, profile, preferences, rules.mode, rules.maxPerRun, rules.excludedCompanies]);
  const problems = preferences ? [...new Set(chosen.flatMap(e => queueProblems(e, profile, preferences, rules)))] : ["Choose your search roles and markets first."];
  async function start(submit: boolean) {
    if (!preferences || !chosen.length || problems.length || submit && !authorized) return;
    setError(""); setPending(true);
    try {
      const asset = profile.documents.find(d => d.id === profile.resumeId)!;
      const request: RunRequest = { entries: chosen, profile, preferences, rules, resume: { asset, data: await documentBase64(asset.id) }, submit };
      await extensionRequest("RUN", request); setAuthorized(false); setActive(true); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setPending(false); }
  }
  async function stop() { try { await extensionRequest("STOP"); await refresh(); } catch (e) { setError((e as Error).message); } }
  return <section className="candidate-page">
    <header className="search-heading"><div><p className="eyebrow">APPLICATION QUEUE</p><h1>Choose the jobs. See what happens.</h1><p>Ashby applications use your saved facts. Missing answers pause the job; uncertain submissions are never retried automatically.</p></div><button className={active ? "danger" : ""} disabled={!connected} onClick={() => void stop()}>Stop remaining applications</button></header>
    <div className="card profile-section"><div className="card-head"><h2>Run settings</h2><button disabled={pending} onClick={() => void refresh()}>{connected ? "Refresh runner status" : "Connect JobRadar Assist"}</button></div>
      <p className="hint">{connected ? active ? "Runner is active. Stop prevents remaining submissions; a submission already sent cannot be undone." : "Runner connected and idle." : "Load the built JobRadar Assist extension in Chrome or Edge, then open this app in that browser."}</p>
      <div className="field-grid"><label className="field">Application mode<select value={rules.mode} disabled={active} onChange={e => { onRules({ ...rules, mode: e.target.value as ApplicationRules["mode"] }); setAuthorized(false); }}><option value="selected">Jobs I select below</option><option value="batch">Next queued jobs automatically</option></select></label><label className="field">Maximum jobs per run<input type="number" min="1" max="10" value={rules.maxPerRun} disabled={active} onChange={e => onRules({ ...rules, maxPerRun: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} /></label><label className="field">Exclude companies (one per line)<textarea disabled={active} value={rules.excludedCompanies.join("\n")} onChange={e => onRules({ ...rules, excludedCompanies: e.target.value.split("\n") })} /></label></div>
      <p>{chosen.length} application{chosen.length === 1 ? "" : "s"} in this run · Profile version {profile.revision} · {profile.documents.find(d => d.id === profile.resumeId)?.name ?? "No résumé selected"}</p>
      {problems.length > 0 && chosen.length > 0 && <ul className="jobs-error">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      <label className="check"><input type="checkbox" checked={authorized} disabled={active} onChange={e => setAuthorized(e.target.checked)} />I authorize JobRadar to send this saved profile and résumé to the {chosen.length} jobs in this run and submit complete applications.</label>
      <div className="run-actions"><button disabled={!connected || active || pending || !chosen.length || Boolean(problems.length)} onClick={() => void start(false)}>Inspect forms without sending answers</button><button className="primary" disabled={!connected || active || pending || !authorized || !chosen.length || Boolean(problems.length)} onClick={() => void start(true)}>{pending ? "Starting…" : "Apply to " + chosen.length + " jobs"}</button></div>
      {error && <p className="jobs-error" role="alert">{error}</p>}
    </div>
    {!entries.length && <div className="jobs-empty card"><h2>Your queue is empty.</h2><p>Use “Add to queue” on an Ashby job in My jobs. Other application sites remain available through View & apply.</p></div>}
    {entries.map(entry => <article className="card profile-section queue-entry" key={entry.id}>
      <div className="card-head"><div><span className="tag">{entry.status.replace(/_/g, " ")}</span>{chosen.some(e => e.id === entry.id) && <span className="tag">In this run</span>}<h2>{entry.job.title}</h2><p>{entry.job.company} · {entry.job.location}</p></div>{rules.mode === "selected" && <label className="check"><input type="checkbox" aria-label={"Select " + entry.job.title} disabled={!runnable(entry) || active} checked={selected.includes(entry.id)} onChange={e => { setSelected(e.target.checked ? [...selected, entry.id] : selected.filter(id => id !== entry.id)); setAuthorized(false); }} />Select</label>}</div>
      <div className="run-actions"><label className="field">Application market<select value={entry.market} disabled={!runnable(entry) || active} onChange={e => { onChange(entries.map(x => x.id === entry.id ? { ...x, market: e.target.value as Market | "", status: "queued", plan: undefined, message: "", updatedAt: new Date().toISOString() } : x)); setAuthorized(false); }}><option value="">Choose market</option>{(entry.job.markets ?? [entry.job.country]).filter(m => m === "us" || m === "in").map(m => <option key={m} value={m}>{MARKETS[m as Market]}</option>)}</select></label><a className="btn-link" href={entry.job.url} target="_blank" rel="noreferrer">Open application ↗</a>{runnable(entry) && !active && <button onClick={() => onChange(entries.filter(x => x.id !== entry.id))}>Remove from queue</button>}</div>
      {entry.message && <p role="status">{entry.message}</p>}
      {entry.plan && <details><summary>Answers and evidence ({entry.plan.assignments.length} ready, {entry.plan.missing.length} missing)</summary>{entry.plan.assignments.map(a => <div className="saved-answer" key={a.field.id}><strong>{a.field.label}</strong><p>{a.field.type === "file" ? profile.documents.find(d => d.id === a.value)?.name ?? "Saved résumé version" : a.value}</p><small>{a.source}</small></div>)}{entry.plan.missing.length > 0 && <p className="jobs-error">Needs an answer: {entry.plan.missing.join("; ")}</p>}</details>}
      {entry.evidence && <p className="match-reason">Confirmed {entry.evidence.at}: “{entry.evidence.text}”</p>}
    </article>)}
    <button className="danger" disabled={active || !connected} onClick={() => { if (confirm("Delete profiles, résumé copies and application history in the extension? This resets its duplicate protection. The app's own queue remains.")) void extensionRequest("ERASE").then(() => refresh()).catch(e => setError(e.message)); }}>Delete private runner data</button>
  </section>;
}
