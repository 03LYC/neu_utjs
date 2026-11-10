import {describe,it,expect} from 'vitest';
import {normalizeReportSections,applyConfirmedText} from '../electron/sections';
import {preparePayload} from '../electron/filter';
import type {OCRBlock,OCRDocument} from '../shared/contracts';

const splitWarning='同一识别文本包含多个报告分区，已拆分，请对照原图核对';
const block=(sourceId:string,text:string,extra:Partial<OCRBlock>={}):OCRBlock=>({sourceId,text,kind:'paragraph',bbox:[0,0,100,20],...extra});
const document=(blocks:OCRBlock[],warnings:string[]=[]):OCRDocument=>({blocks,warnings,width:100,height:200,fullText:'保留原始全文',});

describe('normalize_report_sections',()=>{
 it('keeps_separate_headings_and_edited_text_for_retry_after_confirmation',()=>{
  const raw=document([block('e0','检查部位：'),block('e1','双肾'),block('f0','超声所见：'),block('f1','轮廓清晰。'),block('c0','超声提示：'),block('c1','未见异常。')]);
  const payload={examination:[{sourceId:'e1',text:'双肾'}],findings:[{sourceId:'f0',text:'超声所见：'},{sourceId:'f1',text:'轮廓尚清晰。'}],measurements:[],conclusion:[{sourceId:'c1',text:'未见明显异常。'}]};
  const revised=applyConfirmedText(raw,payload);
  expect(revised.blocks).toHaveLength(6);
  expect(raw.blocks[3].text).toBe('轮廓清晰。');
  const prepared=preparePayload(revised);
  expect(prepared.payload).toEqual(payload);expect(prepared.needsConfirmation).toBe(false);
 });
 it('splits_multiple_explicit_headings_in_one_cell_without_changing_the_source_document',()=>{
  const original=block('t1c0','检查部位：腹部 超声所见：轮廓清晰。 超声提示：未见明显异常。',{kind:'cell',tableId:'t1',row:0,column:0,rowspan:2,colspan:3,confidence:0.9,bbox:[2,3,90,180]});
  const doc=document([original]);const before=structuredClone(doc);
  const normalized=normalizeReportSections(doc);
  expect(doc).toEqual(before);
  expect(normalized.blocks.map(item=>item.text)).toEqual(['检查部位：腹部 ','超声所见：轮廓清晰。 ','超声提示：未见明显异常。']);
  expect(normalized.blocks.map(item=>item.sourceId)).toEqual(['t1c0:section:0','t1c0:section:1','t1c0:section:2']);
  for(const fragment of normalized.blocks)expect(fragment).toMatchObject({kind:'paragraph',tableId:'t1',row:0,column:0,rowspan:2,colspan:3,confidence:0.9,bbox:[2,3,90,180]});
  expect(normalized).toMatchObject({width:doc.width,height:doc.height,fullText:doc.fullText,warnings:[splitWarning]});
  const prepared=preparePayload(normalized);
  expect(prepared.payload.examination.map(item=>item.text)).toEqual(['腹部']);
  expect(prepared.payload.findings.map(item=>item.text)).toEqual(['轮廓清晰。']);
  expect(prepared.payload.conclusion.map(item=>item.text)).toEqual(['未见明显异常。']);
  expect(prepared.needsConfirmation).toBe(true);
 });
 it('keeps_later_original_cells_in_the_findings_section_as_measurements',()=>{
  const normalized=normalizeReportSections(document([
   block('t1c0','检查部位：腹部 超声所见：轮廓清晰。',{kind:'cell',tableId:'t1',row:0,column:0}),
   block('t1c1','壁厚3mm',{kind:'cell',tableId:'t1',row:1,column:0}),
   block('t1c2','超声提示：未见明显异常。',{kind:'cell',tableId:'t1',row:2,column:0}),
  ]));
  const {payload}=preparePayload(normalized);
  expect(payload.examination.map(item=>item.text)).toEqual(['腹部']);
  expect(payload.findings.map(item=>item.text)).toEqual(['轮廓清晰。']);
  expect(payload.measurements).toEqual([{sourceId:'t1c1',text:'壁厚3mm',table:{id:'t1',row:1,column:0,rowspan:1,colspan:1}}]);
  expect(payload.conclusion.map(item=>item.text)).toEqual(['未见明显异常。']);
 });
 it('retains_table_membership_so_a_private_cell_still_excludes_the_entire_table',()=>{
  const normalized=normalizeReportSections(document([
   block('private','检查部位：腹部 患者信息：姓名：合成值 超声所见：轮廓清晰。',{kind:'cell',tableId:'private-table'}),
   block('neighbor','同表内容',{kind:'cell',tableId:'private-table'}),
   block('conclusion','超声提示：未见明显异常。'),
  ]));
  const prepared=preparePayload(normalized);
  expect(normalized.blocks.filter(item=>item.sourceId.startsWith('private:')).every(item=>item.tableId==='private-table')).toBe(true);
  expect(prepared.payload.examination).toEqual([]);
  expect(prepared.payload.findings).toEqual([]);
  expect(prepared.payload.measurements).toEqual([]);
  expect(JSON.stringify(prepared.payload)).not.toContain('合成值');
  expect(JSON.stringify(prepared.payload)).not.toContain('同表内容');
  expect(prepared.reasons).toContain('检测到分散的个人信息字段，相关表格或相邻内容已排除，请核对是否影响报告完整性');
 });
 it.each(['临床诊断','临床资料','患者信息','基本信息','报告医师','审核医师','报告日期','检查日期','备注'])('separates_nonclinical_heading_%s_from_the_clinical_body',heading=>{
  const normalized=normalizeReportSections(document([block('b0',`检查部位：腹部 超声所见：轮廓清晰。 ${heading}：合成元数据 超声提示：未见明显异常。`)]));
  expect(normalized.blocks).toHaveLength(4);
  expect(normalized.blocks[2].text).toBe(`${heading}：合成元数据 `);
  const {payload}=preparePayload(normalized);
  expect(payload.findings.map(item=>item.text)).toEqual(['轮廓清晰。']);
  expect(payload.conclusion.map(item=>item.text)).toEqual(['未见明显异常。']);
  expect(JSON.stringify(payload)).not.toContain('合成元数据');
 });
 it('preserves_a_nonempty_prefix_instead_of_dropping_unclassified_text',()=>{
  const doc=document([block('b0','前置内容。 检查部位：腹部 超声所见：轮廓清晰。')]);
  const normalized=normalizeReportSections(doc);
  expect(normalized.blocks[0].text).toBe('前置内容。 ');
  expect(normalized.blocks.map(item=>item.text).join('')).toBe(doc.blocks[0].text);
 });
 it('avoids_collisions_with_existing_derived_source_ids',()=>{
  const doc=document([block('b0','检查部位：腹部 超声所见：轮廓清晰。'),block('b0:section:0','已有段落甲'),block('b0:section:2','已有段落乙')]);
  const normalized=normalizeReportSections(doc);
  expect(normalized.blocks.slice(0,2).map(item=>item.sourceId)).toEqual(['b0:section:1','b0:section:3']);
  expect(new Set(normalized.blocks.map(item=>item.sourceId)).size).toBe(normalized.blocks.length);
 });
 it.each([
  '超声所见：轮廓清晰。',
  '检查部位：腹部 备注：合成元数据',
  '检查部位 腹部 超声所见 轮廓清晰。',
 ])('leaves_text_without_two_explicit_clinical_headings_unchanged_%s',text=>{
  const doc=document([block('b0',text)]);
  expect(normalizeReportSections(doc)).toBe(doc);
 });
 it('is_idempotent_and_adds_the_split_warning_only_once',()=>{
  const normalized=normalizeReportSections(document([
   block('b0','检查部位：腹部 超声所见：轮廓清晰。'),
   block('b1','检查项目:腹部 检查结论:未见明显异常。'),
  ],[splitWarning]));
  expect(normalized.warnings.filter(warning=>warning===splitWarning)).toHaveLength(1);
  expect(normalizeReportSections(normalized)).toBe(normalized);
 });
 it('does_not_invent_a_body_for_an_empty_findings_section',()=>{
  const prepared=preparePayload(normalizeReportSections(document([block('b0','检查部位：腹部 超声所见： 超声提示：未见明显异常。')])));
  expect(prepared.payload.findings.map(item=>item.text)).toEqual(['超声所见：']);
  expect(prepared.needsConfirmation).toBe(true);
  expect(prepared.reasons).toContain('检查部位、所见和结论不能为空或仅含脱敏占位符');
 });
});
