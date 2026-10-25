import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

test('provider emails array and email scalar are validated, deduplicated, never invented or crawled', async () => {
  const env={...process.env};
  for(const key of Object.keys(process.env))if(/TURSO|VERCEL|APIFY|PROXY/i.test(key))delete process.env[key];
  const dir=await mkdtemp(path.join(process.env.TMPDIR||'/opt/data/cache/scratch','contact-apify-')); process.env.DATA_DIR=dir;
  const {db,setSetting}=await import('../server/db');const {collectApify}=await import('../server/services/apify'); const original=globalThis.fetch;
  const rows=[{title:'Scalar',email:'Scalar@atelier.fr'},{title:'Array',emails:['bad','fake@example.com','first@atelier.fr','FIRST@atelier.fr','logo@2x.png'],email:'second@atelier.fr'},{title:'Absent',website:'https://93.184.216.34'},{title:'Invalid',emails:'string@atelier.fr',email:'bad@example.org'}];
  const calls:string[]=[];
  globalThis.fetch=async(url,init)=>{assert.equal(init?.method??'GET','GET');calls.push(String(url));assert.match(String(url),/^https:\/\/api\.apify\.com\//);return Response.json(String(url).includes('/datasets/')?rows:{data:{id:'fixture-run',actId:'nwua9Gu5YrADL7ZDj',status:'SUCCEEDED',finishedAt:'2026-01-01T00:00:00Z',defaultDatasetId:'fixture-data'}});};
  try{
    await setSetting('apifyPending',{runId:'fixture-run',city:'Fixture',engine:'website',max:4});
    const result=await collectApify('fixture-token');assert.equal(result.items?.[0].email,'scalar@atelier.fr');assert.equal(result.items?.[0].fields.email.value,'scalar@atelier.fr');
    assert.equal(result.items?.[1].email,'first@atelier.fr');assert.equal(result.items?.[1].fields.email_2.value,'second@atelier.fr');assert.equal(result.items?.[1].fields.email_3,undefined);
    assert.equal(result.items?.[2].email,'');assert.equal(result.items?.[2].fields.email,undefined);assert.equal(result.items?.[3].email,'');assert.equal(calls.length,2);
  }finally{globalThis.fetch=original;await db.close();await rm(dir,{recursive:true,force:true});for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
