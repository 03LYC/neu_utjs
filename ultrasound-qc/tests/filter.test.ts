import {it,expect} from 'vitest';
import {preparePayload, validatePayloadPrivacy} from '../electron/filter';
const doc=(text:string)=>({blocks:text.split('\n').map((text,i)=>({sourceId:'b'+i,text,kind:'paragraph',bbox:[0,0,1,1]})),warnings:[],width:100,height:100} as any);
it('excludes_demographics_and_images',()=>{
 const {payload}=preparePayload(doc('姓名：张三 性别：男 年龄：55岁\n检查部位：双肾\n超声所见：双肾轮廓清晰。\n超声提示：双肾未见明显异常。'));
 expect(JSON.stringify(payload)).not.toMatch(/张三|55岁|性别|年龄|originalPath/);
 expect(payload.examination[0].text).toContain('双肾');
});
it('redacts_identity_inside_findings',()=>{
 const {payload}=preparePayload(doc('检查部位：肝脏\n超声所见：姓名：张三，电话13812345678，肝脏轮廓清晰。\n超声提示：未见明显异常'));
 expect(JSON.stringify(payload)).not.toMatch(/张三|13812345678/);
});
it('ambiguous_sections_stop_send',()=>expect(preparePayload(doc('一段没有分区的文字')).needsConfirmation).toBe(true));
it('no_table_is_valid',()=>expect(preparePayload(doc('检查部位：双肾\n超声所见：双肾轮廓清晰。\n超声提示：未见异常。')).needsConfirmation).toBe(false));
it('manual_payload_must_still_be_filtered',()=>expect(()=>validatePayloadPrivacy({examination:[],findings:[{sourceId:'b1',text:'姓名：李四'}],measurements:[],conclusion:[]})).toThrow());

it('table_cells_keep_row_column_and_span',()=>{
 const d=doc('检查部位：心脏\n超声所见：\n左心房\n38\n超声提示：左房增大');
 d.blocks[2]={...d.blocks[2],kind:'cell',tableId:'t1',row:0,column:0,rowspan:1,colspan:1};
 d.blocks[3]={...d.blocks[3],kind:'cell',tableId:'t1',row:0,column:1,rowspan:1,colspan:1};
 expect((preparePayload(d).payload.measurements[1] as any).table.column).toBe(1);
});
it('manual_identity_without_colon_is_rejected',()=>expect(()=>validatePayloadPrivacy({examination:[{sourceId:'e',text:'双肾'}],findings:[{sourceId:'b1',text:'姓名 李四，双肾轮廓清晰'}],measurements:[],conclusion:[{sourceId:'c',text:'未见异常'}]})).toThrow());
it('keeps_empty_measurement_cells',()=>{const d=doc('检查部位：心脏\n超声所见：\n\n超声提示：未见异常');d.blocks[2]={...d.blocks[2],kind:'cell',tableId:'t1',row:0,column:1};expect(preparePayload(d).payload.measurements).toHaveLength(1);expect(preparePayload(d).payload.measurements[0].text).toBe('');});
it('split_table_identity_values_never_reach_payload',()=>{
 const d=doc('检查部位：双肾\n姓名\n张三\n性别\n男\n年龄\n55\n超声所见：双肾轮廓清晰\n超声提示：未见异常');
 for(let i=1;i<=6;i++)d.blocks[i]={...d.blocks[i],kind:'cell',tableId:'identity',row:0,column:i-1};
 const result=preparePayload(d);expect(JSON.stringify(result.payload)).not.toMatch(/张三|"男"|55/);expect(result.needsConfirmation).toBe(true);
});
it('redaction_only_findings_cannot_pass_completeness',()=>{
 const result=preparePayload(doc('检查部位：双肾\n超声所见：姓名：张三 双肾大小正常\n超声提示：未见异常'));
 expect(result.needsConfirmation).toBe(true);expect(()=>validatePayloadPrivacy(result.payload)).toThrow();
});
it('split_paragraph_identity_value_is_excluded',()=>{
 const result=preparePayload(doc('检查部位：双肾\n超声所见：轮廓清晰\n姓名：\n李四\n超声提示：未见异常'));
 expect(JSON.stringify(result.payload)).not.toContain('李四');expect(result.needsConfirmation).toBe(true);
});
it('fully_tabular_report_keeps_examination_findings_and_conclusion_context',()=>{
 const d=doc('检查部位：\n心脏\n超声所见：\n左心房\n38mm\n超声提示：\n左房增大');
 d.blocks=d.blocks.map((block:any,i:number)=>({...block,kind:'cell',tableId:'t1',row:i,column:0}));
 const result=preparePayload(d);
 expect(result.payload.examination.some(item=>item.text==='心脏')).toBe(true);
 expect(result.payload.conclusion.some(item=>item.text==='左房增大')).toBe(true);
 expect(result.payload.measurements.some(item=>item.text==='38mm')).toBe(true);
 expect(result.needsConfirmation).toBe(false);
});
it('findings_heading_without_body_or_measurements_still_requires_review',()=>{
 const result=preparePayload(doc('检查部位：双肾\n超声所见：\n超声提示：未见异常'));
 expect(result.needsConfirmation).toBe(true);
});
it('spaced_identity_labels_never_reach_payload',()=>{
 const result=preparePayload(doc('检查部位：双肾\n超声所见：双肾轮廓清晰。\n姓 名：张三，性 别：男，年 龄：55\n超声提示：未见异常'));
 expect(JSON.stringify(result.payload)).not.toMatch(/张三|55|"男"/);expect(result.needsConfirmation).toBe(true);
});
it('manual_spaced_identity_labels_are_rejected',()=>{
 expect(()=>validatePayloadPrivacy({examination:[{sourceId:'e',text:'双肾'}],findings:[{sourceId:'f',text:'双肾轮廓清晰。姓 名：张三，性 别：男，年 龄：55'}],measurements:[],conclusion:[{sourceId:'c',text:'未见异常'}]})).toThrow();
});
it('standalone_spaced_physician_heading_stops_clinical_section',()=>{
 const result=preparePayload(doc('检查部位：双肾\n超声所见：双肾轮廓清晰。\n报 告 医 师\n王医生\n超声提示：未见异常'));
 expect(JSON.stringify(result.payload)).not.toContain('王医生');
});
it('spaced_identity_and_physician_cells_quarantine_the_related_table',()=>{
 for(const label of ['姓 名','报 告 医 师']){
  const d=doc(`检查部位：双肾\n超声所见：双肾轮廓清晰。\n${label}\n王某\n超声提示：未见异常`);
  for(const index of [2,3])d.blocks[index]={...d.blocks[index],kind:'cell',tableId:'private',row:0,column:index-2};
  const result=preparePayload(d);expect(JSON.stringify(result.payload)).not.toContain('王某');expect(result.needsConfirmation).toBe(true);
 }
});
