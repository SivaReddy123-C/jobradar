# JSearch discovery trial

This local integration expands discovery beyond the curated employer boards. It queries one selected role in the user's selected USA/India markets, applies JobRadar's existing matching rules, and deduplicates against the employer feed by canonical application URL. It does not alter the published feed or send applications.

## Connect and use

Start the app with `npm run dev` from `app/`, then open `http://localhost:5174`. Choose roles and markets, and open **My jobs → Search more job sites**. Paste an OpenWeb Ninja key into the password field and click **Save key locally**. The collector stores it in `jobradar/.env.local`, excluded from Git and denied by the local web server. The browser clears the field after saving. A saved key has not been validated by the provider until a search succeeds.

Alternatively, copy `.env.example` to `.env.local` in this directory and set `OPENWEBNINJA_API_KEY`. Existing process environment variables take precedence. The key is sent only in the `x-api-key` header to `https://api.openwebninja.com`; redirects are rejected. No profile facts, résumé or application answers are sent to JSearch.

Select one of the roles already in your search and click **Find additional jobs**. The request asks for postings from the last month, one page per selected country. Each returned record still has to match the selected role, country, location, work arrangement and experience filters. Empty results never broaden the search.

New unique matches are shown with a **Show only additional jobs** checkbox; clear it to return to the combined feed. Results include the provider/publisher and remain unassessed for posting risk. Prefer explicit direct application options from the response. Discovery-only listings currently use **View & apply**; this trial does not extend the Ashby runner to new source types.

## Request budget and local data

- One page per country per click, at most two requests. No automatic pagination, retry, paid subscription or background refresh.
- The provider's documented `num_pages` limit charges a request credit per result page. The implementation sends `num_pages=1`.
- A normalized role/location/country query is cached on disk for 24 hours. Repeating it, even after restarting the dev server, reuses the cached page. Changing eligibility filters can reuse a page, but reapplies matching locally.
- Requests are reserved durably before the API call. Failed requests count toward JobRadar's local ceiling: 20 per UTC day and 180 per UTC calendar month.
- These counters cover this installation only. They are not the provider's remaining allowance, and may have a different reset date. Calls from other software are not included. Provider authentication/rate-limit responses stop the run.
- Results and counters live under ignored `jobradar/data/jsearch/`. They are denied by the development server and are not added to the committed feed. The app's current discovered list is held in memory; after reload, repeat the search to reuse its cached page.
- A process lock prevents concurrent collectors from spending twice. After a crash, verify no collector is running before removing `data/jsearch/request.lock`. Preserve `usage.json` to retain the local budget record.

The UI and API are enabled only by the local Vite development server, bound to loopback on port 5174. The API requires matching Host/Origin and POST. A static production build has no discovery panel, provider credential or discovery endpoint. Account-backed hosting and production credentials are separate work.

## CLI comparison

From `jobradar/`:

```sh
npm run jsearch -- --status
npm run jsearch -- accountant in
npm run jsearch -- front-desk us
```

Each command queries one page (or cache) and writes a private `data/jsearch/trial-<role>-<country>.json` with returned/matching/additional/exact-duplicate counts and records. No additional live-employer checks are implied. Job IDs in URL parameters are retained; only known tracking parameters are removed. Different requisitions with identical titles are not merged based on title alone.

## Verification and release limits

`npm test` and `npm run typecheck` in `jobradar/` cover query scope, country evidence, expired/invalid records, unknown response schemas, direct-link choice, deduplication, cache reuse, quota reservation, concurrency, origin checks and credential storage. App tests verify that unassessed results do not sort as low risk.

With the local app running and extension dependencies installed, run `npm run test:discovery` in `extension/`. Its browser fixture intercepts every discovery call and verifies key setup, result integration, duplicate suppression, retained results after errors, mobile layout and runtime errors. CI starts the local app for this test. Synthetic keys are never written to the real collector during this test.

The connector has not established live coverage until a real key is configured and a measured trial succeeds. Do not claim access to all LinkedIn jobs, independent vacancy verification, or improved matching accuracy from fixture results. Public redistribution/production rights need confirmation separately from the provider's technical access; this build keeps the trial local.

Sources: [JSearch product and pricing](https://www.openwebninja.com/api/jsearch), [official generated API schema](https://github.com/OpenWeb-Ninja/openwebninja-mcp/blob/main/src/generated/manifest.ts), [provider terms](https://www.openwebninja.com/terms).
