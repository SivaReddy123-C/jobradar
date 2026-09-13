import { useRef, useState } from "react";
import { MARKETS, type Market, type SearchPreferences } from "../../../shared/search.js";
import { type CandidateProfile, type MarketFacts, type ScopedAnswer, type YesNo } from "../../../shared/candidate.js";
import type { ResumeData } from "../lib/types.js";
import { deleteDocument, downloadDocument, saveDocument } from "./documents.js";
interface Props { profile: CandidateProfile; resume: ResumeData; search: SearchPreferences | null; onChange: (profile: CandidateProfile) => void }
export function ProfilePage({ profile: p, resume, search, onChange }: Props) {
  const current = useRef(p); current.current = p;
  const [market, setMarket] = useState<Market>("us"), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState(""), [answer, setAnswer] = useState(""), [role, setRole] = useState("*");
  function update(patch: Partial<CandidateProfile>) { onChange({ ...current.current, ...patch, revision: current.current.revision + 1, updatedAt: new Date().toISOString() }); }
  function facts(patch: Partial<MarketFacts>) { update({ markets: { ...p.markets, [market]: { ...p.markets[market], ...patch } } }); }
  async function upload(file: File) {
    setError(""); setSaving(true);
    try {
      if (p.documents.length >= 3) throw new Error("Keep up to three résumé versions. Remove an older version first.");
      const asset = await saveDocument(file);
      update({ documents: [...current.current.documents.filter(d => d.id !== asset.id), asset], resumeId: asset.id });
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  async function removeDocument(id: string) {
    try {
      await deleteDocument(id);
      update({ documents: current.current.documents.filter(d => d.id !== id), resumeId: current.current.resumeId === id ? "" : current.current.resumeId });
    } catch (e) { setError((e as Error).message); }
  }
  function addAnswer() {
    if (!question.trim() || !answer.trim()) return;
    const row: ScopedAnswer = { id: crypto.randomUUID(), question: question.trim(), value: answer.trim(), market, roleId: role };
    update({ answers: [...p.answers, row] }); setQuestion(""); setAnswer("");
  }
  const f = p.markets[market];
  return <section className="candidate-page">
    <header className="search-heading"><div><p className="eyebrow">YOUR APPLICATION PROFILE</p><h1>The facts behind every application.</h1><p>Save what employers should receive. Each application keeps the profile and résumé version it used.</p></div><span className="tag">Version {p.revision}</span></header>
    {error && <p className="jobs-error" role="alert">{error}</p>}
    <div className="candidate-grid">
      <div className="card profile-section"><div className="card-head"><h2>Contact details</h2><button onClick={() => update({ fullName: resume.basics.name, email: resume.basics.email, phone: resume.basics.phone, location: resume.basics.location })}>Copy résumé contact details</button></div>
        <div className="field-grid">{([
          ["fullName", "Full name"], ["firstName", "First / given name"], ["lastName", "Last / family name"], ["email", "Email"], ["phone", "Phone"], ["location", "Current city and country"], ["linkedin", "LinkedIn URL"], ["portfolio", "Portfolio URL"],
        ] as const).map(([key, label]) => <label className="field" key={key}>{label}<input type={key === "email" ? "email" : "text"} value={p[key]} onChange={e => update({ [key]: e.target.value })} /></label>)}</div>
      </div>
      <div className="card profile-section"><h2>Your résumé files</h2><p className="hint">PDF or DOCX, up to 2 MB. Files stay on this device until you start an application. Select the version to use.</p>
        <label className="filebtn">{saving ? "Saving…" : "Upload résumé"}<input aria-label="Upload résumé file" disabled={saving} type="file" accept=".pdf,.docx" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} /></label>
        {p.documents.map(d => <div className="document-row" key={d.id}><label className="check"><input type="radio" name="resume-version" checked={p.resumeId === d.id} onChange={() => update({ resumeId: d.id })} />{d.name}</label><small>{Math.ceil(d.size / 1024)} KB · {d.createdAt.slice(0, 10)}</small><div><button onClick={() => void downloadDocument(d).catch(e => setError(e.message))}>Download</button><button className="danger" onClick={() => void removeDocument(d.id)}>Remove</button></div></div>)}
        <p className="hint">Export data includes profile details and file references. Download the résumé files separately for backup.</p>
      </div>
    </div>
    <div className="card profile-section">
      <div className="card-head"><h2>Answers for each job market</h2><label className="field">Application market<select value={market} onChange={e => setMarket(e.target.value as Market)}>{Object.entries(MARKETS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label></div>
      <div className="field-grid">{([["authorized", "Authorized to work in " + MARKETS[market]], ["sponsorship", "Need visa sponsorship in " + MARKETS[market]]] as const).map(([key, label]) => <label key={key} className="field">{label}<select value={f[key]} onChange={e => facts({ [key]: e.target.value as YesNo })}><option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option></select></label>)}
        <label className="field">Notice period<input value={f.notice} placeholder="Your exact answer" onChange={e => facts({ notice: e.target.value })} /></label>
      </div>
      <h3>Compensation expectation</h3><div className="salary-grid">
        <label className="field">Amount<input type="number" min="0" value={f.salary.amount} onChange={e => facts({ salary: { ...f.salary, amount: e.target.value } })} /></label>
        <label className="field">Currency<select value={f.salary.currency} onChange={e => facts({ salary: { ...f.salary, currency: e.target.value as "USD" | "INR" } })}><option>USD</option><option>INR</option></select></label>
        <label className="field">Period<select value={f.salary.period} onChange={e => facts({ salary: { ...f.salary, period: e.target.value as "year" | "month" | "hour" } })}><option value="year">Annual</option><option value="month">Monthly</option><option value="hour">Hourly</option></select></label>
        <label className="field">Pay basis<select value={f.salary.basis} onChange={e => facts({ salary: { ...f.salary, basis: e.target.value as "base" | "total" | "ctc" } })}><option value="base">Base pay</option><option value="total">Total compensation</option><option value="ctc">CTC</option></select></label>
      </div><p className="hint">The adapter uses this amount only when the question explicitly matches the currency, period and pay basis. It asks for an exact answer otherwise.</p>
      <h3>Answers to specific questions</h3><p className="hint">Copy the full employer question. Answers apply only in {MARKETS[market]} and the role you choose. They are not invented from your résumé.</p>
      <div className="answer-compose"><label className="field">Role context<select value={role} onChange={e => setRole(e.target.value)}><option value="*">Any of my selected roles</option>{search?.roles.map(r => <option value={r.id} key={r.id}>{r.label}</option>)}</select></label><label className="field">Exact question<textarea value={question} onChange={e => setQuestion(e.target.value)} /></label><label className="field">Your answer<textarea value={answer} onChange={e => setAnswer(e.target.value)} /></label><button disabled={!question.trim() || !answer.trim()} onClick={addAnswer}>Save answer</button></div>
      {p.answers.filter(a => a.market === market).map(a => <div className="saved-answer" key={a.id}><strong>{a.question}</strong><p>{a.value}</p><small>{a.roleId === "*" ? "Any selected role" : search?.roles.find(r => r.id === a.roleId)?.label ?? a.roleId}</small><button className="danger" onClick={() => update({ answers: p.answers.filter(x => x.id !== a.id) })}>Remove answer</button></div>)}
    </div>
  </section>;
}
