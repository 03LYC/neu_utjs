import {it,expect,vi} from 'vitest';
import {DeepSeekClient} from '../electron/deepseek';
const payload={examination:[{sourceId:'b0',text:'双肾'}],findings:[{sourceId:'b1',text:'双肾轮廓清晰'}],measurements:[],conclusion:[{sourceId:'b2',text:'未见明显异常'}]};
const doc={blocks:[{sourceId:'b0',text:'双肾'},{sourceId:'b1',text:'双肾轮廓清晰'},{sourceId:'b2',text:'未见明显异常'}]} as any;
const options={baseUrl:'https://api.deepseek.com',model:'test',timeoutMs:50,key:'test-placeholder'};
const passed={status:'passed',summary:'未发现问题',issues:[]};
const completion=(value:unknown=passed,finish_reason:unknown='stop',extra:Record<string,unknown>={})=>new Response(JSON.stringify({...extra,choices:[{finish_reason,message:{content:typeof value==='string'?value:JSON.stringify(value),reasoning_content:'DO_NOT_RECORD_REASONING'}}]}));
const issue=(quote:string,sourceIds=['b1'])=>({status:'issues_found',summary:'需核对',issues:[{category:'logic',severity:'warning',sourceIds,quote,reason:'合成测试依据',suggestion:null,requiresReview:true}]});
it('valid_result_and_payload_only',async()=>{
 const transport=vi.fn(async(_url:any,init:any)=>{const body=JSON.parse(init.body);expect(body.messages[1].content).toContain('双肾');expect(init.body).not.toContain('originalPath');expect(body.thinking).toEqual({type:'enabled'});expect(body.reasoning_effort).toBe('low');expect(body.max_tokens).toBe(16384);expect(body.response_format).toEqual({type:'json_object'});return completion();});
 const client=new DeepSeekClient(options,transport as any);
 expect((await client.review(payload,doc)).status).toBe('passed');
 expect(transport).toHaveBeenCalledTimes(1);
});
it('invalid_json_is_failed',async()=>{
 const client=new DeepSeekClient(options,async()=>completion('不是JSON'));
 await expect(client.review(payload,doc)).rejects.toThrow('格式');
 expect(client.lastDiagnostics?.validationCode).toBe('invalid_json');
});
it('times_out_without_retry',async()=>{
 let calls=0;
 const client=new DeepSeekClient({...options,timeoutMs:10},async(_url,init)=>{calls++;return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError'))));});
 await expect(client.review(payload,doc)).rejects.toThrow('超时');expect(calls).toBe(1);
});
it('never_sends_key_to_nonofficial_origin',()=>expect(()=>new DeepSeekClient({...options,baseUrl:'https://example.org'})).toThrow());
it('auth_error_does_not_expose_response_body',async()=>{
 const client=new DeepSeekClient(options,async()=>new Response('secret report text',{status:401}));
 await expect(client.review(payload,doc)).rejects.toThrow('密钥');
});
it('missing_key_is_reported_before_model_selection',async()=>{const client=new DeepSeekClient({...options,key:'',model:''});await expect(client.review(payload,doc)).rejects.toThrow('密钥');});
it('truncated_valid_json_is_rejected_without_retry',async()=>{
 const transport=vi.fn(async()=>completion(passed,'length',{id:'chatcmpl-synthetic',usage:{prompt_tokens:100,completion_tokens:16384,total_tokens:16484,completion_tokens_details:{reasoning_tokens:15000}}}));
 const client=new DeepSeekClient(options,transport);
 await expect(client.review(payload,doc)).rejects.toThrow('模型输出被截断，未作通过判断，请手动重试');
 expect(transport).toHaveBeenCalledTimes(1);
 expect(client.lastDiagnostics).toMatchObject({finishReason:'length',validationCode:'truncated',requestId:'chatcmpl-synthetic',promptTokens:100,completionTokens:16384,totalTokens:16484,reasoningTokens:15000,maxTokens:16384,reasoningEffort:'low'});
});
it.each(['content_filter','tool_calls','function_call','insufficient_system_resource','unexpected-private-value'])('rejects_nonstop_finish_reason_%s_without_retry',async finish=>{
 const transport=vi.fn(async()=>completion(passed,finish));
 const client=new DeepSeekClient(options,transport);
 await expect(client.review(payload,doc)).rejects.toThrow('未正常完成');
 expect(transport).toHaveBeenCalledTimes(1);
 expect(client.lastDiagnostics?.validationCode).toBe('incomplete_response');
 expect(JSON.stringify(client.lastDiagnostics)).not.toContain('unexpected-private-value');
});
it('requires_an_explicit_stop_finish_reason',async()=>{
 const client=new DeepSeekClient(options,async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(passed)}}]})));
 await expect(client.review(payload,doc)).rejects.toThrow('结束标记');
 expect(client.lastDiagnostics?.finishReason).toBe('missing');
});
it('validates_quotes_against_the_actual_sent_text_and_excludes_original_titles',async()=>{
 const original={...doc,fullText:'DO_NOT_SEND_PRIVATE_FULLTEXT',blocks:doc.blocks.map((block:any)=>({...block,text:`DO_NOT_SEND_TITLE:${block.text}`}))};
 const edited={...payload,findings:[{sourceId:'b1',text:'双肾轮廓尚清晰'}]};
 const transport=vi.fn(async(_url:any,init:any)=>{
  expect(init.body).not.toContain('DO_NOT_SEND');
  expect(JSON.parse(JSON.parse(init.body).messages[1].content).findings[0].text).toBe('双肾轮廓尚清晰');
  return completion(issue('轮廓尚清晰',['b1','b2']));
 });
 const client=new DeepSeekClient(options,transport as any);
 expect((await client.review(edited,original)).issues[0].quote).toBe('轮廓尚清晰');
 expect(client.lastDiagnostics?.validationCode).toBe('ok');
 const titleClient=new DeepSeekClient(options,async()=>completion(issue('DO_NOT_SEND_TITLE:')));
 await expect(titleClient.review(payload,original)).rejects.toThrow('摘录');
 expect(titleClient.lastDiagnostics?.validationCode).toBe('quote_mismatch');
 expect(JSON.stringify(titleClient.lastDiagnostics)).not.toContain('DO_NOT_SEND');
});
it('rejects_a_payload_source_that_is_not_in_the_document_before_sending',async()=>{
 const transport=vi.fn(async()=>completion());
 const client=new DeepSeekClient(options,transport);
 await expect(client.review({...payload,findings:[{sourceId:'unknown',text:'双肾轮廓清晰'}]},doc)).rejects.toThrow('原文位置');
 expect(transport).not.toHaveBeenCalled();
 expect(client.lastDiagnostics?.validationCode).toBe('payload_unknown_source');
});
it('rejects_conflicting_duplicate_payload_sources_before_sending',async()=>{
 const transport=vi.fn(async()=>completion());
 const client=new DeepSeekClient(options,transport);
 await expect(client.review({...payload,findings:[...payload.findings,{sourceId:'b1',text:'另一段文字'}]},doc)).rejects.toThrow('冲突');
 expect(transport).not.toHaveBeenCalled();
 expect(client.lastDiagnostics?.validationCode).toBe('payload_source_conflict');
});
it('rejects_conflicting_duplicate_document_sources_before_sending',async()=>{
 const transport=vi.fn(async()=>completion());
 const client=new DeepSeekClient(options,transport);
 await expect(client.review(payload,{...doc,blocks:[...doc.blocks,{sourceId:'b1',text:'另一段文字'}]})).rejects.toThrow('冲突');
 expect(transport).not.toHaveBeenCalled();
});
it('diagnostics_keep_only_safe_identifiers_counts_and_codes_on_failure',async()=>{
 const secret='DIAGNOSTIC_SECRET_KEY';
 const privateText='DO_NOT_RECORD_PRIVATE_REPORT';
 const raw=issue(privateText);
 const client=new DeepSeekClient({...options,key:secret},async()=>completion(raw,'stop',{id:secret,usage:{prompt_tokens:21,completion_tokens:34,total_tokens:55,completion_tokens_details:{reasoning_tokens:13},private_note:privateText}}));
 await expect(client.review(payload,doc)).rejects.toThrow('摘录');
 expect(client.lastDiagnostics).toMatchObject({model:'test',finishReason:'stop',promptTokens:21,completionTokens:34,totalTokens:55,reasoningTokens:13,responseChars:JSON.stringify(raw).length,validationCode:'quote_mismatch'});
 const serialized=JSON.stringify(client.lastDiagnostics);
 for(const forbidden of [secret,privateText,'DO_NOT_RECORD_REASONING','合成测试依据','双肾轮廓清晰'])expect(serialized).not.toContain(forbidden);
 const allowedFields=['model','requestId','finishReason','promptTokens','completionTokens','totalTokens','reasoningTokens','responseChars','maxTokens','reasoningEffort','validationCode','refFailure'];
 expect(Object.keys(client.lastDiagnostics!).every(field=>allowedFields.includes(field))).toBe(true);
 expect(client.lastDiagnostics).not.toHaveProperty('requestId');
});
it('diagnostics_drop_invalid_usage_and_reset_before_a_new_review',async()=>{
 let calls=0;
 const client=new DeepSeekClient(options,async()=>++calls===1?completion(passed,'stop',{id:'chatcmpl-first',usage:{prompt_tokens:7,total_tokens:9}}):completion(passed,'stop',{id:'not a safe id',usage:{prompt_tokens:'patient text',completion_tokens:-1,total_tokens:Infinity,completion_tokens_details:{reasoning_tokens:1.5}}}));
 await client.review(payload,doc);const first=client.lastDiagnostics;
 await client.review(payload,doc);
 expect(first).toMatchObject({requestId:'chatcmpl-first',promptTokens:7,totalTokens:9});
 expect(client.lastDiagnostics).not.toBe(first);
 for(const field of ['requestId','promptTokens','completionTokens','totalTokens','reasoningTokens'])expect(client.lastDiagnostics).not.toHaveProperty(field);
});
it('reference_failure_diagnostics_keep_the_index_and_safe_ids_without_quote_or_key',async()=>{
 const key='DIAGNOSTIC_REFERENCE_SECRET';
 const client=new DeepSeekClient({...options,key},async()=>completion(issue('DO_NOT_RECORD_QUOTE',['unknown-id',key,'not a source id'])));
 await expect(client.review(payload,doc)).rejects.toThrow('原文位置');
 expect(client.lastDiagnostics?.refFailure).toEqual({code:'unknown_source',issueIndex:0,sourceIds:[]});
 expect(JSON.stringify(client.lastDiagnostics)).not.toMatch(/DO_NOT_RECORD_QUOTE|DIAGNOSTIC_REFERENCE_SECRET|not a source id/);
});
it('does_not_store_clinical_text_returned_as_an_unknown_source_id',async()=>{
 const privateText='RightKidney9.7cm';
 const client=new DeepSeekClient(options,async()=>completion(issue('DO_NOT_RECORD_QUOTE',[privateText,'b1'])));
 await expect(client.review(payload,doc)).rejects.toThrow('原文位置');
 expect(client.lastDiagnostics?.refFailure).toEqual({code:'unknown_source',issueIndex:0,sourceIds:['b1']});
 expect(JSON.stringify(client.lastDiagnostics)).not.toContain(privateText);
});
it('keeps_the_timeout_and_abort_signal_active_while_reading_the_response_body',async()=>{
 const transport=vi.fn(async(_url:any,init:any)=>new Response(new ReadableStream<Uint8Array>({start(controller){
  controller.enqueue(new TextEncoder().encode('{"choices":'));
  init.signal.addEventListener('abort',()=>controller.error(new DOMException('aborted','AbortError')),{once:true});
 }})));
 const client=new DeepSeekClient({...options,timeoutMs:10},transport as any);
 await expect(client.review(payload,doc)).rejects.toThrow('超时');
 expect(transport).toHaveBeenCalledTimes(1);
 expect(client.lastDiagnostics?.validationCode).toBe('timeout');
});
it('does_not_expose_a_malformed_http_response_body_in_errors_or_diagnostics',async()=>{
 const privateText='DO_NOT_RECORD_MALFORMED_BODY';
 const client=new DeepSeekClient(options,async()=>new Response(`invalid JSON ${privateText}`));
 await expect(client.review(payload,doc)).rejects.toThrow('模型接口响应格式不正确');
 expect(client.lastDiagnostics?.validationCode).toBe('invalid_response');
 expect(JSON.stringify(client.lastDiagnostics)).not.toContain(privateText);
});
it('unrecognized_error_messages_cannot_escape_the_diagnostics_code_allowlist',async()=>{
 const client=new DeepSeekClient(options,async()=>{throw new Error('__proto__');});
 await expect(client.review(payload,doc)).rejects.toThrow('__proto__');
 expect(client.lastDiagnostics?.validationCode).toBe('other');
});
