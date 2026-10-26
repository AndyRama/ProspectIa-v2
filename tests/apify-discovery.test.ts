import { emailPricing, emailMetadataResponse } from './fixtures/apify-email';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
test('Local fixture: 37 catalog identities excluded before POST; stable monitor and idempotency', async () => {
 const dir=await mkdtemp(path.join(tmpdir(),'apify-discovery-')); process.env.DATA_DIR=dir;
 const {db,setSetting,getSetting}=await import('../server/db');
 const original=globalThis.fetch;
 try {
  const service=await import('../server/services/apifyDiscovery');
  assert.equal(typeof service.verifyApifyDiscovery,'function');
  assert.equal(service.safeMapsUrl('https://google.com.evil/maps/place/test'),false);
  assert.equal(service.safeMapsUrl('https://maps.google.fr/maps/place/test'),true);
  assert.equal(service.safeMapsUrl('https://maps.app.goo.gl/test'),false);
  for(let i=0;i<37;i++) await db.execute({sql:'INSERT INTO prospects VALUES(?,?)',args:['old-'+i,JSON.stringify({id:'old-'+i,demo:false,fields:{placeId:{value:'ChIJ'+String(i).padStart(23,'0')}}})]});
  const args={city:' Paris ',activity:'restaurant',keyword:'',max:25,budget:1,engine:'website' as const};
  const calls:any[]=[];
  globalThis.fetch=async(url:any,init?:RequestInit)=>{
   const u=String(url); calls.push({url:u,body:init?.body?JSON.parse(String(init.body)):null});
   const props:any={}; for(const [k,type] of Object.entries({requireEmail:'boolean',skipClosed:'boolean',countryCode:'string',mode:'string',query:'string',location:'string',onlyNew:'boolean',monitorId:'string',excludePlaceIds:'array',excludePlaceUrls:'array',maxResults:'integer',language:'string',includeReviews:'boolean',includePhotos:'boolean',includeLeadScore:'boolean',debugMode:'boolean'})) props[k]={type,...(type==='array'?{items:{type:'string'}}:{})};
   return u.includes('/runs?') ? Response.json({data:{id:'fixture-run'}}) : emailMetadataResponse(url);
  };
  const plan=await service.planApifyDiscovery(args); assert.equal(plan.excludedCount,37);
  assert.equal(await service.startApifyDiscovery('fixture-token',{...args,planId:plan.planId,requestId:'request-1'}),'fixture-run');
  const post=calls.find(c=>c.body); assert.equal(post.body.excludePlaceIds.length,37); assert.equal(post.body.onlyNew,true); assert.ok(post.body.monitorId); assert.equal(new URL(post.url).searchParams.get('maxItems'),null);
  assert.equal(await service.startApifyDiscovery('fixture-token',{...args,planId:plan.planId,requestId:'request-1'}),'fixture-run'); assert.equal(calls.filter(c=>c.body).length,1);
  assert.equal((await getSetting<any>('apifyPending',null)).placeIds,undefined);
  await setSetting('apifyPending',null); assert.equal((await service.planApifyDiscovery({...args,city:'Lyon'})).excludedCount,37);
  assert.equal((await getSetting<any>('apifyEmailDiscoveryMonitorId',null)),post.body.monitorId);
  await service.planApifyDiscovery({...args,engine:'menu'});
  await service.planApifyDiscovery({...args,engine:'voice'});
  for(const [max,budget] of [[0,1],[26,1],[25,.01],[25,11],[1,NaN]]) await assert.rejects(()=>service.planApifyDiscovery({...args,max,budget}),/Plafonds/);
  await setSetting('limits',{max:2,budget:.2});await assert.rejects(()=>service.startApifyDiscovery('fixture',{...args,planId:plan.planId,requestId:'blocked'}),/plafonds/);await setSetting('limits',{max:25,budget:1});
  const stale=await service.planApifyDiscovery(args);
  await db.execute({sql:'INSERT INTO apify_place_claims VALUES(?,NULL,?)',args:['18446744073709551615',new Date().toISOString()]});
  await assert.rejects(()=>service.startApifyDiscovery('fixture',{...args,planId:stale.planId,requestId:'stale'}),/périmé/);
  const postsBefore=calls.filter(c=>c.body).length;
  for(let batch=0;batch<3;batch++) {
   const next=await service.planApifyDiscovery(args);await service.startApifyDiscovery('fixture',{...args,planId:next.planId,requestId:'batch-'+batch});
   const sent=calls.filter(c=>c.body).at(-1).body;assert.equal(sent.monitorId,post.body.monitorId);assert.ok(sent.excludePlaceIds.includes('18446744073709551615'));
   for(let i=0;i<25;i++){const id='ChIJ'+String(100+batch*25+i).padStart(23,'0');assert.ok(!sent.excludePlaceIds.includes(id));await db.execute({sql:'INSERT INTO prospects VALUES(?,?)',args:['batch-'+batch+'-'+i,JSON.stringify({id:'batch-'+batch+'-'+i,fields:{placeId:{value:id}}})]});}
   await setSetting('apifyPending',null);await db.close();
  }
  assert.equal(calls.filter(c=>c.body).length,postsBefore+3);assert.equal((await service.planApifyDiscovery(args)).excludedCount,113);
  await db.execute({sql:'INSERT INTO searches VALUES(?,?)',args:['historical-reference',JSON.stringify({id:'historical-reference',provider:'Apify',ids:['apify-ChIJ'+'z'.repeat(23)]})]});
  assert.equal((await service.planApifyDiscovery(args)).excludedCount,114);
  await db.execute({sql:'INSERT INTO prospects VALUES(?,?)',args:['url-only',JSON.stringify({id:'url-only',fields:{name:{value:'URL fixture',url:'https://www.google.com/maps/place/URL-fixture'}}})]});
  assert.equal((await service.planApifyDiscovery(args)).blocked,true);
  await db.execute("DELETE FROM prospects WHERE id='url-only'");
  const fixtureFetch=globalThis.fetch;
  for(const drift of ['pricing','schema']) {
   globalThis.fetch=async(url:any,init?:RequestInit)=>{const r=await fixtureFetch(url,init);const value:any=await r.json();if(drift==='pricing'&&value.data?.currentPricingInfo)value.data.currentPricingInfo.pricingModel='PAY_PER_RESULT';if(drift==='schema'&&value.data?.actorDefinition)value.data.actorDefinition.input=JSON.stringify({properties:{}});return Response.json(value);};
   await assert.rejects(()=>service.planApifyDiscovery(args),/Schéma|Tarification/);assert.equal(await getSetting('apifyPending',null),null);
  }
  globalThis.fetch=async(url:any,init?:RequestInit)=>{if(init?.method==='POST')throw Error('fixture network uncertainty with secret must not escape');return fixtureFetch(url,init);};
  const uncertain=await service.planApifyDiscovery(args);await assert.rejects(()=>service.startApifyDiscovery('fixture',{...args,planId:uncertain.planId,requestId:'uncertain'}),e=>/verrou est conservé/.test(String(e))&&!String(e).includes('secret'));
  await assert.rejects(()=>service.startApifyDiscovery('fixture',{...args,planId:uncertain.planId,requestId:'uncertain'}),/déjà en cours/);assert.equal((await getSetting<any>('apifyPending',null)).runId,null);
  await setSetting('apifyPending',null);
  globalThis.fetch=async(url:any,init?:RequestInit)=>init?.method==='POST'?Response.json({data:{} }):fixtureFetch(url,init);
  await assert.rejects(()=>service.startApifyDiscovery('fixture',{...args,planId:uncertain.planId,requestId:'bad-ack'}),/Accusé/);assert.ok(await getSetting('apifyPending',null));
  await setSetting('apifyPending',null);
  globalThis.fetch=async(url:any,init?:RequestInit)=>init?.method==='POST'?new Response('{}',{status:400}):fixtureFetch(url,init);
  await assert.rejects(()=>service.startApifyDiscovery('fixture',{...args,planId:uncertain.planId,requestId:'reject'}),/HTTP 400/);assert.equal(await getSetting('apifyPending',null),null);
 } finally {globalThis.fetch=original; await db.close();await rm(dir,{recursive:true,force:true});}
});
