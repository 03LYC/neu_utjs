import {validateResult,type QCPayload,type OCRDocument,type QCResult} from '../shared/contracts';
import {validatePayloadPrivacy} from './filter';
import {SYSTEM_PROMPT} from './prompts';
type Options={baseUrl:string;model:string;timeoutMs:number;key:string};
type FinishReason='stop'|'length'|'content_filter'|'tool_calls'|'function_call'|'insufficient_system_resource'|'missing'|'other';
type ValidationCode='pending'|'ok'|'payload_invalid'|'payload_unknown_source'|'payload_source_conflict'|'missing_key'|'missing_model'|'auth_error'|'rate_limited'|'http_error'|'timeout'|'network_error'|'invalid_response'|'incomplete_response'|'truncated'|'invalid_json'|'unknown_source'|'quote_mismatch'|'status_conflict'|'missing_evidence'|'invalid_schema'|'other';
export type ModelDiagnostics={
 model?:string;
 requestId?:string;
 finishReason?:FinishReason;
 promptTokens?:number;
 completionTokens?:number;
 totalTokens?:number;
 reasoningTokens?:number;
 responseChars?:number;
 maxTokens:number;
 reasoningEffort:'low';
 validationCode:ValidationCode;
 refFailure?:{code:'unknown_source'|'quote_mismatch';issueIndex:number;sourceIds:string[]};
};
const MAX_TOKENS=16384;
const safeCount=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
function safeIdentifier(value:unknown,key:string):string|undefined{
 return typeof value==='string'&&/^[A-Za-z0-9_.:/-]{1,128}$/.test(value)&&(!key.trim()||!value.includes(key.trim()))?value:undefined;
}
function finishReason(value:unknown):FinishReason{
 if(value===undefined||value===null)return 'missing';
 return ['stop','length','content_filter','tool_calls','function_call','insufficient_system_resource'].includes(value as string)?value as FinishReason:'other';
}
function validationCode(error:unknown):ValidationCode{
 if(!(error instanceof Error))return 'other';
 const code=(error as Error&{code?:unknown}).code;
 if(code==='unknown_source'||code==='quote_mismatch')return code;
 if(error.name==='ZodError')return 'invalid_schema';
 const messages:Record<string,ValidationCode>={
  '发送内容引用了不存在的原文位置':'payload_unknown_source',
  '发送内容存在冲突的原文位置':'payload_source_conflict',
  '请在设置中录入 DeepSeek API 密钥':'missing_key',
  '请先在设置中测试连接并选择模型':'missing_model',
  'API 密钥无效或无访问权限':'auth_error',
  '接口限流或额度不足，请稍后手动重试':'rate_limited',
  '模型请求超时或已取消，请手动重试':'timeout',
  '无法连接 DeepSeek，请检查网络连接':'network_error',
  '模型接口响应格式不正确，未作通过判断':'invalid_response',
  '模型未返回完整结束标记，未作通过判断':'incomplete_response',
  '模型未正常完成输出，未作通过判断':'incomplete_response',
  '模型输出被截断，未作通过判断，请手动重试':'truncated',
  '模型返回格式不正确，未作通过判断':'invalid_json',
  '模型引用了不存在的原文位置':'unknown_source',
  '模型摘录与原文不符':'quote_mismatch',
  '通过状态与问题列表冲突':'status_conflict',
  '问题状态缺少原文核对依据':'missing_evidence',
  '发送内容疑似包含个人信息，请在发送预览中删除':'payload_invalid',
  '检查部位、所见和结论不能为空或仅含脱敏占位符':'payload_invalid',
 };
 return Object.hasOwn(messages,error.message)?messages[error.message]:(error.message.startsWith('DeepSeek 接口请求失败（HTTP ')?'http_error':'other');
}
function sentDocument(payload:QCPayload,doc:OCRDocument):OCRDocument{
 const original=new Map<string,OCRDocument['blocks'][number]>();
 for(const block of doc.blocks){
  const previous=original.get(block.sourceId);
  if(previous&&previous.text!==block.text)throw new Error('发送内容存在冲突的原文位置');
  original.set(block.sourceId,block);
 }
 const sent=new Map<string,QCPayload['findings'][number]>();
 for(const entry of Object.values(payload).flat()){
  if(!original.has(entry.sourceId))throw new Error('发送内容引用了不存在的原文位置');
  const previous=sent.get(entry.sourceId);
  if(previous&&(previous.text!==entry.text||JSON.stringify(previous.table)!==JSON.stringify(entry.table)))throw new Error('发送内容存在冲突的原文位置');
  sent.set(entry.sourceId,entry);
 }
 return {...doc,blocks:[...sent.values()].map(entry=>({...original.get(entry.sourceId)!,text:entry.text}))};
}
export class DeepSeekClient{
 private base:string;
 lastDiagnostics:ModelDiagnostics|null=null;
 constructor(private options:Options,private transport:typeof fetch=fetch){
  const url=new URL(options.baseUrl);
  if(url.protocol!=='https:'||url.hostname!=='api.deepseek.com'||url.username||url.password||url.port||!['','/','/v1','/v1/'].includes(url.pathname)||url.search||url.hash)throw new Error('本版仅支持 DeepSeek 官方 HTTPS 接口');
  this.base=url.origin+(url.pathname.startsWith('/v1')?'/v1':'');
 }
 private async request(path:string,body?:unknown,signal?:AbortSignal):Promise<any>{
  if(!this.options.key.trim())throw new Error('请在设置中录入 DeepSeek API 密钥');
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)controller.abort();
  const timer=setTimeout(abort,this.options.timeoutMs);
  try{
   const response=await this.transport(this.base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${this.options.key}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:controller.signal});
   if(!response.ok){
    if(response.status===401||response.status===403)throw new Error('API 密钥无效或无访问权限');
    if(response.status===429)throw new Error('接口限流或额度不足，请稍后手动重试');
    throw new Error(`DeepSeek 接口请求失败（HTTP ${response.status}）`);
   }
   try{return await response.json();}catch(error){
    if(controller.signal.aborted||error instanceof TypeError)throw error;
    throw new Error('模型接口响应格式不正确，未作通过判断');
   }
  }catch(error){
   if(controller.signal.aborted)throw new Error('模型请求超时或已取消，请手动重试');
   if(error instanceof TypeError)throw new Error('无法连接 DeepSeek，请检查网络连接');
   throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async checkConnection():Promise<{models:string[];selected:string}>{
  const data=await this.request('/models');
  const models:string[]=(data.data||[]).map((m:any)=>m.id).filter((s:unknown)=>typeof s==='string');
  if(!models.length)throw new Error('接口未返回可用模型');
  if(this.options.model&&!models.includes(this.options.model))throw new Error('指定模型不在当前可用列表中');
  const selected=this.options.model||models.find(m=>/flash|chat/.test(m))||models[0];
  return {models,selected};
 }
 async review(payload:QCPayload,doc:OCRDocument,signal?:AbortSignal):Promise<QCResult>{
  const diagnostics:ModelDiagnostics={maxTokens:MAX_TOKENS,reasoningEffort:'low',validationCode:'pending'};
  const sentSourceIds=new Set<string>();
  const model=safeIdentifier(this.options.model,this.options.key);if(model)diagnostics.model=model;
  this.lastDiagnostics=diagnostics;
  try{
   const sentPayload=validatePayloadPrivacy(payload);
   const reviewed=sentDocument(sentPayload,doc);
   for(const block of reviewed.blocks)sentSourceIds.add(block.sourceId);
   if(!this.options.key.trim())throw new Error('请在设置中录入 DeepSeek API 密钥');
   if(!this.options.model)throw new Error('请先在设置中测试连接并选择模型');
   const data=await this.request('/chat/completions',{model:this.options.model,messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:JSON.stringify(sentPayload)}],response_format:{type:'json_object'},thinking:{type:'enabled'},reasoning_effort:'low',max_tokens:MAX_TOKENS},signal);
   const requestId=safeIdentifier(data?.id,this.options.key);if(requestId)diagnostics.requestId=requestId;
   const usage=data?.usage;
   for(const [name,value] of [['promptTokens',usage?.prompt_tokens],['completionTokens',usage?.completion_tokens],['totalTokens',usage?.total_tokens],['reasoningTokens',usage?.completion_tokens_details?.reasoning_tokens]] as const){if(safeCount(value))diagnostics[name]=value;}
   const choice=data?.choices?.[0];
   diagnostics.finishReason=finishReason(choice?.finish_reason);
   const content=choice?.message?.content;
   if(typeof content==='string')diagnostics.responseChars=content.length;
   if(diagnostics.finishReason==='length')throw new Error('模型输出被截断，未作通过判断，请手动重试');
   if(diagnostics.finishReason==='missing')throw new Error('模型未返回完整结束标记，未作通过判断');
   if(diagnostics.finishReason!=='stop')throw new Error('模型未正常完成输出，未作通过判断');
   if(typeof content!=='string')throw new Error('模型返回格式不正确，未作通过判断');
   let value:unknown;
   try{value=JSON.parse(content);}catch{throw new Error('模型返回格式不正确，未作通过判断');}
   const result=validateResult(value,reviewed);
   diagnostics.validationCode='ok';
   return result;
  }catch(error){
   diagnostics.validationCode=validationCode(error);
   if(error instanceof Error){
    const failure=error as Error&{code?:unknown;issueIndex?:unknown;sourceIds?:unknown};
    if((failure.code==='unknown_source'||failure.code==='quote_mismatch')&&safeCount(failure.issueIndex)&&Array.isArray(failure.sourceIds)){
     diagnostics.refFailure={code:failure.code,issueIndex:failure.issueIndex,sourceIds:failure.sourceIds.filter(id=>typeof id==='string'&&sentSourceIds.has(id)).map(id=>safeIdentifier(id,this.options.key)).filter((id):id is string=>id!==undefined).slice(0,20)};
    }
   }
   throw error;
  }
 }
}
