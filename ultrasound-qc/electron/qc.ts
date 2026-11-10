import {documentSchema,type OCRDocument,type QCPayload,type TaskEvent,type QCResult} from '../shared/contracts';
import {preparePayload,validatePayloadPrivacy} from './filter';
import {PROMPT_VERSION} from './prompts';
import {normalizeReportSections,applyConfirmedText} from './sections';
import type {PythonWorker} from './worker';
import type {DeepSeekClient,ModelDiagnostics} from './deepseek';

const emptyPayload=():QCPayload=>({examination:[],findings:[],measurements:[],conclusion:[]});
type AttemptContext={attemptId?:string;started:number;phase:string;modelDiagnostics?:ModelDiagnostics|null};
type Pending={document:OCRDocument;payload:QCPayload;reasons:string[];context:AttemptContext};

export class QcController{
 busy=false;
 private pending=new Map<string,Pending>();
 get occupied(){return this.busy||this.pending.size>0;}
 constructor(private worker:Pick<PythonWorker,'request'>,private client:()=>Pick<DeepSeekClient,'review'> & Partial<Pick<DeepSeekClient,'lastDiagnostics'>>,private metadata:()=>Record<string,unknown>,private emit:(event:TaskEvent)=>void){}

 async run(recordId:string,editedDocument?:OCRDocument){
  if(this.occupied)throw new Error('已有报告正在处理，请先完成当前报告');
  this.busy=true;
  const context:AttemptContext={started:Date.now(),phase:'ocr'};
  try{
   context.attemptId=await this.worker.request<string>('add_attempt',{recordId,payload:emptyPayload(),document:editedDocument||null});
   await this.worker.request('set_status',{recordId,status:'processing'});
   this.emit({recordId,attemptId:context.attemptId,stage:'ocr',message:'正在识别报告，首次使用需加载模型'});
   const raw=editedDocument||await this.worker.request('recognize',{recordId,device:this.metadata().device});
   const document=normalizeReportSections(documentSchema.parse(raw));
   context.phase='filter';
   const prepared=preparePayload(document);
   await this.worker.request('update_attempt',{recordId,attemptId:context.attemptId,payload:prepared.payload,document});
   this.emit({recordId,attemptId:context.attemptId,stage:'structured',document,payload:prepared.payload});
   if(prepared.needsConfirmation){
    await this.worker.request('set_status',{recordId,status:'awaiting_confirmation'});
    context.phase='confirmation';
    this.pending.set(recordId,{document,payload:prepared.payload,reasons:prepared.reasons,context});
    this.emit({recordId,attemptId:context.attemptId,stage:'awaiting_confirmation',document,payload:prepared.payload,reasons:prepared.reasons});
   }else await this.review(recordId,document,prepared.payload,context);
  }catch(error){await this.failed(recordId,error,context);}finally{this.busy=false;}
 }

 async confirm(recordId:string,rawPayload:unknown){
  if(this.busy)throw new Error('已有任务正在处理');
  const pending=this.pending.get(recordId);
  if(!pending)throw new Error('该报告没有待确认内容');
  const payload=validatePayloadPrivacy(rawPayload);
  const allowed=new Set(Object.values(pending.payload).flat().map(block=>block.sourceId));
  if(Object.values(payload).flat().some(block=>!allowed.has(block.sourceId)))throw new Error('发送内容引用了被排除或不存在的位置，请编辑识别文字后重新质控');
  const reviewed=applyConfirmedText(pending.document,payload);
  this.pending.delete(recordId);
  this.busy=true;
  try{
   await this.worker.request('update_attempt',{recordId,attemptId:pending.context.attemptId,payload,document:reviewed});
   await this.review(recordId,reviewed,payload,pending.context);
  }catch(error){await this.failed(recordId,error,pending.context);}finally{this.busy=false;}
 }

 async dismiss(recordId:string){
  if(this.busy)throw new Error('已有报告正在处理');
  const pending=this.pending.get(recordId);
  if(!pending)throw new Error('没有待复核报告');
  this.busy=true;
  try{
   const block=pending.document.blocks.find(item=>item.text.trim());
   const result:QCResult={status:'needs_review',summary:'未发送模型，等待人工核对',issues:block?[{category:'ocr',severity:'warning',sourceIds:[block.sourceId],quote:block.text,reason:pending.reasons.join('；')||'需要人工核对',suggestion:null,requiresReview:true}]:[]};
   await this.worker.request('finish_attempt',{recordId,attemptId:pending.context.attemptId,result,metadata:{...this.metadata(),sentToModel:false,phase:'confirmation'}});
   this.pending.delete(recordId);
   this.emit({recordId,attemptId:pending.context.attemptId,stage:'done',result});
  }finally{this.busy=false;}
 }

 private async review(recordId:string,document:OCRDocument,payload:QCPayload,context:AttemptContext){
  context.phase='model';
  this.emit({recordId,attemptId:context.attemptId,stage:'model',message:'正在由 DeepSeek 检查报告文字'});
  const client=this.client();
  let result:QCResult;
  try{result=await client.review(payload,document);}finally{context.modelDiagnostics=client.lastDiagnostics;}
  context.phase='saving';
  this.emit({recordId,attemptId:context.attemptId,stage:'saving',message:'正在保存质控记录'});
  await this.worker.request('finish_attempt',{recordId,attemptId:context.attemptId,result,metadata:{...this.metadata(),promptVersion:PROMPT_VERSION,elapsedMs:Date.now()-context.started,sentToModel:true,...(context.modelDiagnostics?{modelDiagnostics:context.modelDiagnostics}:{})}});
  this.emit({recordId,attemptId:context.attemptId,stage:'done',result,document,payload});
 }

 private async failed(recordId:string,error:unknown,context:AttemptContext){
  const message=error instanceof Error?error.message:'处理失败';
  if(context.attemptId){
   try{
    await this.worker.request('finish_attempt',{recordId,attemptId:context.attemptId,result:{status:'failed',summary:message,issues:[]},metadata:{...this.metadata(),promptVersion:PROMPT_VERSION,phase:context.phase,elapsedMs:Date.now()-context.started,sentToModel:context.phase==='saving'?true:context.phase==='model'?null:false,...(context.modelDiagnostics?{modelDiagnostics:context.modelDiagnostics}:{})}});
   }catch{/* A persistence failure is surfaced below and never becomes passed. */}
  }
  try{await this.worker.request('set_status',{recordId,status:'failed',error:message});}catch{/* The process or storage error must still reach the UI. */}
  this.emit({recordId,attemptId:context.attemptId,stage:'failed',message});
 }
}
