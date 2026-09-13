# JobRadar — coverage, profiles and Ashby runner, September 13, 2026

The local branch `feat/role-first-usa-india` now includes an expanded USA/India feed, candidate profiles and the first Ashby application runner. It has not been pushed or deployed. No real applications were sent during this build.

JSearch follow-up: the local preview now includes private key entry and one-role, USA/India discovery with canonical-URL deduplication, explicit source attribution, 24-hour caching and durable request limits. The connector and six browser UI scenarios are fixture-verified. A live API key is not configured yet, so no live JSearch coverage gain is claimed. See [jobradar/JSEARCH.md](jobradar/JSEARCH.md).

- Users explicitly choose roles and USA, India, or both. The 51-role catalog across 17 fields also accepts custom titles. Matching remains deterministic; empty results do not broaden the search.
- Five verified boards were added: Accor Hotels, Westgate Resorts, KIPP Public Schools, School in the Square and DaVita. Structured SmartRecruiters country codes now survive normalization.
- The composite September 13 snapshot contains **28,563 supported-market records** (28,556 distinct source job keys): 24,260 USA and 4,303 India. This is **2,088 more records** than the preceding local snapshot. Seven listings appear in both market shards.
- Source collection is 330/342 successful boards; the feed discloses the 12 unavailable boards. The older component's timestamp is preserved. DaVita collection is capped at 2,000 global records, and only 94 had recognized supported-market evidence; that board is not complete.
- Front-desk matching now recognizes Indian titles such as GSA–Front Office and distinguishes food-and-beverage/housekeeping roles. Current title matches include 19 USA + 46 India front-desk roles and 30 USA + 30 India housekeeping roles. Teaching/nursing coverage in India remains empty in this snapshot. These counts are not market-size estimates or validated precision/recall measurements.
- **Profile** stores versioned contact facts, three PDF/DOCX résumé assets, independent market answers, compensation units and exact role/market-scoped question answers. Documents persist in IndexedDB. Legacy résumé/answers/tracker exports migrate without inferring country-specific eligibility.
- **Queue** provides individual selection or bounded automatic batches, exclusions, visible scope, stop controls, answer inspection and confirmation history. Only confirmed submissions enter the tracker.
- **JobRadar Assist 0.3** implements supported Ashby fields, résumé upload, value checks, durable progress, duplicate prevention and explicit attention/uncertain outcomes. It makes no AI calls. A browser restart never blindly retries an interrupted submit.
- The extension has been verified with synthetic, network-intercepted fixtures. A public Ashby form was inspected read-only. A small authorized live pilot is still required; universal Ashby coverage and production readiness are not claimed. Installation and limits are in [extension/README.md](extension/README.md).

Validation: **161 unit tests** (42 app, 107 collector, 12 extension), TypeScript checks, app/extension builds, **13 installed-extension browser scenarios**, and **6 discovery UI scenarios**. JSearch follow-up verification also confirms local credential/cache files are blocked by the development server and cross-origin discovery requests are rejected. App checks cover profile/resume persistence, separate market answers, queue creation, missing-profile gates, desktop/mobile layouts and a clean browser error log. No employer received fixture data.

Next release work: an authorized live pilot, the planned 200–300-posting labeled matching benchmark, additional nontechnical coverage where either market is sparse, and reducing the USA feed shard (14.6 MiB), which is too large for the existing browser local-storage cache. The next adapter should follow pilot evidence.

Daily refresh and sponsorship schedules remain paused. The legacy account-backed feed remains outside navigation. Supabase, accounts, billing and deployment are unchanged.

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
