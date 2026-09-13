# Hosted job discovery

The static app calls `job-discovery` using a confirmed Supabase Auth session. The function validates the JWT with `auth.getUser`, rejects anonymous accounts, applies shared role/country filters, and calls the fixed OpenWeb Ninja endpoint. It never accepts an API key, provider URL, user ID or quota from the browser. Candidate facts and résumé files remain local.

Project: `udvhqvdydkcqxkdzsdbg` (existing JobRadar project, free plan). The separate EaseDesk project is unrelated.

Activation on September 13: secret installed, new searches enabled, Auth URL configuration updated to `/jobradar/`, and authenticated live checks passed. India accountant: 4/10 matching listings; USA software engineer: 10/10. Two provider credits were spent; the shared ledger reached nine including seven earlier local calls. Browser sign-in, restoration, repeated search, reload and sign-out passed using cached results without further credits. Temporary accounts and their sessions were removed. New-account email delivery is not yet verified for public rollout.

## Deploy

1. Install dependencies in `jobradar/` and run `npm run build:discovery`. The generated `functions/job-discovery/core.js` is ignored and must be rebuilt before each deployment.
2. `migrations/20260913071624_hosted_discovery.sql` and `migrations/20260913101337_discovery_pagination.sql` are already applied to this project. Their filenames match deployed migration history; do not reapply them. For a fresh project, apply both once in order. The first migration starts new searches **disabled**. Its private `jr_discovery` schema is not exposed to PostgREST. Tables have RLS with no public policies; only the service role has access. Public RPC entry points use SECURITY INVOKER and revoke execution from PUBLIC, anon and authenticated. The remote project's earlier August migrations predate this local Supabase directory; reconcile that baseline before using CLI `db push` rather than marking earlier migrations reverted.
3. Sign into the Supabase CLI. Use `supabase secrets set --project-ref udvhqvdydkcqxkdzsdbg --env-file <private-env-file>` with only `OPENWEBNINJA_API_KEY`. Never pass a secret value as a shell argument or commit an env file.
4. Run `supabase functions deploy job-discovery --project-ref udvhqvdydkcqxkdzsdbg --use-api`. Keep JWT verification enabled. The entry point pins Supabase JS 2.112.4 and uses the platform-provided server secret.
5. Configure Auth's site URL and allowed redirect URL for `https://sivareddy123-c.github.io/jobradar/`. Keep email confirmation enabled. Verify email delivery before inviting new accounts: Supabase's default mail service has recipient/rate restrictions; custom SMTP is required for general public registration. Existing confirmed accounts can sign in independently of confirmation-email delivery.
6. Run the SQL regression in `jobradar/tests/hosted-discovery.sql` while new searches are paused and usage is below the test limits. It rolls all fixture data and settings back. Run collector/app tests and `extension`'s `test:hosted-discovery` against the default dev server. The browser test intercepts all auth/search requests and sends no email or provider request.
7. Reconcile previous calls made with the same provider key into the private request ledger before enabling. September 13's seven local requests were imported as `previous-local` records. Enable with `update jr_discovery.settings set enabled=true where singleton;` after the secret and an authenticated smoke test are ready. Then publish the app.

## Budgets and behavior

- One new page per selected country per click, at most two provider calls. Explicit **Fetch more results** follows saved provider cursors, up to five pages per query. No scheduled searches or automatic retry. Existing daily/account caps can stop a search earlier.
- Cursors remain private. Clients receive opaque page identifiers that the server validates against the saved query chain. Replaying an earlier continuation returns cache without advancing again. Each page uses the same atomic reservation, lease and failure accounting as the first page. Repeated provider cursors terminate the chain. Pages from the earlier cursorless implementation are kept until normal expiry; starting a paginated query needs a fresh first page once.
- **Search by title** offers the selected role's existing title aliases. The server accepts only those aliases, then applies the same role, country, city and other preference filters. An alternate title has its own shared cache; choose it again to restore its pages. Arbitrary query strings or adjacent roles are rejected.
- Global limit: 180 requests over a rolling 30 days and 20 per UTC day. Per account: 3 per UTC day. Failures count. These are JobRadar's limits, not the provider's authoritative remaining balance.
- Durable reservations use a database advisory transaction lock. Concurrent identical requests share a 75-second lease; only one can spend a credit. A failed query has a 10-minute cooldown.
- Queries share a 24-hour cache across accounts. Cache hits bypass the new-search limits. Restoration reads only matching cached query keys and cannot call the provider. Known posting dates older than 30 days are excluded on every read.
- Cache rows retain only title, employer, location, dates, salary-presence and application-link fields used by matching. Full descriptions and recruiter contacts are discarded. Fresh pages are available for 24 hours; stale rows are purged on subsequent reservations after two further days. Request/account IDs older than 31 days are purged on subsequent reservations. Access-rate entries older than a day are purged on subsequent requests. This is cleanup on access, not a scheduled deletion guarantee.
- Each authenticated account has a 30-request/minute gateway allowance, with a global 240/minute cap, separate from provider credits.
- The default dev app also uses hosted discovery. An explicitly enabled `VITE_LOCAL_DISCOVERY=true` trial and the collector CLI keep independent local counters. Avoid running them against the hosted key without reconciling usage; hosted counters cannot see external software's calls.
- Exact application URLs and source IDs are deduplicated. Separate publishers may still advertise the same vacancy. This release does not extend automated application coverage.

## Checks and operations

`jobradar/tests/hosted-discovery.test.ts` tests the HTTP handler using a fake provider. The SQL regression checks actual privileges, RLS, lease ownership, expiration, cooldown, quotas and access limits. Deployed concurrency verification used two simultaneous reservations and observed one `reserved` and one `busy`, then removed only those fixture records.

`jobradar/tests/discovery-pagination.sql` checks the deployed cursor wrappers as the service role inside a rolled-back transaction; it needs two available global credits but leaves no reservations or fixtures. Browser fixtures now also cover next-page failure/retry, combined main-feed results, restoration of multiple pages and alternate-title selection. See `jobradar/COVERAGE-2026-09-13.md` for the live pagination and employer coverage measurements.

Pause new searches with `update jr_discovery.settings set enabled=false where singleton;`. Cached restoration still works. Never reset the ledger to fix a provider quota error. Changing a secret does not require republishing the public app. Inspect function logs and aggregate request states without logging bearer tokens, provider keys or passwords.

The security advisor reports [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) for the four private tables; this intentionally denies all client access. The project also has an existing [leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). It has not been upgraded to a paid plan. Existing performance advisories concern the unused legacy account-feed tables, not the discovery schema.

Before a paid or broadly distributed launch, confirm provider redistribution/caching rights for the chosen plan, configure production email delivery, and load-test within an agreed provider budget. This bounded beta does not claim unlimited coverage or public-registration readiness.
