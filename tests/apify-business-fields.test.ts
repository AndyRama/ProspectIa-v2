import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';

test('business and email paid pending preserve full provider contacts through persistence and reopen',async()=>{
 const dir=await mkdtemp('/opt/data/cache/scratch/business-fields-');process.env.DATA_DIR=dir;process.env.TURSO_DATABASE_URL='';process.env.TURSO_AUTH_TOKEN='';
 const {db,setSetting}=await import('../server/db');const {collectApify}=await import('../server/services/apify');const {persistResults,resolveSearch}=await import('../server/searches');
 const original=globalThis.fetch;let actorId='uU8ybh0dgvI68Q3o2';
 let row:Record<string,any>={name:'Fixture atelier',place_id:'ChIJ'+'a'.repeat(23),cid:'18446744073709551615',feature_id:'0xa:0xb',url:'https://www.google.com/maps?cid=18446744073709551615',google_maps_url:'https://www.google.com/maps?cid=18446744073709551615',primary_email:'contact@fixture.fr',emails:['second@fixture.fr',{email:'third@fixture.fr',source:'contact_page',confidence:90}],phone:'01 23 45 67 89',phone_international:'+33 1 23 45 67 89',phones:['01 23 45 67 89','02 22 22 22 22'],website:'https://fixture.fr',socials:{instagram:['https://instagram.com/fixture','https://instagram.com/fixture2'],facebook:'https://facebook.com/fixture'},has_contact_form:true,city:'Papeete',address:'1 rue Fixture',street:'rue Fixture',state:'Tahiti',postal_code:'98714',country_code:'PF',category:'Atelier',rating:0,review_count:0,latitude:0,longitude:0,opening_hours:['Monday: 9-17'],photos:['https://fixture.fr/photo.jpg'],price:'€€',attributes:{service:['on-site']},reviews:[{rating:0,text:'Fixture'}],lead_score:0};
 globalThis.fetch=async(url:any,init?:RequestInit)=>{assert.notEqual(init?.method,'POST');return String(url).includes('datasets/')?Response.json([row]):Response.json({data:{id:'paid-run',actId:actorId,status:'SUCCEEDED',finishedAt:'2026-01-01T00:00:00Z',defaultDatasetId:'fixture-dataset'}});};
 try{
  for(const [slug,id] of [['benthepythondev~google-maps-business-scraper','uU8ybh0dgvI68Q3o2'],['benthepythondev~google-maps-email-scraper','4MTxdHfGoKTLDoTrD']]){
   const closureKey=slug.includes('business')?'permanently_closed':'is_closed';
   const otherClosureKey=slug.includes('business')?'is_closed':'permanently_closed';
   for(const closed of [true,false,undefined,'true']){
   delete row.permanently_closed;delete row.is_closed;
   row={...row,...(closed===undefined?{}:{[closureKey]:closed}),...(closed===false?{[otherClosureKey]:true}:{})};
   const expectedClosure=closed===true?'Fermé définitivement':undefined;
   actorId=id;await setSetting('apifyPending',{mode:'discovery',actorSlug:slug,actorId:id,runId:'paid-run',max:50,city:'Papeete',activity:'all',engine:'website',input:{scrapeContacts:slug.includes('business')},exclusionSnapshot:{ids:[],urls:[]}});
   const result:any=await collectApify('fixture-token');assert.equal(result.items.length,1);const p=result.items[0];
   assert.equal(p.email,row.primary_email);assert.equal(p.fields.email_2.value,'second@fixture.fr');assert.equal(p.fields.email_3.value,'third@fixture.fr');assert.match(p.fields.email.qualification,/délivrabilité non testée/);
   assert.equal(p.fields.instagram.value,row.socials.instagram[0]);assert.deepEqual(JSON.parse(p.fields.socials.value),row.socials);assert.deepEqual(JSON.parse(p.fields.apifyRaw.value),row);assert.deepEqual(JSON.parse(p.fields.phones.value),row.phones);assert.equal(p.fields.price.value,'€€');assert.deepEqual(JSON.parse(p.fields.attributes.value),row.attributes);assert.equal(p.fields.hasContactForm.value,'true');assert.equal(p.fields.latitude.value,'0');assert.equal(p.fields.rating.value,'0');assert.equal(p.fields.reviews.value,'0');assert.equal(p.fields.postalCode.value,'98714');assert.equal(p.fields.countryCode.value,'PF');assert.equal(p.fields.phone.value,row.phone_international);assert.equal(p.fields.phoneLocal.value,row.phone);assert.equal(p.fields.leadScore.value,'0');
   assert.equal(p.fields.closure?.value,expectedClosure,`${slug}: closure ${String(closed)}`);
   assert.equal(Object.hasOwn(p.fields,'closure'),closed===true);
   const saved=await persistResults(result.items,result.args,'Apify',result.cost,[],{kind:'discovery'});await db.close();const reopened=await resolveSearch(saved.search);assert.equal(reopened.prospects.length,1);assert.deepEqual(JSON.parse(reopened.prospects[0].fields.apifyRaw.value),row);assert.deepEqual(reopened.prospects[0].fields.photos,p.fields.photos);assert.equal(reopened.prospects[0].fields.email_3.value,'third@fixture.fr');
   assert.equal(reopened.prospects[0].fields.closure?.value,expectedClosure);
   assert.equal(Object.hasOwn(reopened.prospects[0].fields,'closure'),closed===true);
   assert.deepEqual(reopened.prospects[0].fields.closure,p.fields.closure);
   await db.execute('DELETE FROM prospects');await db.execute('DELETE FROM searches');
   }
  }
 }finally{globalThis.fetch=original;await db.close();await rm(dir,{recursive:true,force:true});}
});
