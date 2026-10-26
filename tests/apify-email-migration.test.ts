import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';

test('email actor anonymous priced plan binds input, rejects unsafe migration, and preserves old pending', async () => {
 const dir=await mkdtemp('/opt/data/cache/scratch/apify-email-'); process.env.DATA_DIR=dir;
 const {db,setSetting,getSetting}=await import('../server/db');
 const service=await import('../server/services/apifyDiscovery');
 const {collectApify,recoverApify}=await import('../server/services/apify');
 const original=globalThis.fetch; const calls:any[]=[];
 const metadata=JSON.parse(await readFile(new URL('./fixtures/apify-email-metadata.json',import.meta.url),'utf8'));
 const build=JSON.parse(await readFile(new URL('./fixtures/apify-email-build.json',import.meta.url),'utf8'));
 let row:any={name:'Email business',primary_email:'hello@atelier-fixture.fr',emails:[{email:'hello@atelier-fixture.fr',source:'contact_page',confidence:90,verified:null}],email_verified:null,place_id:'ChIJ'+'a'.repeat(23),google_maps_url:'https://www.google.com/maps?cid=18446744073709551615',cid:'18446744073709551615',socials:{instagram:'https://instagram.com/example'},phone:'+33123456789'};
 let actId='4MTxdHfGoKTLDoTrD';
 globalThis.fetch=async(url:any,init?:RequestInit)=>{const u=String(url);calls.push({url:u,init});
  if(init?.method==='POST') return Response.json({data:{id:'email-run'}});
  if(u.includes('actor-runs/'))return Response.json({data:{id:'email-run',actId,status:'SUCCEEDED',finishedAt:'2026-01-01T00:00:00Z',defaultDatasetId:'email-data'}});
  if(u.includes('datasets/'))return Response.json([row]);
  return Response.json(u.endsWith('/builds/default')?build:metadata);
 };
 try {
  const args={city:'Paris',activity:'restaurant',keyword:'',max:25,budget:1,engine:'website' as const};
  const plan=await service.planApifyDiscovery(args);
  // The same build number with an edited schema must invalidate consent too.
  build.data.actorDefinition.input.properties.debugMode.description += ' contract drift';
  await assert.rejects(()=>service.startApifyDiscovery('fixture-token',{...args,planId:plan.planId,requestId:'schema-drift'}),/périmé|Schéma/);
  build.data.actorDefinition.input.properties.debugMode.description = build.data.actorDefinition.input.properties.debugMode.description.replace(' contract drift','');
  metadata.data.currentPricingInfo = {...metadata.data.pricingInfos.at(-1), startedAt:'2999-01-01T00:00:00Z'};
  await assert.rejects(()=>service.planApifyDiscovery(args),/Tarification/);
  delete metadata.data.currentPricingInfo;
  assert.equal(plan.actor,'benthepythondev/google-maps-email-scraper');
  assert.ok((plan as any).pricing.events['apify-default-dataset-item']);
  assert.equal((plan as any).coverage.requireEmail,true);
  assert.equal(calls.filter(c=>c.init?.method==='POST').length,0);
  assert.ok(calls.every(c=>!c.init?.headers?.Authorization));
  await service.startApifyDiscovery('fixture-token',{...args,planId:plan.planId,requestId:'email-request'});
  const input=JSON.parse(calls.find(c=>c.init?.method==='POST').init.body);
  assert.equal(input.requireEmail,true); assert.equal(input.onlyNew,true); assert.equal(input.excludePlaceUrls,undefined);
  const result:any=await collectApify('fixture-token');
  const {persistResults,resolveSearch}=await import('../server/searches');
  const saved=await persistResults(result.items,result.args,'Apify',result.cost,[],{kind:'discovery',query:result.args.query});
  await db.close();
  const reopened=await resolveSearch(saved.search);
  assert.equal(reopened.prospects[0].fields.email_evidence.value,result.items[0].fields.email_evidence.value);
  assert.equal(JSON.parse(reopened.prospects[0].fields.apifyProvenance.value).input.requireEmail,true);
  assert.equal(result.items[0].email,'hello@atelier-fixture.fr');
  assert.equal(result.items[0].fields.googleMaps.value,row.google_maps_url);
  assert.match(result.items[0].fields.email.source,/contact_page/);
  assert.doesNotMatch(result.items[0].fields.email.qualification,/délivrable|vérifié/i);
  await setSetting('apifyPending',null);
  await db.execute({sql:'INSERT INTO prospects VALUES(?,?)',args:['url-only',JSON.stringify({id:'url-only',fields:{googleMaps:{value:'https://www.google.com/maps/place/Unknown'}}})]});
  const unsafe:any=await service.planApifyDiscovery(args); assert.equal(unsafe.blocked,true);
  const before=calls.filter(c=>c.init?.method==='POST').length;
  await assert.rejects(()=>service.startApifyDiscovery('fixture-token',{...args,planId:unsafe.planId,requestId:'unsafe'}),/identit|exclu/i);
  assert.equal(calls.filter(c=>c.init?.method==='POST').length,before);
  await db.execute({sql:'UPDATE prospects SET data=? WHERE id=?',args:[JSON.stringify({id:'url-only',fields:{googleMaps:{value:'https://www.google.com/maps?cid=18446744073709551615'}}}),'url-only']});
  const safe:any=await service.planApifyDiscovery(args); assert.equal(safe.blocked,false);
  await service.startApifyDiscovery('fixture-token',{...args,planId:safe.planId,requestId:'safe'});
  assert.ok(JSON.parse(calls.filter(c=>c.init?.method==='POST').at(-1).init.body).excludePlaceIds.includes('18446744073709551615'));
  const paidPending:any=await getSetting('apifyPending',null);
  const collectionFetch=globalThis.fetch;
  let proof:any=paidPending.input;
  globalThis.fetch=async(url:any,init?:RequestInit)=>{
    assert.notEqual(init?.method,'POST');
    const u=String(url);
    if(u.includes('users/me'))return Response.json({data:{id:'fixture-owner'}});
    if(u.includes('records/INPUT'))return Response.json(proof);
    if(u.includes('actor-runs/'))return Response.json({data:{id:'email-recovered',actId:'4MTxdHfGoKTLDoTrD',userId:'fixture-owner',startedAt:new Date(Date.parse(paidPending.startedAt)+1000).toISOString(),defaultKeyValueStoreId:'fixture-kv'}});
    return collectionFetch(url,init);
  };
  for(const mutation of [{requireEmail:false},{countryCode:'de'},{placeUrls:['ChIJ'+'x'.repeat(23)]},{websites:['https://fixture.fr']}]) {
    await setSetting('apifyPending',{...paidPending,runId:null});proof={...paidPending.input,...mutation};
    await assert.rejects(()=>recoverApify('fixture-token','email-recovered'),/INPUT/);
    assert.equal((await getSetting<any>('apifyPending',null)).runId,null);
  }
  proof=paidPending.input;await recoverApify('fixture-token','email-recovered');
  assert.equal((await getSetting<any>('apifyPending',null)).runId,'email-recovered');
  globalThis.fetch=collectionFetch;
  actId='uU8ybh0dgvI68Q3o2'; row={name:'Legacy business',email:'old@atelier-fixture.fr',place_id:'ChIJ'+'b'.repeat(23),url:'https://www.google.com/maps?cid=2'};
  await setSetting('apifyPending',{mode:'discovery',actorSlug:'benthepythondev~google-maps-business-scraper',actorId:actId,runId:'email-run',max:50});
  assert.equal((await collectApify('fixture-token') as any).items[0].email,'old@atelier-fixture.fr');
  await setSetting('apifyPending',null);
  await db.execute({sql:'INSERT INTO searches VALUES(?,?)',args:['lost-history',JSON.stringify({id:'lost-history',provider:'Apify',ids:['apify-opaque-lost-identity']})]});
  assert.equal((await service.planApifyDiscovery(args)).blocked,true, 'lost historical identities cannot silently disappear during Actor migration');
 } finally {globalThis.fetch=original;await db.close();await rm(dir,{recursive:true,force:true});}
});
