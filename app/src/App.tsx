import { useEffect, useMemo, useState } from "react";
import { exportJson, importJson, lastStorageError, loadState, saveState } from "./lib/storage.js";
import type { AppState } from "./lib/types.js";
import { JobsPage } from "./jobs/JobsPage.js";
import { ApplyKitPage } from "./kit/ApplyKitPage.js";
import { ResumePage } from "./resume/ResumePage.js";
import { TrackerPage } from "./tracker/TrackerPage.js";
import { ProfilePage } from "./apply/ProfilePage.js";
import { QueuePage } from "./apply/QueuePage.js";
import { addQueueJob, queueId, type QueueEntry, type QueueJob } from "../../shared/applications.js";

type Tab = "resume" | "jobs" | "tracker" | "kit" | "profile" | "queue";

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>("jobs");
  const [saveError, setSaveError] = useState("");

  // Persist on every change - the browser is the database, so a failed write
  // is lost work, not a hiccup. It used to be swallowed silently.
  useEffect(() => { setSaveError(saveState(state) ? "" : lastStorageError); }, [state]);

  const accepted = useMemo(
    () => state.applications.some((a) => a.status === "accepted"),
    [state.applications],
  );

  function download() {
    const blob = new Blob([exportJson(state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jobradar-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function upload(file: File) {
    file.text().then((text) => {
      try {
        setState(importJson(text));
      } catch {
        alert("That file doesn't look like a JobRadar export.");
      }
    });
  }
  function enqueue(job: QueueJob) {
    setState(s => !s.search || s.applications.some(a => queueId(a.url) === queueId(job.url)) ? s : { ...s, queue: addQueueJob(s.queue, job, s.search) });
  }
  function runnerUpdate(entries: QueueEntry[]) {
    setState(s => {
      const updates = new Map(entries.map(e => [e.id, e]));
      const queue = s.queue.map(e => { const newer = updates.get(e.id); return newer && newer.updatedAt >= e.updatedAt ? newer : e; });
      const applications = [...s.applications];
      for (const e of queue) if (e.status === "confirmed" && e.evidence && !applications.some(a => queueId(a.url) === e.id)) applications.unshift({ id: e.id, title: e.job.title, company: e.job.company, location: e.job.location, url: e.job.url, source: "JobRadar Assist · Ashby", appliedAt: e.evidence.at, status: "applied", statusChangedAt: e.evidence.at, notes: "Confirmed by employer page: " + e.evidence.text });
      return JSON.stringify(queue) === JSON.stringify(s.queue) && applications.length === s.applications.length ? s : { ...s, queue, applications };
    });
  }

  return (
    <div className="app">
      {saveError && (
        <div className="save-banner no-print" role="alert">
          <strong>Not saved.</strong> {saveError}
        </div>
      )}
      <header className="topbar no-print">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>JobRadar</strong>
          <span className="tagline">Your next role. USA & India.</span>
        </div>
        <nav>
          <button className={tab === "jobs" ? "active" : ""} onClick={() => setTab("jobs")}>
            My jobs
          </button>
          <button className={tab === "resume" ? "active" : ""} onClick={() => setTab("resume")}>
            Resume
          </button>
          <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>Profile</button>
          <button className={tab === "queue" ? "active" : ""} onClick={() => setTab("queue")}>Queue{state.queue.length ? " (" + state.queue.length + ")" : ""}</button>
          <button className={tab === "kit" ? "active" : ""} onClick={() => setTab("kit")}>
            Apply kit
          </button>
          <button className={tab === "tracker" ? "active" : ""} onClick={() => setTab("tracker")}>
            Tracker{state.applications.length > 0 ? ` (${state.applications.length})` : ""}
          </button>
        </nav>
        <div className="data-actions">
          <button onClick={download}>Export data</button>
          <label className="filebtn" title="Load a JobRadar data file (.json) - restores everything: resume, tracker, answers">
            Import data (.json)
            <input
              type="file"
              accept="application/json"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </label>
        </div>
      </header>

      {accepted && (
        <div className="celebrate no-print">
          🎉 You accepted an offer! If JobRadar helped, a one-time contribution funds the next
          student — completely optional, and the books are public. (Pay-it-forward link coming with
          the open ledger.)
        </div>
      )}

      {tab === "resume" && (
        <ResumePage resume={state.resume} onChange={(resume) => setState((s) => ({ ...s, resume }))} />
      )}
      {tab === "jobs" && (
        <JobsPage
          applications={state.applications}
          onChange={(applications) => setState((s) => ({ ...s, applications }))}
          resume={state.resume}
          answers={state.answers}
          preferences={state.search}
          onPreferencesChange={(search) => setState((s) => ({ ...s, search }))}
          queue={state.queue}
          onQueue={enqueue}
        />
      )}
      {tab === "kit" && (
        <ApplyKitPage
          resume={state.resume}
          answers={state.answers}
          onChange={(answers) => setState((s) => ({ ...s, answers }))}
        />
      )}
      {tab === "profile" && <ProfilePage profile={state.candidate} resume={state.resume} search={state.search} onChange={candidate => setState(s => ({ ...s, candidate }))} />}
      {tab === "queue" && <QueuePage entries={state.queue} profile={state.candidate} preferences={state.search} rules={state.applicationRules} onChange={queue => setState(s => ({ ...s, queue }))} onRules={applicationRules => setState(s => ({ ...s, applicationRules }))} onRunnerUpdate={runnerUpdate} />}
      {tab === "tracker" && (
        <TrackerPage
          applications={state.applications}
          onChange={(applications) => setState((s) => ({ ...s, applications }))}
        />
      )}

      <footer className="foot no-print">
        Built for your next chapter. Your search preferences, résumé and tracker stay in this browser.
        Export your data any time. USA & India.
      </footer>
    </div>
  );
}
