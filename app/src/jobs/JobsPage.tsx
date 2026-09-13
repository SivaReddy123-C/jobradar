import { useEffect, useMemo, useState } from "react";
import { classifyRoles, LEVELS, MARKETS, matchJob, ROLE_VERSION, WORKPLACES, type SearchPreferences } from "../../../shared/search.js";
import { daysSince } from "../lib/stats.js";
import { uid } from "../lib/storage.js";
import { buildApplicationPack } from "../lib/pack.js";
import type { AnswerEntry, Application, ResumeData } from "../lib/types.js";
import { applyFilters, defaultFilters, loadFeed, readCache, type Feed, type FeedJob, type JobFilters } from "./feed.js";
import { SponsorBadge } from "./SponsorBadge.js";
import { SearchSetup } from "./SearchSetup.js";
import { ashbyUrl, queueId, type QueueEntry, type QueueJob } from "../../../shared/applications.js";
import { additionalJobs, type DiscoveryJob } from "../../../shared/discovery.js";
import { HostedDiscovery } from "./HostedDiscovery.js";
import { DiscoveryPanel } from "./DiscoveryPanel.js";

interface Props {
  applications: Application[]; onChange: (apps: Application[]) => void;
  resume: ResumeData; answers: AnswerEntry[];
  preferences: SearchPreferences | null; onPreferencesChange: (preferences: SearchPreferences) => void;
  queue: QueueEntry[]; onQueue: (job: QueueJob) => void;
}
export function JobsPage(props: Props) {
  const [editing, setEditing] = useState(false);
  if (!props.preferences || editing) return <SearchSetup initial={props.preferences}
    onCancel={props.preferences ? () => setEditing(false) : undefined}
    onSave={(preferences) => { props.onPreferencesChange(preferences); setEditing(false); }} />;
  // A changed search gets a new lifecycle; old requests cannot replace the new feed.
  return <PersonalizedFeed key={JSON.stringify(props.preferences)} {...props} preferences={props.preferences} onEdit={() => setEditing(true)} />;
}
const PAGE = 30;
const Discovery = import.meta.env.DEV && import.meta.env.VITE_LOCAL_DISCOVERY === "true" ? DiscoveryPanel : HostedDiscovery;
function PersonalizedFeed({ applications, onChange, resume, answers, preferences, onEdit, queue, onQueue }: Props & { preferences: SearchPreferences; onEdit: () => void }) {
  const [feed, setFeed] = useState<Feed | null>(() => readCache(preferences.markets)?.feed ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [filters, setFilters] = useState<JobFilters>(defaultFilters());
  const [limit, setLimit] = useState(PAGE);
  const [copiedKey, setCopiedKey] = useState("");
  const [copyError, setCopyError] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveryJob[]>([]);
  const [discoveryOnly, setDiscoveryOnly] = useState(false);
  const extras = useMemo(() => additionalJobs<FeedJob>(feed?.jobs ?? [], discovered), [feed, discovered]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    loadFeed(refreshCount > 0, preferences.markets).then((value) => { if (active) setFeed(value); })
      .catch((err: Error) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [preferences.markets, refreshCount]);
  const classified = useMemo(() => [...(feed?.jobs ?? []), ...extras].map((job) => ({ ...job,
    roleClassification: job.roleClassification?.version === ROLE_VERSION ? job.roleClassification : { version: ROLE_VERSION, ids: classifyRoles(job.title) },
  })), [feed, extras]);
  const matches = useMemo(() => classified.flatMap((job) => {
    const match = matchJob(job, preferences);
    return match && /^https?:\/\//i.test(job.url) ? [{ job, match }] : [];
  }), [classified, preferences]);
  const matchByKey = useMemo(() => new Map(matches.map((m) => [m.job.key, m.match])), [matches]);
  const visible = useMemo(() => applyFilters(matches.map((m) => m.job).filter(j => !discoveryOnly || extras.length === 0 || j.discovery), filters), [matches, filters, discoveryOnly, extras.length]);
  const appliedUrls = useMemo(() => new Set(applications.map((a) => a.url).filter(Boolean)), [applications]);
  function updateFilters(next: JobFilters) { setFilters(next); setLimit(PAGE); }
  function logApplied(job: FeedJob) {
    if (appliedUrls.has(job.url)) return;
    const now = new Date().toISOString();
    onChange([{ id: uid(), company: job.company, title: job.title, url: job.url, location: job.location,
      source: "jobradar", appliedAt: now, status: "applied", statusChangedAt: now, notes: "Manually marked as applied; submission not verified by JobRadar." }, ...applications]);
  }
  async function copyPack(key: string) {
    try { await navigator.clipboard.writeText(buildApplicationPack(resume, answers)); setCopiedKey(key); setCopyError(""); }
    catch { setCopyError("Could not copy. Your saved answers are available in Apply kit."); }
  }
  const snapshotAge = feed ? daysSince(feed.generatedAt) : 0;
  return <section className="jobs personalized-jobs" aria-labelledby="jobs-heading">
    <header className="search-heading"><div><p className="eyebrow">YOUR NEXT CHAPTER</p><h1 id="jobs-heading">Your roles. Your opportunities.</h1>
      <p>Openings for the work you chose, in the places you selected.</p></div><button onClick={onEdit}>Edit my search</button></header>
    <div className="search-summary-bar">
      <div className="search-tags">{preferences.roles.map((r) => <span key={r.id}>{r.label}</span>)}</div>
      <div className="search-locations">{preferences.markets.map((m) => MARKETS[m]).join(" + ")}
        {preferences.location && ` · ${preferences.location}`}{preferences.workplace !== "any" && ` · ${WORKPLACES[preferences.workplace]}`}{preferences.level !== "any" && ` · ${LEVELS[preferences.level]}`}</div>
    </div>
    <Discovery preferences={preferences} added={extras.length} onResult={value => { setDiscovered(previous => [...previous, ...additionalJobs(previous, value.jobs)]); if (additionalJobs<FeedJob>(feed?.jobs ?? [], value.jobs).length) setLimit(PAGE); }} />
    {extras.length > 0 && <label className="check"><input type="checkbox" checked={discoveryOnly} onChange={e => { setDiscoveryOnly(e.target.checked); setLimit(PAGE); }} />Show only additional jobs ({extras.length})</label>}
    {feed && snapshotAge >= 2 && <div className="freshness-notice" role="status"><strong>This is an older job snapshot.</strong> Collected {feed.generatedAt.slice(0, 10)} ({snapshotAge} days ago). Check the employer page for current availability.</div>}
    {feed?.warnings?.map((warning) => <p className="jobs-error" key={warning} role="status">{warning}</p>)}
    <div className="jobs-toolbar">
      <label className="jobs-search"><span className="sr-only">Search within my matches</span><input placeholder="Search within your matches…" value={filters.q} onChange={(e) => updateFilters({ ...filters, q: e.target.value })} /></label>
      <label><span className="sr-only">Sort matches</span><select value={filters.sort} onChange={(e) => updateFilters({ ...filters, sort: e.target.value as JobFilters["sort"] })}>
        <option value="ghost">Lowest posting risk</option><option value="newest">Newest first</option><option value="company">Company A–Z</option>
      </select></label>
      <label className="check"><input type="checkbox" checked={filters.hideHighGhost} onChange={(e) => updateFilters({ ...filters, hideHighGhost: e.target.checked })} />Hide high-risk postings</label>
      <button onClick={() => setRefreshCount((n) => n + 1)} disabled={loading}>{loading ? "Loading…" : "Reload feed"}</button>
    </div>
    {error && <p className="jobs-error" role="alert">Could not refresh jobs: {error}{feed ? " Showing the previously loaded snapshot." : " Try reloading the feed."}</p>}
    {copyError && <p className="jobs-error" role="alert">{copyError}</p>}
    <p className="jobs-meta" aria-live="polite">{loading && !feed ? "Loading your selected markets…" : feed ? `${visible.length.toLocaleString()} matching openings · ${matches.length.toLocaleString()} before additional filters · Snapshot ${feed.generatedAt.slice(0, 10)}` : "No feed loaded."}</p>
    {!loading && feed && visible.length === 0 && <div className="jobs-empty card"><span className="empty-symbol" aria-hidden="true">◎</span><h2>No matching openings in this snapshot.</h2>
      <p>{matches.length ? "Your additional filters removed the current matches. Clear them to see your selected roles." : "Our covered sources have no matches for these choices right now. Your roles and markets have stayed the same."}</p>
      {matches.length ? <button onClick={() => updateFilters(defaultFilters())}>Clear additional filters</button> : <button onClick={onEdit}>Review my search</button>}</div>}
    <div className="job-list">{visible.slice(0, limit).map((job) => <article className="card job-card" key={job.key}>
      <div className="job-main"><div className="job-company">{job.company}<span>{matchByKey.get(job.key)?.markets.map((m) => MARKETS[m]).join(" + ")}</span></div><h2 className="job-role">{job.title}</h2>
        <p className="job-meta">{job.location} · {job.publishedAt ? `Posted ${daysSince(job.publishedAt)} days ago` : `First seen ${daysSince(job.firstSeenAt)} days ago`}</p>
        <p className="match-reason">Matches your {matchByKey.get(job.key)?.roles.join(" / ")} search</p>
        <div className="job-meta">{job.hasSalaryInfo && <span className="tag tag-salary">Salary stated</span>}
          {job.sponsorship === "yes" && <span className="tag tag-sponsor">Sponsorship mentioned</span>}
          {job.sponsorship === "no" && <span className="tag tag-nosponsor">No sponsorship stated</span>}
          {job.country === "us" && job.sponsor && <SponsorBadge job={job} />}
        </div>
        {job.discovery && <p className="job-meta">Found via {job.discovery.provider} · {job.discovery.publisher} · Availability not independently verified</p>}
        <details className="ghost-details"><summary>Posting signals · {job.discovery ? "not assessed" : job.ghost.band === "low" ? "low risk" : `${job.ghost.band} risk`}</summary>
          <p>These signals are estimates, not confirmation of active hiring.</p><ul>{job.ghost.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
          <p>Source: {job.source}. Last seen: {(job.lastSeenAt ?? feed?.generatedAt ?? "").slice(0, 10)}.</p>
        </details>
      </div><div className="job-actions"><a className="btn-link primary-link" href={job.url} target="_blank" rel="noreferrer">View & apply ↗</a>
        {job.source === "ashby" && ashbyUrl(job.url) && <button disabled={queue.some(e => e.id === queueId(job.url)) || applications.some(a => queueId(a.url) === queueId(job.url))} onClick={() => onQueue(job)}>{queue.some(e => e.id === queueId(job.url)) ? "In application queue" : "Add to queue"}</button>}
        <button onClick={() => copyPack(job.key)}>{copiedKey === job.key ? "Copied ✓" : "Copy my answers"}</button>
        {appliedUrls.has(job.url) ? <span className="applied-mark">Logged in tracker ✓</span> : <button onClick={() => logApplied(job)} title="Manually record an application you already submitted">Mark as applied</button>}
      </div></article>)}</div>
    {visible.length > limit && <button className="load-more" onClick={() => setLimit((n) => n + PAGE)}>Show more ({visible.length - limit} remaining)</button>}
  </section>;
}
