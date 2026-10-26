import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';

test('business contact plan reuses monitor, warns on unknown rows, preserves exclusions and consent', async () => {
 const dir=await mkdtemp('/opt/data/cache/scratch/business-restore-');process.env.DATA_DIR=dir;process.env.TURSO_DATABASE_URL='';process.env.TURSO_AUTH_TOKEN='';
 const {db,setSetting,getSetting}=await import('../server/db');const svc=await import('../server/services/apifyDiscovery');
 const metadata=JSON.parse(await readFile(new URL('./fixtures/apify-business-metadata.json',import.meta.url),'utf8'));
 const build=JSON.parse(await readFile(new URL('./fixtures/apify-business-build.json',import.meta.url),'utf8'));
 const original=globalThis.fetch;const calls:any[]=[];
 globalThis.fetch=async(url:any,init?:RequestInit)=>{calls.push({url:String(url),init});if(init?.method==='POST')return Response.json({data:{id:'business-run'}});assert.equal((init?.headers as any)?.Authorization,undefined);return Response.json(String(url).endsWith('/builds/default')?build:metadata);};
 try {
  await setSetting('apifyDiscoveryMonitorId','existing-business-monitor');
  for(const p of [{id:'import-unknown',fields:{}},{id:'apify-unknown-archived',archived:true,fields:{}},{id:'url-only',fields:{googleMaps:{value:'https://www.google.com/maps/place/Fixture'}}},{id:'known',fields:{cid:{value:'18446744073709551615'}}}])await db.execute({sql:'INSERT INTO prospects VALUES(?,?)',args:[p.id,JSON.stringify(p)]});
  const args={city:'Papeete',activity:'restaurant',keyword:'',max:25,budget:1,engine:'website' as const};
  const plan=await svc.planApifyDiscovery(args);assert.equal(plan.actor,'benthepythondev/google-maps-business-scraper');assert.equal(plan.build,'1.0.34');assert.equal(plan.blocked,false);assert.equal(plan.unidentifiedCount,3);assert.ok(plan.warnings.some(w=>/non.*exclu|sans identit/i.test(w)));assert.equal((plan.coverage as any).scrapeContacts,true);assert.equal(plan.coverage.requireEmail,false);
  assert.equal(plan.pricing.events['apify-default-dataset-item'].eventTieredPricingUsd.FREE.tieredEventPriceUsd,.0015);
  assert.equal(calls.filter(c=>c.init?.method==='POST').length,0);
  await svc.startApifyDiscovery('fixture-token',{...args,planId:plan.planId,requestId:'business-request'});
  const post=calls.find(c=>c.init?.method==='POST');assert.match(post.url,/business-scraper\/runs\?build=1.0.34/);const input=JSON.parse(post.init.body);
  assert.equal(input.monitorId,'existing-business-monitor');assert.equal(input.scrapeContacts,true);assert.equal(input.includeReviews,true);assert.equal(input.includePhotos,true);assert.equal(input.includeLeadScore,true);assert.equal(input.requireEmail,undefined);assert.equal(input.onlyNew,true);assert.deepEqual(input.excludePlaceIds,['18446744073709551615']);assert.deepEqual(input.excludePlaceUrls,['https://www.google.com/maps/place/Fixture']);
  assert.equal((await getSetting<any>('apifyPending',null)).actorId,'uU8ybh0dgvI68Q3o2');
  await setSetting('apifyPending',null);build.data.actorDefinition.input.properties.scrapeContacts.description+=' changed';
  await assert.rejects(()=>svc.startApifyDiscovery('fixture-token',{...args,planId:plan.planId,requestId:'drift'}),/périmé/);assert.equal(calls.filter(c=>c.init?.method==='POST').length,1);
 } finally{globalThis.fetch=original;await db.close();await rm(dir,{recursive:true,force:true});}
});
