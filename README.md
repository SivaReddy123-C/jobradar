# JobRadar — choose your role, find your next job

**Current scope: USA and India.** Choose the roles you want, see matching company-board listings, and save the facts and résumé you want employers to receive. The local build includes a queue and the first **Ashby auto-apply adapter**, verified on controlled browser fixtures. A live pilot is still required.

See [STATUS.md](STATUS.md) for coverage, validation and remaining work, and [extension/README.md](extension/README.md) to install JobRadar Assist 0.3. Shared deterministic rules power matching and application answers; these flows require no LLM subscription or per-application AI calls.

The local preview also has **My jobs → Search more job sites**, a bounded JSearch discovery trial with private key setup, USA/India matching, deduplication and a 24-hour cache. See [jobradar/JSEARCH.md](jobradar/JSEARCH.md). A real key and measured provider trial are still required; these results are not published by the static feed.

### Local development

From `jobradar/`, run `npm ci`, `npm run fetch`, then `npm run feed` to refresh public listings. From `app/`, run `npm ci` and `npm run dev`. The development server serves the local feed through `/__feed` at `http://localhost:5174`. The committed snapshot includes its collection date and unavailable-board warning.

Run `npm test` and `npm run typecheck` in `app/`, `jobradar/` and `extension/`; build the app and extension with `npm run build` in each. The extension also has an installed-browser fixture suite (see its README). CI includes all three packages.

### Applying

Complete **Profile**, select a saved PDF/DOCX, then use **Add to queue** on matching Ashby jobs. Connect the extension from **Queue** in the same Chrome/Edge browser. Inspect missing answers, select a bounded run, and authorize submission. The runner records confirmation or uncertainty and prevents automatic duplicate attempts. Other application sites remain available through their original links.

Search preferences and candidate data are local. JSON export includes profile facts and file references; download résumé files separately. An authorized application run sends the selected facts/document to the employer. Role/location matching is conservative and source coverage varies by profession. An empty result does not mean no employers are hiring. No production services or schedules were enabled by this build.

---

## Earlier project vision (historical)

The following predates the resumed scope. In particular, funding and application automation decisions require a separate product milestone.

# JobRadar — an honest job-search platform (working title)

> Free for students while they job-hunt. When you land a job, you can pay it
> forward to fund the next student. Open books, open source, no dark patterns.

**My bio/portfolio moved to [PROFILE.md](PROFILE.md).**

## Why this exists

Job seekers — especially students in India who have often already paid lakhs
for training — get looted twice: once by "placement guarantee" schemes, and
again by a job market full of postings that will never hire anyone, with no
feedback and no accountability. Every incumbent job platform makes money on
the listing side, so nobody fixes it.

This project takes the other side:

1. **Find real jobs** — aggregate postings from public ATS job-board
   endpoints: official APIs where they exist (Greenhouse, Lever, Ashby,
   SmartRecruiters) and, for Workday, the same public JSON endpoints its own
   career pages call — undocumented but unauthenticated and read-only. No
   scraping of rendered pages, no LinkedIn automation, no stored credentials.
2. **Flag ghost jobs** — score every posting on published, explainable
   signals (staleness, repost churn, evergreen "talent pool" titles, missing
   salary/location/description) so students stop wasting hours on postings
   that were never real.
3. **Track outcomes** — applied / replied / ghosted / interviewed / hired.
   Aggregated outcomes become an employer response scorecard nobody else
   will publish.

## Principles (the non-negotiables)

- **Pay-it-forward funding.** Free while job-hunting. One optional, one-time
  contribution after you're hired funds the next student. Never required,
  never nagged.
- **Open ledger.** Contributions in, costs out — published publicly, ugly
  months included.
- **Open source.** This repo is the product. Anyone can audit what it does
  or run it themselves.
- **Explainable flags.** Every ghost-risk score lists its exact reasons.
  If we flag a company's posting, the company can see why too.
- **No credential custody.** We never ask for or store anyone's LinkedIn or
  job-portal passwords. Anything acting on a user's behalf runs on the
  user's own machine, with the user confirming each submission.
- **Honest limits.** We cannot get anyone an interview, and mass-applying
  does not work. The product optimizes for outcomes, not application counts.
- **Every feature must end the session faster.** The daily list is short and
  allowed to be empty; the digest email closes with "go study"; assist fills
  forms but never submits. A feature that makes people apply MORE fails
  review here, however good it looks — that is the incumbent business model,
  and it is the one thing this project must never rebuild.

## Status

- **Phase 0** — `jobradar/`: ATS aggregator + ghost-job scorer. Live; a
  GitHub Action fetches all boards daily and commits stats
  (`jobradar/data/stats/`) — the beginning of the open ledger.
- **Phase 1** — `app/`: resume builder + application tracker. Local-first
  web app: all data stays in the user's browser (export/import JSON, no
  accounts, no server). Resume: live ATS-safe preview, two templates,
  print-to-PDF. Tracker: status pipeline, honest reply-rate stats,
  likely-ghosted detection after 21 days of silence, and the
  accepted-an-offer moment where pay-it-forward will live.

```bash
cd app
npm install
npm run dev     # local dev server
npm run build   # static production build in app/dist
```

- **Assisted apply** — `extension/`: the JobRadar Assist browser extension
  autofills Greenhouse/Lever/Ashby application forms from your app data
  (contact, links, Apply-kit answers), outlines everything it touched, and
  never submits — you review and click Submit. Install: load `extension/`
  unpacked via chrome://extensions (see `extension/README.md`).

Next: employer response scorecard from opt-in anonymous outcomes.

## Quick start

```bash
cd jobradar
npm install
npm run probe          # verify which seed-list company boards answer (network required)
npm run fetch          # pull all boards, snapshot, score
npm run report         # ghost-risk distribution + worst offenders
npm run report -- --india   # India-located postings only
npm run report -- --usa     # US-located postings, with sponsorship breakdown
npm test               # unit tests (no network needed)
```

The seed list (`jobradar/data/companies.seed.json`) ships **unverified** —
board tokens change and honesty beats pretending. Run `npm run probe`, fix
or remove what fails, and set `"verified": true` on what answers. PRs adding
verified India-relevant boards are the most useful contribution right now.

## How ghost scoring works

Each posting gets 0–100 from published weights (see `jobradar/src/ghost.ts`):
open ≥90 days (+40) or ≥45 days (+20) · evergreen/talent-pool title (+40) ·
reposted under multiple job ids (+25) · thin description (+15) · no salary
info (+10) · no location (+10). Bands: <25 low, <50 medium, <75 high,
≥75 critical. Signals sharpen as the snapshot history grows — the store
tracks when each role was first seen and every job id it has cycled through.

These are heuristics, stated as such. A high score means "spend your time
elsewhere first", not "this company is lying".

## Target

Two markets from day one, both of which we know firsthand:

- **India** — final-year students and freshers in tech, plus India-located
  roles at global companies on these ATS platforms.
- **USA** — with a focus on international students (F-1/OPT/H-1B). Every
  fetched posting is scanned for visa-sponsorship language: postings that
  say "unable to sponsor" are flagged **before** you spend an hour applying,
  and the rare ones that explicitly offer sponsorship are surfaced.
  "Doesn't say" is reported honestly as unknown, never assumed either way.

`npm run report -- --india` / `npm run report -- --usa` filter accordingly.
