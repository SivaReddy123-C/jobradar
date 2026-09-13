import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mockDiscoveryFeed } from './discovery-feed-fixture.mjs';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1280,height:900}});
await mockDiscoveryFeed(page);
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const appUrl = process.env.JOBRADAR_TEST_URL || 'http://localhost:5174';
let configured=false, searches=0, fail=false, savedResult=null;
const status=()=>({configured,localMonthlyRequests:searches,localDailyRequests:searches,monthlyLimit:180,dailyLimit:20});
await page.route('**/__discovery', async route=>{
  const body=route.request().postDataJSON();
  if(body.action==='configure') { assert.equal(body.key,'SyntheticUIKey012345'); configured=true; return route.fulfill({json:status()}); }
  if(body.action==='status') return route.fulfill({json:status()});
  if(body.action==='restore') {
    assert.deepEqual(body.preferences.markets,['in']);
    return route.fulfill({json:savedResult ? {...savedResult,requestsUsed:0,queries:savedResult.queries.map(q=>({...q,cached:true}))} : {generatedAt:new Date().toISOString(),requestsUsed:0,localMonthlyRequests:searches,warnings:[],queries:[],jobs:[]}});
  }
  assert.equal(body.roleId,'accountant'); assert.deepEqual(body.preferences.markets,['in']); searches++;
  if(fail)return route.fulfill({status:400,json:{error:'Fixture provider access error'}});
  const at=new Date().toISOString();
  savedResult={generatedAt:at,requestsUsed:1,localMonthlyRequests:searches,warnings:[],queries:[{query:{role:'Accountant',roleId:'accountant',market:'in',query:'Accountant jobs in India',remote:false},returned:1,matches:1,cached:false,moreAvailable:false}],jobs:[{key:'jsearch:fixture-ui',company:'Fixture Coverage Co.',title:'Senior Accountant',country:'in',markets:['in'],location:'Pune, India',url:'https://employer.example/jobs/fixture',source:'jsearch',publishedAt:at,firstSeenAt:at,lastSeenAt:at,ghost:{score:0,band:'low',reasons:['Fixture: risk not assessed']},sponsorship:'unknown',hasSalaryInfo:false,discovery:{provider:'JSearch',publisher:'Fixture employer',originalUrl:'https://employer.example/jobs/fixture',direct:true}}]};
  return route.fulfill({json:savedResult});
});
try {
  for(let attempt=0;attempt<40;attempt++) {
    try {if((await fetch(appUrl,{signal:AbortSignal.timeout(500)})).ok)break;}
    catch { /* The CI dev server can still be starting; page.goto below reports failure. */ }
    await new Promise(r=>setTimeout(r,300));
  }
  await page.goto(appUrl);
  await page.locator('.role-option').filter({hasText:/^\+Accountant/}).click();
  await page.getByRole('button',{name:'Continue to locations →'}).click();
  await page.getByRole('checkbox',{name:'India India',exact:true}).check();
  const feedReady=page.waitForResponse(r=>r.url().endsWith('/in.json'));
  await page.getByRole('button',{name:'Show my jobs →'}).click(); await feedReady;
  const key=page.getByLabel('OpenWeb Ninja API key'); await key.fill('SyntheticUIKey012345');
  await page.getByRole('button',{name:'Save key locally'}).click();
  await page.getByText('Key saved.',{exact:false}).waitFor(); assert.equal(await key.count(),0);
  console.log('PASS: local setup UI saves through the local API and clears the key field (intercepted fixture)');
  await page.getByRole('button',{name:'Find additional jobs'}).click();
  await page.getByText('1 additional matching listings available',{exact:false}).waitFor();
  let card=page.locator('.job-card').filter({hasText:'Fixture Coverage Co.'});
  assert.equal(await card.count(),1); assert.match(await card.innerText(),/not assessed/);
  assert.equal(await page.locator('.job-card').filter({hasText:'Main Feed Fixture'}).count(),1);
  const onlyAdditional=page.getByLabel('Show only additional jobs (1)');
  assert.equal(await onlyAdditional.isChecked(),false);
  await onlyAdditional.check();
  assert.equal(await page.locator('.job-card').count(),1);
  console.log('PASS: discovery results join matching jobs with provider attribution and unassessed risk');
  await page.getByRole('button',{name:'Find additional jobs'}).click();
  await page.getByRole('button',{name:'Find additional jobs'}).waitFor(); assert.equal(await card.count(),1);
  assert.equal(await onlyAdditional.isChecked(),true);
  await onlyAdditional.uncheck();
  assert.equal(await page.locator('.job-card').count(),2);
  console.log('PASS: repeating a result does not add a duplicate card');
  const searchesBeforeReload=searches;
  await page.reload();
  await page.getByText('Saved search results restored automatically.',{exact:false}).waitFor();
  assert.equal(await card.count(),1); assert.equal(searches,searchesBeforeReload);
  assert.equal(await onlyAdditional.isChecked(),false);
  assert.equal(await page.locator('.job-card').filter({hasText:'Main Feed Fixture'}).count(),1);
  console.log('PASS: page reload restores cached listings alongside the main feed without a new provider search');
  fail=true; await page.getByRole('button',{name:'Find additional jobs'}).click();
  await page.getByText('Fixture provider access error').waitFor(); assert.equal(await card.count(),1);
  console.log('PASS: provider errors preserve previously displayed jobs');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('.discovery-panel').scrollIntoViewIfNeeded();
  if(process.env.JOBRADAR_SCREENSHOT) await page.screenshot({path:process.env.JOBRADAR_SCREENSHOT});
  console.log('PASS: mobile layout has no horizontal overflow');
  assert.deepEqual(errors,[]); console.log('PASS: browser has no runtime errors');
} finally {await browser.close();}
