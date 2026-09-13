// Keep discovery UI assertions independent of the changing employer snapshot.
export async function mockDiscoveryFeed(page) {
  const at = new Date().toISOString();
  await page.route(/\/(?:__feed|feed)\/(?:index|in)\.json$/, async route => {
    if (new URL(route.request().url()).pathname.endsWith('/index.json')) return route.fulfill({ json: {
      generatedAt: at, total: 1, shards: [{ country: 'in', jobs: 1, bytes: 1000, file: 'in.json' }],
    } });
    return route.fulfill({ json: {
      generatedAt: at, country: 'in', total: 1, sponsors: {}, industries: {}, jobs: [{
        key: 'lever:main-feed-fixture', company: 'Main Feed Fixture', title: 'Accountant',
        location: 'Pune, India', markets: ['in'], url: 'https://employer.example/jobs/main-feed',
        source: 'lever', publishedAt: at, firstSeenAt: at,
        ghost: { score: 0, band: 'low', reasons: [] }, sponsorship: 'unknown', hasSalaryInfo: false,
      }],
    } });
  });
}
