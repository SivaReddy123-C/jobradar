import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
let searches = 0, saved = null;
const url = process.env.JOBRADAR_TEST_URL || 'http://localhost:5174';
const user = { id: '63c5e320-d2b9-4700-a810-35b282a4e721', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.com', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} };
const token = [ { alg: 'HS256', typ: 'JWT' }, { sub: user.id, exp: Math.floor(Date.now()/1000)+3600, role: 'authenticated' } ].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture';
await page.route('**/auth/v1/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/signup')) return route.fulfill({ json: { user, session: null } });
  if (path.endsWith('/logout')) return route.fulfill({ status: 204 });
  if (path.endsWith('/user')) return route.fulfill({ json: user });
  if (path.endsWith('/token')) return route.fulfill({ json: { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'fixture-refresh', user } });
  throw new Error('Unexpected auth request: '+path);
});
await page.route('**/functions/v1/job-discovery', async route => {
  const body = route.request().postDataJSON();
  assert.equal(route.request().headers().authorization, 'Bearer '+token);
  assert.ok(!JSON.stringify(body).includes('fixture@example.com'));
  assert.ok(Object.keys(body).every(k => ['action','preferences','roleId'].includes(k)));
  if (body.action === 'status') return route.fulfill({ json: { configured: true, enabled: true, localMonthlyRequests: searches, localDailyRequests: searches, userDailyRequests: searches, monthlyLimit: 180, dailyLimit: 20, userDailyLimit: 3 } });
  if (body.action === 'restore') return route.fulfill({ json: saved ? { ...saved, requestsUsed: 0, queries: saved.queries.map(q => ({ ...q, cached: true })) } : { jobs: [], queries: [], warnings: [], requestsUsed: 0, localMonthlyRequests: searches, generatedAt: new Date().toISOString() } });
  assert.equal(body.roleId, 'accountant'); assert.deepEqual(body.preferences.markets, ['in']); searches++;
  const at = new Date().toISOString();
  saved = { jobs: [{ key: 'jsearch:hosted-ui', company: 'Hosted Fixture Company', title: 'Accountant', country: 'in', markets: ['in'], location: 'Pune, India', url: 'https://employer.example/jobs/hosted-ui', source: 'jsearch', publishedAt: at, firstSeenAt: at, lastSeenAt: at, ghost: { score: 0, band: 'low', reasons: ['Not assessed'] }, sponsorship: 'unknown', hasSalaryInfo: false, discovery: { provider: 'JSearch', publisher: 'Fixture Employer', originalUrl: 'https://employer.example/jobs/hosted-ui', direct: true } }], queries: [{ query: { role: 'Accountant', roleId: 'accountant', market: 'in' }, matches: 1, returned: 1, cached: false, moreAvailable: false }], warnings: [], requestsUsed: 1, localMonthlyRequests: searches, generatedAt: at };
  return route.fulfill({ json: saved });
});
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) break; } catch { /* Startup wait only; page.goto reports failure. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  await page.goto(url);
  await page.locator('.role-option').filter({ hasText: /^\+Accountant/ }).click();
  await page.getByRole('button', { name: 'Continue to locations →' }).click();
  await page.getByRole('checkbox', { name: 'India India', exact: true }).check();
  await page.getByRole('button', { name: 'Show my jobs →' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(searches, 0); assert.equal(await page.getByLabel('OpenWeb Ninja API key').count(), 0);
  console.log('PASS: hosted discovery requires sign-in and has no API-key input');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('SyntheticPasswordOnly');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByText('Check your email to confirm your account', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), ''); assert.equal(searches, 0);
  console.log('PASS: signup asks for email confirmation and clears the password');
  await page.getByRole('button', { name: 'Use an existing account' }).click();
  await page.getByLabel('Password', { exact: true }).fill('SyntheticPasswordOnly');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Find additional jobs' }).click();
  await page.getByText('1 additional matching listings available', { exact: false }).waitFor();
  await page.getByText('You have used 1/3 new requests today.', { exact: false }).waitFor();
  assert.equal(await page.locator('.job-card').filter({ hasText: 'Hosted Fixture Company' }).count(), 1);
  console.log('PASS: authenticated search sends only preferences and shows account/shared limits');
  await page.reload(); await page.getByText('Saved search results restored automatically.', { exact: false }).waitFor();
  assert.equal(searches, 1);
  console.log('PASS: hosted cache restores after reload without a new search');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Find additional jobs' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: mobile layout, sign-out and browser runtime checks');
} finally { await browser.close(); }
