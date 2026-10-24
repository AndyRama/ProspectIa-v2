import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('Local fixture: discovery normalization, finalization, malformed data and recovery input proof',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'apify-recovery-'));process.env.DATA_DIR=dir;
 const {db,setSetting,getSetting}=await import('../server/db');const {collectApify,recoverApify}=await import('../server/services/apify');const original=globalThis.fetch;
 let run:any={id:'fixture-run',actId:'uU8ybh0dgvI68Q3o2',userId:'fixture-user',startedAt:'2026-01-01T10:00:01Z',finishedAt:'2026-01-01T10:01:00Z',status:'SUCCEEDED',defaultDatasetId:'fixture-dataset',defaultKeyValueStoreId:'fixture-kv',usageTotalUsd:.00155};
 const input={mode:'search',query:'restaurant',location:'Paris',onlyNew:true,monitorId:'fixture-monitor',excludePlaceIds:[],excludePlaceUrls:[],maxResults:25};
 const pending={mode:'discovery',actorSlug:'benthepythondev~google-maps-business-scraper',actorId:run.actId,runId:run.id,city:'Paris',max:25,engine:'website',input,exclusionSnapshot:{ids:[],urls:[]},startedAt:'2026-01-01T10:00:00Z'};
 let rows:any=[{name:'Fixture business',place_id:'ChIJ'+'x'.repeat(23),cid:'18446744073709551615',feature_id:'0xabc:0xdef',url:'https://www.google.com/maps/place/test',latitude:48,longitude:2,rating:4.5,review_count:12,opening_hours:[]}];let actualInput:any=input;
 globalThis.fetch=async(url:any)=>{const u=String(url);return Response.json(u.includes('users/me')?{data:{id:'fixture-user'}}:u.includes('/records/INPUT')?actualInput:u.includes('/datasets/')?rows:{data:run});};
 try{
  await setSetting('apifyPending',pending);let result=await collectApify('fixture');assert.equal(result.items?.[0].name,'Fixture business');assert.equal(result.items?.[0].email,'');assert.equal(result.items?.[0].fields.cid.value,'18446744073709551615');
  run.finishedAt=new Date().toISOString();result=await collectApify('fixture');assert.equal(result.status,'FINALIZING');assert.equal(result.pending,true);
  run.finishedAt='2026-01-01T10:01:00Z';rows=[{error:'provider fixture error'}];await assert.rejects(()=>collectApify('fixture'),/invalide|erreur|malform/i);assert.ok(await getSetting('apifyPending',null));
  await setSetting('apifyPending',{...pending,runId:null});actualInput={...input,location:'Lyon'};await assert.rejects(()=>recoverApify('fixture','fixture-run'),/lot|INPUT|correspond/i);assert.equal((await getSetting<any>('apifyPending',null)).runId,null);
  actualInput=input;
  run.userId='foreign-user';await assert.rejects(()=>recoverApify('fixture','fixture-run'),/propriétaire/);run.userId='fixture-user';
  run.startedAt='2025-01-01T10:00:00Z';await assert.rejects(()=>recoverApify('fixture','fixture-run'),/historique/);run.startedAt='2026-01-01T10:00:01Z';
  await recoverApify('fixture','fixture-run');assert.equal((await getSetting<any>('apifyPending',null)).runId,'fixture-run');
  rows=[];run.status='SUCCEEDED';assert.equal((await collectApify('fixture')).items?.length,0);
  rows=[{name:'Partial fixture',cid:'18446744073709551614'}];run.status='FAILED';result=await collectApify('fixture');assert.equal(result.items?.length,1);assert.equal(result.status,'FAILED');
  rows={items:[]};await assert.rejects(()=>collectApify('fixture'),/invalide/);
  rows=[{name:'Unsafe numeric identity fixture',cid:18446744073709551615}];await assert.rejects(()=>collectApify('fixture'),/invalide/);
  rows=[{name:'Invalid identity fixture',place_id:'not-a-place-id'}];await assert.rejects(()=>collectApify('fixture'),/invalide/);
  delete run.finishedAt;result=await collectApify('fixture');assert.equal(result.status,'FINALIZING');
  await setSetting('apifyPending',{runId:null,startedAt:'2026-01-01T10:00:00Z'});run.actId='nwua9Gu5YrADL7ZDj';run.defaultKeyValueStoreId='fixture-kv';actualInput={placeIds:['ChIJ'+'a'.repeat(23)],maxCrawledPlacesPerSearch:1};await assert.rejects(()=>recoverApify('fixture','fixture-run'),/Preuve INPUT/);assert.equal((await getSetting<any>('apifyPending',null)).runId,null);
 }finally{globalThis.fetch=original;await db.close();await rm(dir,{recursive:true,force:true});}
});
