import {build} from 'esbuild';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
await build({entryPoints:['electron/filter.ts'],outfile:'.runtime/filter.cjs',bundle:true,platform:'node',format:'cjs'});
const {preparePayload}=createRequire(import.meta.url)('../.runtime/filter.cjs');
const summary=[];
for(const name of readdirSync('.runtime/verification').filter(s=>s.endsWith('.json')&&!s.startsWith('raw-')&&!s.startsWith('payload-')&&!s.startsWith('summary'))){
 const document=JSON.parse(readFileSync('.runtime/verification/'+name,'utf8'));
 const result=preparePayload(document);
 summary.push({category:name,sections:Object.fromEntries(Object.entries(result.payload).map(([key,value])=>[key,value.length])),needsConfirmation:result.needsConfirmation,reasons:result.reasons});
 writeFileSync('.runtime/verification/payload-'+name,JSON.stringify(result.payload,null,2));
}
writeFileSync('.runtime/payload-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
