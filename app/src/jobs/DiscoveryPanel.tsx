import { useEffect, useRef, useState } from "react";
import { MARKETS, ROLES, words, type SearchPreferences } from "../../../shared/search.js";
import type { DiscoveryResult } from "../../../shared/discovery.js";

import type { DiscoveryRequest } from "./discovery-client.js";

interface Status { enabled?: boolean; userDailyRequests?: number; userDailyLimit?: number; configured: boolean; localMonthlyRequests: number; localDailyRequests: number; monthlyLimit: number; dailyLimit: number }
async function localRequest<T>(body: unknown): Promise<T> {
  const res = await fetch("/__discovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(65000) });
  const value = await res.json(); if (!res.ok) throw new Error(value.error || "Discovery is unavailable."); return value;
}
export interface DiscoveryPanelProps { preferences: SearchPreferences; onResult: (result: DiscoveryResult) => void; added: number; request?: DiscoveryRequest; hosted?: boolean }
export function DiscoveryPanel({ preferences, onResult, added, request = localRequest, hosted = false }: DiscoveryPanelProps) {
  const [roleId, setRoleId] = useState(preferences.roles[0]!.id), [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState<DiscoveryResult | null>(null);
  const [key, setKey] = useState("");
  const [searchTerm, setSearchTerm] = useState<string | undefined>();
  const selectedRole = preferences.roles.find(r => r.id === roleId)!;
  const searchTitles = [selectedRole.label, ...(ROLES.find(r => r.id === roleId)?.aliases ?? [])].filter((t,i,list) => list.findIndex(v => words(v) === words(t)) === i);
  const [restoring, setRestoring] = useState(true), [restored, setRestored] = useState(false);
  const resultHandler = useRef(onResult);
  useEffect(() => { resultHandler.current = onResult; }, [onResult]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; void request<Status>({ action: "status" }).then(s => { if (alive.current) setStatus(s); }).catch(e => { if (alive.current) setError(e.message); }); return () => { alive.current = false; }; }, [request]);
  useEffect(() => {
    let active = true;
    setRestoring(true); setRestored(false); setResult(null);
    void request<DiscoveryResult>({ action: "restore", preferences, ...(searchTerm ? { roleId, searchTerm } : {}) }).then(value => {
      if (!active || !value.queries.length) return;
      setResult(value); setRestored(true); resultHandler.current(value);
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [preferences, request, roleId, searchTerm]);
  const continuations = Object.fromEntries((result?.queries ?? []).filter(q => q.query.roleId === roleId && q.nextPageToken).map(q => [q.query.market, q.nextPageToken!]));
  const canFetchMore = hosted && Object.keys(continuations).length > 0;
  async function search(more = false) {
    setBusy(true); setError("");
    try {
      const value = await request<DiscoveryResult>({ action: more ? "more" : "search", roleId, preferences, ...(searchTerm ? { searchTerm } : {}), ...(more ? { continuations } : {}) });
      if (!alive.current) return;
      setResult(value); setRestored(false); onResult(value);
      setStatus(await request<Status>({ action: "status" }));
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <aside className="card discovery-panel" aria-label="Search more job sites">
    <div><p className="eyebrow">BROADER JOB DISCOVERY · {hosted ? "BETA" : "LOCAL TRIAL"}</p><h2>Search more job sites</h2><p>Find additional matches through JSearch, then check the original posting. Your chosen roles and countries still apply.</p></div>
    {!hosted && status && !status.configured && <form className="discovery-controls" onSubmit={e => { e.preventDefault(); setBusy(true); setError(""); void request<Status>({ action: "configure", key }).then(s => { if (alive.current) { setStatus(s); setKey(""); } }).catch(e => { if (alive.current) setError(e.message); }).finally(() => { if (alive.current) setBusy(false); }); }}><label className="field">OpenWeb Ninja API key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label><button disabled={busy || !key.trim()} type="submit">Save key locally</button></form>}
    <div className="discovery-controls"><label className="field">Role to search<select value={roleId} disabled={busy || restoring} onChange={e => { setRoleId(e.target.value); setSearchTerm(undefined); }}>{preferences.roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
      {hosted && searchTitles.length > 1 && <label className="field">Search by title<select value={searchTerm ?? searchTitles[0]} disabled={busy || restoring} onChange={e => setSearchTerm(e.target.value)}>{searchTitles.map(t => <option key={t} value={t}>{t}</option>)}</select></label>}
      <button className="primary" disabled={busy || restoring || !status?.configured || status.enabled === false} onClick={() => void search()}>{restoring ? "Restoring saved results…" : busy ? "Searching…" : "Find additional jobs"}</button><button disabled={busy} onClick={() => { setError(""); void request<Status>({ action: "status" }).then(setStatus).catch(e => setError(e.message)); }}>Check connection</button></div>
    {hosted && <p className="hint">Try another title for the same role to find listings worded differently. Use Edit my search to choose a city.</p>}
    {canFetchMore && <button disabled={busy || restoring || !status?.configured} onClick={() => void search(true)}>Fetch more results</button>}
    <p className="hint">{preferences.markets.map(m => MARKETS[m]).join(" + ")} · {hosted ? "One new page per country per click, up to 5 pages per search" : "One page per country"} · Up to {preferences.markets.length} request credits per click. Saved results restore automatically for 24 hours without API credits.</p>
    {hosted && status && <p className="hint">{!status.configured || status.enabled === false ? "New searches are temporarily paused. Saved results remain available." : `You have used ${status.userDailyRequests}/${status.userDailyLimit} new requests today. Across JobRadar: ${status.localDailyRequests}/${status.dailyLimit} today and ${status.localMonthlyRequests}/${status.monthlyLimit} over the last 30 days. Daily allowances reset at midnight UTC.`}</p>}
    {!hosted && status && <p className="hint">{status.configured ? `Key saved. This installation has used ${status.localMonthlyRequests}/${status.monthlyLimit} monthly requests and ${status.localDailyRequests}/${status.dailyLimit} today. Your provider account may have other usage.` : "Save your key here or in jobradar/.env.local as OPENWEBNINJA_API_KEY. It stays in the local collector and is excluded from Git. The first search verifies provider access."}</p>}
    {result && <p role="status">{restored && "Saved search results restored automatically. "}{added} additional matching listings available · {result.requestsUsed} new requests{restored ? " to restore results" : " in the last search"}. {result.queries.map(q => `${q.query.role} · ${MARKETS[q.query.market]}: ${q.matches}/${q.returned} results match${q.pages ? ` across ${q.pages} page${q.pages === 1 ? '' : 's'}` : ''}${q.cached ? " (cached)" : ""}`).join("; ")}. {canFetchMore ? "More pages are available for this role." : !hosted && result.queries.some(q => q.moreAvailable) ? "The provider has more pages; this local trial fetched one." : ""} {result.queries.some(q => q.pageLimitReached) && "The 5-page limit has been reached. Refine your location to explore another search."} Exact link duplicates are removed; different sites may advertise the same opening.</p>}
    {result?.warnings.map(w => <p className="jobs-error" key={w} role="status">{w}</p>)}
    {error && <p className="jobs-error" role="alert">{error}</p>}
  </aside>;
}
