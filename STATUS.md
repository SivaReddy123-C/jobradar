# JobRadar — development resumed, September 13, 2026

The first resumed milestone implements role selection and a personalized USA/India feed. It is on the local branch `feat/role-first-usa-india`; it has not been deployed.

- Users explicitly choose roles and USA, India, or both. The resume does not choose roles for them.
- Shared deterministic matching handles known titles and user-defined title phrases. No AI calls are needed for this search flow.
- The current catalog covers 51 roles across 17 fields, with custom roles available. This is not universal coverage.
- Empty results stay empty. Optional location, experience and work-arrangement filters require positive evidence.
- Existing local resume, answers, tracker and JSON exports migrate without losing data.
- The collector publishes only two market shards, with title classifications, last-seen dates and partial-source warnings.
- Remote without explicit geographic evidence is not assumed to be available in either country.
- Development preview serves the locally generated public feed. Production still points to the committed feed on main.
- Daily refresh and sponsorship schedules remain paused. The account-backed feed is no longer in the navigation; its legacy modules remain for a later migration.
- Automatic application submission, accounts and paid plans are not implemented in this milestone.

Validation: 38 app tests and 93 pipeline tests; app production build and both TypeScript checks. Browser checks cover saved selections, India accountant results, USA frontend results, empty results, existing navigation and mobile overflow. This is functional validation, not the planned large labeled precision/recall benchmark.

Current source coverage is uneven. The September 13 run fetched 61,318 jobs from 325/337 boards. Its supported-market output contains 26,475 records (26,468 distinct source job keys): 22,891 USA and 3,584 India. Twelve unavailable boards are disclosed in the feed. Hotel front-desk coverage was empty in this snapshot. This does not measure the wider job market.

Next: expand coverage for nontechnical occupations, validate matching on a labeled sample, then build one application-site adapter with stored candidate answers, explicit submission scope, duplicate prevention and verifiable submission results.

---

## Archived August 27 assessment

The following is historical project context, not the current plan or a current operational-status claim.

# JobRadar — stopped 2026-08-27

Siva called it: *"we are wasting so much time digging real and genuine job
postings and we struggle to find them. The loop is closed and this is the
validation we want. There is no future in this."*

That is a result, not a failure. What it established, plainly:

## What worked

- **Collection is easy and free.** 337 company boards across seven public ATS
  APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee,
  Workday) produce ~60,000 open postings across 47 countries, nightly, on
  GitHub Actions, at no cost. No scraping, no ToS violation.
- **Ghost postings are real and measurable.** 46 postings scored critical, 7,100
  high. One "General Application" had been open **1,062 days**. Every score
  carries its reasons in plain text.
- **Federal sponsorship records join cleanly to live jobs.** 122,857 USCIS H-1B
  filings matched to 104 employers with openings, published at
  `app/public/sponsors.html`. Nothing free publishes this.

## What did not

**Aggregation was never the hard part.** For one real person with real
constraints — needs visa sponsorship, hospitality background, countries he can
legally work in — the honest count of reachable postings was **71**. That is
the market, not a bug, and no amount of engineering moves it.

The two things with genuine signal (ghost detection, sponsorship records) are
both about **exposing what employers hide**, not about aggregating jobs. If
there is a product anywhere in here, it is that, and it is much smaller than
what was built.

## State

- All scheduled workflows are **paused** (the `schedule:` blocks are commented
  out in `.github/workflows/`). Nothing runs unattended. Uncomment two lines to
  resume; `workflow_dispatch` still works for a manual run.
- Supabase project `udvhqvdydkcqxkdzsdbg` still holds the data. It costs
  nothing idle and can be deleted from the Supabase dashboard.
- `sponsors.html` stays live at
  https://sivareddy123-c.github.io/sivareddy/sponsors.html — static, no
  backend, no upkeep. It will not go stale in any way that misleads: the page
  names its fiscal year and says absence is evidence, not proof.
- 91 pipeline + 22 app tests pass. The repo is in a clean, working state.

## If anyone picks this up later

Read `jobradar/src/ghost.ts` and `jobradar/src/sponsorship.ts` first — those are
the parts that were worth building. The rest is plumbing around them.
