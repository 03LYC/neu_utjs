import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
export class ReplyRouter extends EventEmitter{
 private buffer='';
 private pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 wait(id:string,timeout:number):Promise<any>{
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('本地处理超时，请重新启动软件后重试'));},timeout);
   this.pending.set(id,{resolve,reject,timer});
  });
 }
 accept(chunk:string){
  this.buffer+=chunk;
  if(this.buffer.length>64*1024*1024){this.fail(new Error('本地返回数据过大'));this.buffer='';return;}
  let lineEnd:number;
  while((lineEnd=this.buffer.indexOf('\n'))>=0){
   const line=this.buffer.slice(0,lineEnd);this.buffer=this.buffer.slice(lineEnd+1);
   let message:any;try{message=JSON.parse(line);}catch{continue;}
   const pending=this.pending.get(message.request_id);if(!pending)continue;
   if(message.event){this.emit('progress',message);continue;}
   clearTimeout(pending.timer);this.pending.delete(message.request_id);
   if(message.error)pending.reject(new Error(message.error.message||'本地处理失败'));else pending.resolve(message.result);
  }
 }
 fail(error:Error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
}
export type RuntimeConfig={pythonPath:string;ocrSource:string;modelCache:string;device:string;projectRoot?:string;workerRoot?:string;dataRoot?:string};
const workerCacheDirectories={
 TEMP:'tmp',TMP:'tmp',TMPDIR:'tmp',
 UV_CACHE_DIR:'cache/uv',UV_PYTHON_INSTALL_DIR:'python',UV_TOOL_DIR:'tools/uv-tools',UV_TOOL_BIN_DIR:'tools/bin',
 PIP_CACHE_DIR:'cache/pip',npm_config_cache:'cache/npm',npm_config_devdir:'cache/node-gyp',
 ELECTRON_CACHE:'cache/electron',ELECTRON_BUILDER_CACHE:'cache/electron-builder',XDG_CACHE_HOME:'cache',
 HF_HOME:'cache/huggingface',HF_HUB_CACHE:'cache/huggingface/hub',HUGGINGFACE_HUB_CACHE:'cache/huggingface/hub',
 HF_ASSETS_CACHE:'cache/huggingface/assets',HUGGINGFACE_ASSETS_CACHE:'cache/huggingface/assets',HF_XET_CACHE:'cache/huggingface/xet',
 MODELSCOPE_CACHE:'cache/modelscope',AISTUDIO_CACHE_HOME:'cache/aistudio',AISTUDIO_CACHE:'cache/aistudio',
 PADDLE_HOME:'cache/paddle',PADDLE_CACHE:'cache/paddle',
 PYTHONPYCACHEPREFIX:'cache/python',
} as const;
export function buildWorkerEnv(config:RuntimeConfig,workerRoot:string,inherited:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv{
 const projectRoot=path.resolve(config.projectRoot||process.cwd());
 const runtimeRoot=path.join(projectRoot,'.runtime');
 const controlledKeys=new Set([...Object.keys(workerCacheDirectories),'PADDLE_PDX_CACHE_HOME','PYTHONPATH','PYTHONHOME',
  'PYTHONIOENCODING','PYTHONUTF8','PYTHONNOUSERSITE','PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK','PADDLE_PDX_MODEL_SOURCE',
  'UV_PYTHON_INSTALL_BIN','UV_PYTHON_INSTALL_REGISTRY','UV_NO_MODIFY_PATH','PIP_DISABLE_PIP_VERSION_CHECK'].map(key=>key.toUpperCase()));
 // Windows environment names ignore case. Remove inherited aliases before
 // assigning project paths so direct exe launches behave like the launcher.
 const env=Object.fromEntries(Object.entries(inherited).filter(([key])=>!controlledKeys.has(key.toUpperCase())));
 for(const [key,relative] of Object.entries(workerCacheDirectories))env[key]=path.join(runtimeRoot,relative);
 return {...env,PADDLE_PDX_CACHE_HOME:path.resolve(projectRoot,config.modelCache),
  PYTHONPATH:[path.resolve(workerRoot),path.resolve(projectRoot,config.ocrSource)].join(path.delimiter),
  PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',PYTHONNOUSERSITE:'1',
  PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK:'True',PADDLE_PDX_MODEL_SOURCE:'bos',
  UV_PYTHON_INSTALL_BIN:'0',UV_PYTHON_INSTALL_REGISTRY:'0',UV_NO_MODIFY_PATH:'1',PIP_DISABLE_PIP_VERSION_CHECK:'1'};
}
export class PythonWorker extends EventEmitter{
 private child:ChildProcessWithoutNullStreams|null=null;
 private router=new ReplyRouter();
 private generation=0;
 constructor(private config:RuntimeConfig,private workerRoot:string,private dataRoot:string){super();this.router.on('progress',event=>this.emit('progress',event));}
 async start(){
  if(this.child)return this.request('ping',{});
  const env=buildWorkerEnv(this.config,this.workerRoot);
  for(const key of [...Object.keys(workerCacheDirectories),'PADDLE_PDX_CACHE_HOME'])mkdirSync(env[key]!,{recursive:true});
  mkdirSync(this.dataRoot,{recursive:true});
  const configPath=path.join(this.dataRoot,'worker-runtime.json');
  writeFileSync(configPath,JSON.stringify({...this.config,dataRoot:this.dataRoot}),{encoding:'utf8'});
  const generation=++this.generation;
  const child=spawn(this.config.pythonPath,['-u','-m','qcworker',configPath],{cwd:this.workerRoot,windowsHide:true,env});
  this.child=child;
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>this.router.accept(chunk));
  // Consume library diagnostics without persisting potential patient content.
  child.stderr.on('data',()=>{});
  const fail=()=>{if(this.generation!==generation)return;this.child=null;this.router.fail(new Error('OCR 后台进程已退出，请重新启动软件'));this.emit('exit');};
  child.on('error',fail);child.on('exit',fail);
  return this.request('ping',{},30000);
 }
 request<T=any>(method:string,params:unknown={},timeout=1200000):Promise<T>{
  if(!this.child)return Promise.reject(new Error('OCR 后台尚未就绪'));
  const id=randomUUID();const promise=this.router.wait(id,timeout);
  this.child.stdin.write(JSON.stringify({version:1,request_id:id,method,params})+'\n',error=>{if(error)this.router.fail(new Error('无法向 OCR 后台发送任务'));});
  return promise;
 }
 async stop(){
  const child=this.child;if(!child)return;
  try{await this.request('shutdown',{},3000);}catch{/* shutdown will force terminate */}
  ++this.generation;child.kill();this.child=null;this.router.fail(new Error('应用已退出'));
 }
}
export function loadRuntime(file:string,projectRoot=process.cwd()):RuntimeConfig{
 const config:RuntimeConfig=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 const root=path.resolve(projectRoot);
 for(const key of ['pythonPath','ocrSource','modelCache'] as const)config[key]=path.resolve(root,config[key]);
 return {...config,projectRoot:root};
}
