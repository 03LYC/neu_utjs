import {it,expect} from 'vitest';
import {QcController} from '../electron/qc';
const doc={blocks:[{sourceId:'b0',text:'检查部位：双肾',kind:'paragraph',bbox:[0,0,10,10]},{sourceId:'b1',text:'超声所见：双肾轮廓清晰。',kind:'paragraph',bbox:[0,0,10,10]},{sourceId:'b2',text:'超声提示：未见异常。',kind:'paragraph',bbox:[0,0,10,10]}],warnings:[],width:100,height:100} as any;
function harness(failSave=false,badOcr=false,ambiguous=false){
 const calls:string[]=[];const events:any[]=[];const finished:any[]=[];
 const worker={request:async(method:string,params:any)=>{calls.push(method);if(method==='get_record')return {ocr:doc};if(method==='recognize'){if(badOcr)throw new Error('OCR失败');return ambiguous?{...doc,warnings:['不清晰']}:doc;}if(method==='add_attempt')return 'attempt1';if(method==='finish_attempt'){finished.push(params);if(failSave)throw new Error('磁盘满');}return true;}};
 const client={review:async()=>{calls.push('review');return {status:'passed',summary:'无问题',issues:[]};}};
 const controller=new QcController(worker as any,()=>client as any,()=>({model:'test'}),e=>events.push(e));return {controller,calls,events,finished};
}
it('save_failure_cannot_publish_passed',async()=>{const h=harness(true);await h.controller.run('record1');expect(h.events.some(e=>e.stage==='done'&&e.result?.status==='passed')).toBe(false);expect(h.events.at(-1).stage).toBe('failed');});
it('failed_ocr_never_calls_model',async()=>{const h=harness(false,true);await h.controller.run('record1');expect(h.calls).not.toContain('review');});
it('confirmation_required_blocks_network',async()=>{const h=harness(false,false,true);await h.controller.run('record1');expect(h.calls).not.toContain('review');expect(h.events.at(-1).stage).toBe('awaiting_confirmation');});
it('concurrent_submission_is_rejected',async()=>{const h=harness();const a=h.controller.run('record1');await expect(h.controller.run('record2')).rejects.toThrow('处理');await a;});
it('awaiting_confirmation_counts_as_occupied',async()=>{const h=harness(false,false,true);await h.controller.run('record1');expect(h.controller.occupied).toBe(true);});
it('every_ocr_failure_gets_an_independent_attempt',async()=>{const h=harness(false,true);await h.controller.run('record1');await h.controller.run('record1');expect(h.calls.filter(c=>c==='add_attempt')).toHaveLength(2);expect(h.calls.filter(c=>c==='finish_attempt')).toHaveLength(2);});
it('save_failure_after_model_response_records_that_text_was_sent',async()=>{const h=harness(true);await h.controller.run('record1');expect(h.finished.at(-1).metadata.sentToModel).toBe(true);});
for(const fail of [false,true])it(`model_diagnostics_are_saved_on_${fail?'validation_failure':'success'}`,async()=>{
 const diagnostics={model:'synthetic-model',finishReason:'stop' as const,maxTokens:16384,reasoningEffort:'low' as const,promptTokens:120,completionTokens:240,reasoningTokens:180,validationCode:fail?'quote_mismatch' as const:'ok' as const};
 const finished:any[]=[];const events:any[]=[];let modelCalls=0;
 const worker={request:async(method:string,params:any)=>{if(method==='recognize')return doc;if(method==='add_attempt')return 'diagnostic-attempt';if(method==='finish_attempt')finished.push(params);return true;}};
 const client={lastDiagnostics:diagnostics,review:async()=>{modelCalls++;if(fail)throw new Error('模型摘录与原文不符');return {status:'passed',summary:'合成测试',issues:[]};}};
 const controller=new QcController(worker as any,()=>client as any,()=>({model:'synthetic-model'}),event=>events.push(event));
 await controller.run('diagnostic-record');
 expect(finished).toHaveLength(1);expect(finished[0].metadata.modelDiagnostics).toEqual(diagnostics);
 expect(finished[0].result.status).toBe(fail?'failed':'passed');
 expect(events.at(-1).stage).toBe(fail?'failed':'done');expect(modelCalls).toBe(1);
});
it('merged_sections_are_saved_as_a_separate_confirmable_attempt_without_rewriting_raw_ocr',async()=>{
 const original={width:100,height:100,warnings:[],blocks:[{sourceId:'t1c0',kind:'cell',tableId:'t1',row:0,column:0,bbox:[0,0,100,100],text:'检查部位：腹部 超声所见：轮廓清晰。 超声提示：未见异常。'}]} as any;
 const before=structuredClone(original);const updates:any[]=[];const events:any[]=[];let modelCalls=0;
 const worker={request:async(method:string,params:any)=>{if(method==='recognize')return original;if(method==='add_attempt')return 'split-attempt';if(method==='update_attempt')updates.push(params);return true;}};
 const client={review:async()=>{modelCalls++;return {status:'passed',summary:'合成测试',issues:[]};}};
 const controller=new QcController(worker as any,()=>client as any,()=>({model:'synthetic-model'}),event=>events.push(event));
 await controller.run('split-record');
 expect(events.at(-1).stage).toBe('awaiting_confirmation');expect(modelCalls).toBe(0);
 expect(updates[0].document.blocks).toHaveLength(3);expect(updates[0].payload.findings[0].text).toBe('轮廓清晰。');
 expect(updates[0].payload.findings[0]).not.toHaveProperty('table');expect(original).toEqual(before);
 await controller.confirm('split-record',updates[0].payload);
 expect(modelCalls).toBe(1);expect(events.at(-1).stage).toBe('done');expect(original).toEqual(before);
 expect(updates[1].document.blocks.map((block:any)=>block.text)).toEqual(['检查部位：腹部','超声所见：轮廓清晰。','超声提示：未见异常。']);
 const confirmed=events.at(-1).document;
 await controller.run('split-record',{...confirmed,warnings:[]});
 expect(events.at(-1).stage).toBe('done');expect(modelCalls).toBe(2);
 expect(updates.at(-1).payload.examination[0].text).toBe('腹部');
 expect(updates.at(-1).payload.findings[0].text).toBe('轮廓清晰。');
});
