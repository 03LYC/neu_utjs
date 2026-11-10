import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PythonWorker,loadRuntime} from '../electron/worker';

it('closing_during_processing_terminates_owned_python_descendants',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'qc-shutdown-'));
 mkdirSync(path.join(root,'qcworker'));
 writeFileSync(path.join(root,'qcworker','__main__.py'),`import json,sys,os,time
for line in sys.stdin:
 r=json.loads(line)
 if r['method']=='hang':
  time.sleep(3600)
 else:
  print(json.dumps({'request_id':r['request_id'],'result':{'pid':os.getpid()}}),flush=True)
`);
 const worker=new PythonWorker(loadRuntime('.runtime/config.json'),root,path.join(root,'data'));
 let pid=0;
 try{
  pid=(await worker.start()).pid;
  const pending=worker.request('hang',{});
  const rejected=expect(pending).rejects.toThrow();
  await worker.stop();await rejected;
  expect(()=>process.kill(pid,0)).toThrow();
 }finally{await worker.stop();if(pid){try{process.kill(pid);}catch{/* already terminated */}}rmSync(root,{recursive:true,force:true});}
},15000);
