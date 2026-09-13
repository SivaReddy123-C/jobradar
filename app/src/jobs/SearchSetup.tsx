import { useMemo, useState } from "react";
import { customRole, LEVELS, MARKETS, normalizePreferences, ROLES, WORKPLACES, words, type Market, type RoleChoice, type SearchPreferences } from "../../../shared/search.js";

interface Props { initial: SearchPreferences | null; onSave: (preferences: SearchPreferences) => void; onCancel?: () => void }
export function SearchSetup({ initial, onSave, onCancel }: Props) {
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [roles, setRoles] = useState<RoleChoice[]>(initial?.roles ?? []);
  const [markets, setMarkets] = useState<Market[]>(initial?.markets ?? []);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [level, setLevel] = useState(initial?.level ?? "any");
  const [workplace, setWorkplace] = useState(initial?.workplace ?? "any");
  const families = useMemo(() => [...new Set(ROLES.map((r) => r.family))].sort(), []);
  const options = useMemo(() => ROLES.filter((r) => (!family || r.family === family)
    && words(`${r.label} ${r.aliases.join(" ")}`).includes(words(query))), [query, family]);
  const custom = customRole(query);
  const canAddCustom = custom?.id.startsWith("custom:") && !roles.some((r) => r.id === custom.id);
  function toggleRole(choice: RoleChoice) {
    setRoles((current) => current.some((r) => r.id === choice.id) ? current.filter((r) => r.id !== choice.id) : [...current, choice].slice(0, 20));
  }
  function toggleMarket(market: Market) {
    setMarkets((current) => current.includes(market) ? current.filter((m) => m !== market) : [...current, market]);
  }
  function submit() {
    const preferences = normalizePreferences({ version: 1, roles, markets, location, level, workplace });
    if (preferences) onSave(preferences);
  }
  return <section className="search-setup" aria-labelledby="setup-title">
    <div className="setup-intro">
      <p className="eyebrow">YOUR SEARCH, YOUR CHOICES</p>
      <h1 id="setup-title">{step === 1 ? "What work are you looking for?" : "Where do you want to work?"}</h1>
      <p>{step === 1 ? "Choose the roles you want next. Your feed will follow these choices." : "Start with the USA, India, or both. Make the search as specific as you need."}</p>
    </div>
    <ol className="setup-steps" aria-label="Search setup progress">
      <li aria-current={step === 1 ? "step" : undefined}><span>1</span> Your roles</li>
      <li aria-current={step === 2 ? "step" : undefined}><span>2</span> Your locations</li>
    </ol>
    <div className="setup-layout">
      <form className="card setup-form" onSubmit={(event) => { event.preventDefault(); step === 1 ? roles.length && setStep(2) : submit(); }}>
        {step === 1 ? <>
          <div className="setup-search-row">
            <label className="field">Find a role
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try accountant, nurse, frontend developer…" maxLength={80} />
            </label>
            <label className="field family-filter">Field of work
              <select value={family} onChange={(e) => setFamily(e.target.value)}><option value="">All professions</option>{families.map((f) => <option key={f}>{f}</option>)}</select>
            </label>
          </div>
          <p className="setup-hint">Select more than one if you are considering different roles.</p>
          <div className="role-options" aria-label="Available roles">
            {options.map((r) => <button type="button" className={`role-option ${roles.some((x) => x.id === r.id) ? "selected" : ""}`} key={r.id}
              aria-pressed={roles.some((x) => x.id === r.id)} onClick={() => toggleRole({ id: r.id, label: r.label })}>
              <span className="role-check" aria-hidden="true">{roles.some((x) => x.id === r.id) ? "✓" : "+"}</span>
              <span><strong>{r.label}</strong><small>{r.aliases.slice(0, 3).join(" · ")}</small></span>
            </button>)}
          </div>
          {options.length === 0 && <p className="setup-hint">No suggested title found. You can add a specific title below.</p>}
          {custom && canAddCustom && <button type="button" className="custom-role" onClick={() => { toggleRole(custom); setQuery(""); }}>+ Add “{custom.label}” as a custom role</button>}
          {query.trim() && !custom && <p className="setup-hint">Use a specific title, such as “Project manager” instead of “PM”.</p>}
        </> : <>
          <fieldset className="market-fieldset"><legend>Job markets</legend><div className="market-options">
            {(Object.entries(MARKETS) as [Market, string][]).map(([code, label]) => <label className={`market-option ${markets.includes(code) ? "selected" : ""}`} key={code}>
              <input type="checkbox" checked={markets.includes(code)} onChange={() => toggleMarket(code)} />
              <span><strong>{label}</strong><small>{code === "us" ? "United States" : "India"}</small></span>
            </label>)}
          </div></fieldset>
          <label className="field">Cities or states <span className="optional">Optional</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="For example: Atlanta, Bengaluru" />
          </label>
          <p className="setup-hint">Separate locations with commas. Leave blank to search your selected markets.</p>
          <div className="field-grid">
            <label className="field">Work arrangement<select value={workplace} onChange={(e) => setWorkplace(e.target.value as SearchPreferences["workplace"])}>
              {Object.entries(WORKPLACES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            <label className="field">Experience level<select value={level} onChange={(e) => setLevel(e.target.value as SearchPreferences["level"])}>
              {Object.entries(LEVELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
          </div>
          <p className="setup-hint">Specific level and work-arrangement filters show only postings that state that information. Check each employer’s work-authorization requirements on its application page.</p>
        </>}
        <div className="setup-actions">
          {step === 2 ? <button type="button" onClick={() => setStep(1)}>← Back to roles</button> : onCancel ? <button type="button" onClick={onCancel}>Cancel</button> : <span className="setup-hint">No résumé or account needed to browse.</span>}
          <button type="submit" className="primary" disabled={step === 1 ? roles.length === 0 : markets.length === 0}>{step === 1 ? "Continue to locations →" : "Show my jobs →"}</button>
        </div>
      </form>
      <aside className="setup-summary card">
        <p className="eyebrow">YOUR SEARCH</p><h2>A feed that stays focused.</h2>
        <p>We’ll keep your selected roles and locations together, so every search starts in the right place.</p>
        <h3>Selected roles <span>{roles.length}</span></h3>
        {roles.length ? <ul className="selected-roles">{roles.map((r) => <li key={r.id}><span>{r.label}</span><button type="button" aria-label={`Remove ${r.label}`} onClick={() => toggleRole(r)}>×</button></li>)}</ul> : <p className="setup-hint">Your roles will appear here.</p>}
        {markets.length > 0 && <p className="summary-markets">{markets.map((m) => MARKETS[m]).join(" + ")}</p>}
        <div className="setup-promise">Only the roles you choose.<br />Only the markets you select.<br />Change your preferences any time.</div>
      </aside>
    </div>
  </section>;
}
