import { z } from 'zod';
export const statusSchema=z.enum(['passed','issues_found','needs_review','failed']);
export const blockSchema=z.object({sourceId:z.string().min(1),text:z.string(),kind:z.enum(['paragraph','cell','table']),bbox:z.array(z.number()).length(4),confidence:z.number().min(0).max(1).nullable().optional(),row:z.number().optional(),column:z.number().optional(),rowspan:z.number().optional(),colspan:z.number().optional(),tableId:z.string().optional()});
export const documentSchema=z.object({blocks:z.array(blockSchema),warnings:z.array(z.string()),width:z.number().positive(),height:z.number().positive(),fullText:z.string().optional()});
const entry=z.object({sourceId:z.string().min(1),text:z.string().max(30000),table:z.object({id:z.string(),row:z.number().int().min(0),column:z.number().int().min(0),rowspan:z.number().int().positive(),colspan:z.number().int().positive()}).optional()}).strict();
export const payloadSchema=z.object({examination:z.array(entry),findings:z.array(entry),measurements:z.array(entry),conclusion:z.array(entry)}).strict();
export const resultSchema=z.object({status:statusSchema,summary:z.string().max(4000),issues:z.array(z.object({category:z.enum(['typo','missing_text','extra_text','unit','magnitude','logic','ocr','insufficient_information','other']),severity:z.enum(['warning','error']),sourceIds:z.array(z.string()).min(1),quote:z.string().min(1).max(4000),reason:z.string().min(1).max(4000),suggestion:z.string().max(4000).nullable(),requiresReview:z.boolean()}).strict()).max(100)}).strict();
export type OCRDocument=z.infer<typeof documentSchema>;
export type OCRBlock=OCRDocument['blocks'][number];
export type QCPayload=z.infer<typeof payloadSchema>;
export type QCResult=z.infer<typeof resultSchema>;
export type QCStatus=z.infer<typeof statusSchema>;
export type RecordSummary={recordId:string;createdAt:string;status:string;error?:string};
export type Capture={recordId:string;createdAt:string;originalPath:string;croppedPath:string;roi:ROI|null};
export type ROI={x:number;y:number;width:number;height:number};
export type Settings={device:string;cameraId:string;baseUrl:string;model:string;soundEnabled:boolean;volume:number;timeoutMs:number};
export const defaults:Settings={device:'gpu:0',cameraId:'',baseUrl:'https://api.deepseek.com',model:'',soundEnabled:true,volume:0.5,timeoutMs:90000};
export type Attempt={attemptId:string;createdAt:string;payload:QCPayload;document:OCRDocument|null;result:QCResult|null;metadata:Record<string,unknown>};
export type FullRecord=RecordSummary & {capture:Capture;ocr:OCRDocument|null;attempts:Attempt[]};
export type TaskEvent={recordId?:string;attemptId?:string;stage:string;message?:string;result?:QCResult;document?:OCRDocument;payload?:QCPayload;reasons?:string[]};
export const compact=(s:string)=>s.replace(/\s/g,'');
export class ResultValidationError extends Error{
 constructor(readonly code:'unknown_source'|'quote_mismatch',readonly issueIndex:number,readonly sourceIds:readonly string[],message:string){super(message);this.name='ResultValidationError';}
}
export function validateResult(value:unknown,doc:OCRDocument):QCResult {
 const result=resultSchema.parse(value);
 const byId=new Map(doc.blocks.map(b=>[b.sourceId,b.text]));
 for(const [index,issue] of result.issues.entries()){
  if(issue.sourceIds.some(id=>!byId.has(id))) throw new ResultValidationError('unknown_source',index,[...issue.sourceIds],'模型引用了不存在的原文位置');
  const quote=compact(issue.quote);
  if(!quote||!issue.sourceIds.some(id=>compact(byId.get(id)!).includes(quote))) throw new ResultValidationError('quote_mismatch',index,[...issue.sourceIds],'模型摘录与原文不符');
 }
 if(result.status==='passed'&&result.issues.length) throw new Error('通过状态与问题列表冲突');
 if(['issues_found','needs_review'].includes(result.status)){
  if(!result.issues.length)throw new Error('问题状态缺少原文核对依据');
  // Preserve actionable findings. Derive a non-passing status from the per-issue
  // review flags when the model's top-level label is inconsistent.
  result.status=result.issues.some(issue=>!issue.requiresReview)?'issues_found':'needs_review';
 }
 return result;
}
