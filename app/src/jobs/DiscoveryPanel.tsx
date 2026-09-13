import { useEffect, useRef, useState } from "react";
import { MARKETS, type SearchPreferences } from "../../../shared/search.js";
import type { DiscoveryResult } from "../../../shared/discovery.js";

interface Status { configured: boolean; localMonthlyRequests: number; localDailyRequests: number; monthlyLimit: number; dailyLimit: number }
async function request<T>(body: unknown): Promise<T> {
  const res = await fetch("/__discovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(65000) });
  const value = await res.json(); if (!res.ok) throw new Error(value.error || "Discovery is unavailable."); return value;
}
export function DiscoveryPanel({ preferences, onResult, added }: { preferences: SearchPreferences; onResult: (result: DiscoveryResult) => void; added: number }) {
  const [roleId, setRoleId] = useState(preferences.roles[0]!.id), [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState<DiscoveryResult | null>(null);
  const [key, setKey] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; void request<Status>({ action: "status" }).then(s => { if (alive.current) setStatus(s); }).catch(e => { if (alive.current) setError(e.message); }); return () => { alive.current = false; }; }, []);
  async function search() {
    setBusy(true); setError("");
    try {
      const value = await request<DiscoveryResult>({ action: "search", roleId, preferences });
      if (!alive.current) return;
      setResult(value); onResult(value);
      setStatus(await request<Status>({ action: "status" }));
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <aside className="card discovery-panel" aria-label="Search more job sites">
    <div><p className="eyebrow">BROADER JOB DISCOVERY · LOCAL TRIAL</p><h2>Search more job sites</h2><p>Find additional matches through JSearch, then check the original posting. Your chosen roles and countries still apply.</p></div>
    {status && !status.configured && <form className="discovery-controls" onSubmit={e => { e.preventDefault(); setBusy(true); setError(""); void request<Status>({ action: "configure", key }).then(s => { if (alive.current) { setStatus(s); setKey(""); } }).catch(e => { if (alive.current) setError(e.message); }).finally(() => { if (alive.current) setBusy(false); }); }}><label className="field">OpenWeb Ninja API key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label><button disabled={busy || !key.trim()} type="submit">Save key locally</button></form>}
    <div className="discovery-controls"><label className="field">Role to search<select value={roleId} disabled={busy} onChange={e => setRoleId(e.target.value)}>{preferences.roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label><button className="primary" disabled={busy || !status?.configured} onClick={() => void search()}>{busy ? "Searching…" : "Find additional jobs"}</button><button disabled={busy} onClick={() => { setError(""); void request<Status>({ action: "status" }).then(setStatus).catch(e => setError(e.message)); }}>Check connection</button></div>
    <p className="hint">{preferences.markets.map(m => MARKETS[m]).join(" + ")} · One page per country · Up to {preferences.markets.length} request credits · Results reused for 24 hours.</p>
    {status && <p className="hint">{status.configured ? `Key saved. This installation has used ${status.localMonthlyRequests}/${status.monthlyLimit} monthly requests and ${status.localDailyRequests}/${status.dailyLimit} today. Your provider account may have other usage.` : "Save your key here or in jobradar/.env.local as OPENWEBNINJA_API_KEY. It stays in the local collector and is excluded from Git. The first search verifies provider access."}</p>}
    {result && <p role="status">{added} additional matching listings available · {result.requestsUsed} new requests in the last search. {result.queries.map(q => `${MARKETS[q.query.market]}: ${q.matches}/${q.returned} results match${q.cached ? " (cached)" : ""}`).join("; ")}. {result.queries.some(q => q.moreAvailable) && "The provider has more pages; this trial fetched one."} Exact link duplicates are removed; different sites may advertise the same opening.</p>}
    {result?.warnings.map(w => <p className="jobs-error" key={w} role="status">{w}</p>)}
    {error && <p className="jobs-error" role="alert">{error}</p>}
  </aside>;
}
