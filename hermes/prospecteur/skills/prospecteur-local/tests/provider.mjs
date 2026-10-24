// Test-only transport. No socket is opened; unexpected fetches fail closed.
import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
globalThis.fetch = async input => {
  const url = String(input);
  if (Object.keys(process.env).some(k => /^(TURSO|APIFY|APP_|VERCEL|GMAIL)/.test(k))) throw Error('Ambient credentials leaked');
  const dir = path.join(process.env.HERMES_HOME, 'workspace/prospecteur');
  mkdirSync(dir, {recursive: true});
  appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({url}) + '\n');
  let data;
  if (url.includes('nominatim')) data = [{lat:'44.84', lon:'-0.58', address:{country_code:'fr'}}];
  else if (url.includes('recherche-entreprises')) data = {results:[]};
  else if (url.includes('overpass')) data = {elements:Array.from({length:30}, (_,i) => ({type:'node', id:100+i, lat:44.84, lon:-0.58, tags:{name:'Atelier '+i, website:'http://93.184.216.34/', craft:'carpenter', 'addr:street':i+' rue des tests', 'addr:city':'Bordeaux'}}))};
  else if (url.startsWith('http://93.184.216.34')) return new Response('<html><head><title>Atelier test</title><meta name="viewport" content="width=device-width"></head><body><h1>Travail du bois</h1><p>Source publique simulée.</p></body></html>', {headers:{'content-type':'text/html'}});
  else throw Error('Unexpected network call: '+url);
  return new Response(JSON.stringify(data), {headers:{'content-type':'application/json'}});
};
