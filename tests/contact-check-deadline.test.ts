import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { inspectSiteContacts } from '../server/services/siteAnalyzer';
const keepAlive=setInterval(()=>{},1000);after(()=>clearInterval(keepAlive));

test('contact crawler total deadline bounds DNS, without late fetch',async()=>{
  const original=globalThis.fetch,timeout=AbortSignal.timeout;let release!:(value:any)=>void,calls=0;
  const lookup=mock.method(dns,'lookup',()=>new Promise(resolve=>{release=resolve;}));syncBuiltinESMExports();
  const timer=mock.method(AbortSignal,'timeout',(ms:number)=>{assert.equal(ms,15000);return timeout(25);});
  globalThis.fetch=async()=>{calls++;throw Error('forbidden');};
  try{const result=await inspectSiteContacts('https://fixture.invalid');assert.equal(result.status,'failed');release([{address:'93.184.216.34',family:4}]);await new Promise(r=>setTimeout(r,10));assert.equal(calls,0);}finally{timer.mock.restore();lookup.mock.restore();syncBuiltinESMExports();globalThis.fetch=original;}
});

test('contact crawler total deadline bounds a nonresponsive fetch',async()=>{
  const original=globalThis.fetch,timeout=AbortSignal.timeout;let signal:AbortSignal|null|undefined;
  const timer=mock.method(AbortSignal,'timeout',(ms:number)=>{assert.equal(ms,15000);return timeout(25);});
  globalThis.fetch=async(_url,init)=>{signal=init?.signal;return new Promise<Response>(()=>{});};
  try{const result=await inspectSiteContacts('https://93.184.216.34');assert.equal(result.status,'failed');assert.equal(signal?.aborted,true);assert.deepEqual(result.emails,[]);}finally{timer.mock.restore();globalThis.fetch=original;}
});
