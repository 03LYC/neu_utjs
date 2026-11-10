import {app,BrowserWindow,ipcMain,dialog,nativeImage,safeStorage,session,net} from 'electron';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {defaults,documentSchema,payloadSchema,type Settings,type TaskEvent,type FullRecord} from '../shared/contracts';
import {PythonWorker,loadRuntime} from './worker';
import {DeepSeekClient} from './deepseek';
import {SecretStore} from './secrets';
import {QcController} from './qc';

const projectRoot=app.getAppPath();
const dataRoot=(!app.isPackaged&&process.env.QC_DATA_ROOT)||path.join(app.getPath('appData'),'..','Local','UltrasoundQC');
mkdirSync(dataRoot,{recursive:true});
app.setPath('userData',path.join(dataRoot,'browser'));
const testMode=!app.isPackaged&&!!process.env.QC_DATA_ROOT;
let win:BrowserWindow|null=null;
let worker:PythonWorker;
let ready:Promise<any>;
let controller:QcController;
let runtimeState:any={ready:false,message:'正在启动本地后台'};
let submitting=false;
let shuttingDown=false;
const settingsFile=path.join(dataRoot,'settings.json');
let settings:Settings={...defaults};
try{settings={...defaults,...JSON.parse(readFileSync(settingsFile,'utf8'))};}catch{/* first launch */}
const settingsSchema=z.object({device:z.enum(['cpu','gpu:0']),cameraId:z.string().max(1000),baseUrl:z.string().max(200),model:z.string().max(200),soundEnabled:z.boolean(),volume:z.number().min(0).max(1),timeoutMs:z.number().min(1000).max(300000)}).strict();
const idSchema=z.string().regex(/^[a-f0-9]{32}$/);
const roiSchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().positive().max(1),height:z.number().positive().max(1)}).refine(r=>r.x+r.width<=1.00001&&r.y+r.height<=1.00001);
const imports=new Map<string,{bytes:Buffer;extension:string;dataUrl:string}>();
let secret:SecretStore;
function saveSettings(){const temporary=settingsFile+'.tmp';writeFileSync(temporary,JSON.stringify(settings,null,2));renameSync(temporary,settingsFile);}
function emit(event:TaskEvent){if(win&&!win.isDestroyed())win.webContents.send('task:event',event);}
function client(){return new DeepSeekClient({...settings,key:secret.read()},net.fetch as typeof fetch);}
function handle(name:string,fn:(...args:any[])=>any){ipcMain.handle(name,async(event,...args)=>{
 if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('不允许的窗口请求');
 try{return await fn(...args);}catch(error){throw new Error(error instanceof Error?error.message:'操作失败');}
});}
function registerHandlers(){
 handle('settings:get',()=>({settings,hasKey:secret.hasKey(),dataRoot,runtime:runtimeState,testMode}));
 handle('settings:save',(value:unknown)=>{if(controller.busy)throw new Error('请等待当前质控完成后修改设置');const next=settingsSchema.parse(value);new DeepSeekClient({...next,key:''});settings=next;saveSettings();});
 handle('key:set',(key:unknown)=>{if(controller.busy)throw new Error('请等待当前质控完成');return secret.save(z.string().min(8).max(1024).parse(key));});
 handle('key:clear',()=>{if(controller.busy)throw new Error('请等待当前质控完成');secret.clear();});
 handle('api:check',async()=>{const info=await client().checkConnection();settings.model=info.selected;saveSettings();return info;});
 handle('ocr:initialize',async()=>{await ready;if(controller.busy)throw new Error('请等待当前质控完成');runtimeState={...runtimeState,message:'正在加载 OCR 模型，首次使用需要下载'};emit({stage:'initializing',message:runtimeState.message});try{const info=await worker.request('initialize',{device:settings.device});runtimeState={...info,message:'OCR 模型就绪'};emit({stage:'ready',message:'OCR 模型已就绪'});return info;}catch(error){runtimeState={ready:false,message:(error as Error).message};emit({stage:'runtime_error',message:runtimeState.message});throw error;}});
 handle('capture:import',async()=>{
  const result=await dialog.showOpenDialog(win!,{title:'选择一张完整报告',properties:['openFile'],filters:[{name:'报告图片',extensions:['png','jpg','jpeg','bmp','webp','tif','tiff']}]});
  if(result.canceled)return null;
  const bytes=readFileSync(result.filePaths[0]);const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw new Error('无法读取图片，请使用 PNG 或 JPEG');
  const dataUrl=image.toDataURL();if(dataUrl.length>45_000_000)throw new Error('图片过大，请使用较小的报告图片');
  imports.clear();const token=randomUUID();imports.set(token,{bytes,extension:path.extname(result.filePaths[0]).toLowerCase(),dataUrl});return {dataUrl,fileToken:token};
 });
 handle('capture:submit',async(input:unknown)=>{
  if(submitting||controller.occupied)throw new Error('已有报告正在处理');
  const value=z.object({dataUrl:z.string().max(45_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/),fileToken:z.string().uuid().optional(),roi:roiSchema.nullable()}).strict().parse(input);
  submitting=true;let temporary:string|undefined;
  try{
   await ready;
   const image=nativeImage.createFromDataURL(value.dataUrl);const size=image.getSize();
   if(image.isEmpty()||size.width*size.height>100_000_000)throw new Error('图片为空或尺寸过大');
   const roi=value.roi||{x:0,y:0,width:1,height:1};
   const rect={x:Math.floor(roi.x*size.width),y:Math.floor(roi.y*size.height),width:Math.max(1,Math.floor(roi.width*size.width)),height:Math.max(1,Math.floor(roi.height*size.height))};
   rect.width=Math.min(rect.width,size.width-rect.x);rect.height=Math.min(rect.height,size.height-rect.y);
   const cropped=image.crop(rect);if(cropped.isEmpty())throw new Error('裁剪区域无效');
   temporary=mkdtempSync(path.join(dataRoot,'capture-temp-'));const cropFile=path.join(temporary,'crop.png');writeFileSync(cropFile,cropped.toPNG());
   let originalPath=path.join(temporary,'original.png');
   if(value.fileToken){const imported=imports.get(value.fileToken);if(!imported||imported.dataUrl!==value.dataUrl)throw new Error('导入图片已失效，请重新选择');originalPath=path.join(temporary,'original'+imported.extension);writeFileSync(originalPath,imported.bytes);}else writeFileSync(originalPath,image.toPNG());
   const capture=await worker.request('create_capture',{originalPath,croppedPath:cropFile,roi:value.roi});
   emit({recordId:capture.recordId,stage:'captured',message:'照片已保存本机'});
   void controller.run(capture.recordId).catch(error=>emit({recordId:capture.recordId,stage:'failed',message:error.message}));
   return {recordId:capture.recordId};
  }finally{if(temporary)rmSync(temporary,{recursive:true,force:true});submitting=false;}
 });
 handle('task:confirm',(id:unknown,payload:unknown)=>controller.confirm(idSchema.parse(id),payloadSchema.parse(payload)));
 handle('task:dismiss',(id:unknown)=>controller.dismiss(idSchema.parse(id)));
 handle('task:retry',async(id:unknown,document:unknown)=>{await ready;const recordId=idSchema.parse(id);const record=await worker.request<FullRecord>('get_record',{recordId});const edited=document?documentSchema.parse(document):record.ocr||undefined;void controller.run(recordId,edited).catch(error=>emit({recordId,stage:'failed',message:error.message}));});
 handle('records:list',async(status?:unknown,offset?:unknown)=>{await ready;return worker.request('list_records',{status:status?z.enum(['passed','issues_found','needs_review','failed','processing','awaiting_confirmation']).parse(status):null,offset:offset===undefined?0:z.number().int().min(0).parse(offset)});});
 handle('records:get',async(id:unknown)=>{await ready;return worker.request('get_record',{recordId:idSchema.parse(id)});});
 handle('records:image',async(id:unknown,kind:unknown)=>{await ready;const record=await worker.request<FullRecord>('get_record',{recordId:idSchema.parse(id)});const file=z.enum(['original','crop']).parse(kind)==='original'?record.capture.originalPath:record.capture.croppedPath;const resolved=path.resolve(file);if(!resolved.startsWith(path.resolve(dataRoot)+path.sep))throw new Error('记录路径不安全');const img=nativeImage.createFromPath(resolved);if(img.isEmpty())throw new Error('记录图片无法读取');return img.toDataURL();});
 handle('records:delete',async(id:unknown)=>{await ready;if(controller.busy)throw new Error('请等待当前任务完成');const recordId=idSchema.parse(id);const answer=await dialog.showMessageBox(win!,{type:'warning',buttons:['取消','删除记录'],defaultId:0,cancelId:0,message:'删除这份报告及全部本地照片、识别和质控记录？',detail:'此操作无法撤销。'});if(answer.response===1)await worker.request('delete_record',{recordId});});
}
async function start(){
 secret=new SecretStore(path.join(dataRoot,'api-key.enc'),safeStorage);
 const runtimeFile=app.isPackaged?path.join(process.resourcesPath,'runtime.json'):path.join(projectRoot,'.runtime','config.json');
 const runtimeProjectRoot=app.isPackaged?path.resolve(path.dirname(process.execPath),'..','..'):projectRoot;
 const config=loadRuntime(runtimeFile,runtimeProjectRoot);
 if(!existsSync(config.pythonPath))throw new Error('找不到 OCR Python 环境，请执行 scripts/setup-ocr.ps1');
 const workerRoot=app.isPackaged?process.resourcesPath:path.join(projectRoot,'python');
 worker=new PythonWorker({...config,device:settings.device},workerRoot,dataRoot);
 controller=new QcController(worker,client,()=>({model:settings.model,baseUrl:settings.baseUrl,device:settings.device}),emit);
 ready=worker.start().then(info=>{runtimeState={...info,message:'本地后台就绪，首次识别将加载 OCR 模型'};emit({stage:'ready',message:runtimeState.message});return info;}).catch(error=>{runtimeState={ready:false,message:error.message};emit({stage:'runtime_error',message:error.message});throw error;});
 ready.catch(()=>{});
 worker.on('exit',()=>{runtimeState={ready:false,message:'OCR 后台已退出，请重新启动软件'};emit({stage:'runtime_error',message:runtimeState.message});});
 registerHandlers();
 win=new BrowserWindow({width:1440,height:940,minWidth:1080,minHeight:720,show:false,backgroundColor:'#f5f7fb',title:'超声报告质控',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',event=>event.preventDefault());
 session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(contents===win?.webContents&&permission==='media'&&(!('mediaTypes' in details)||!details.mediaTypes?.includes('audio'))));
 session.defaultSession.setPermissionCheckHandler((contents,permission)=>contents===win?.webContents&&permission==='media');
 await win.loadFile(path.join(projectRoot,'web','index.html'));win.show();
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>{win?.show();win?.focus();});
 app.whenReady().then(start).catch(error=>{dialog.showErrorBox('超声质控启动失败',error.message);app.quit();});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',event=>{if(worker&&!shuttingDown){event.preventDefault();shuttingDown=true;void worker.stop().finally(()=>app.quit());}});
}
