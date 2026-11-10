import type {OCRDocument,QCPayload} from '../shared/contracts';

const clinicalHeadings=new Set(['检查部位','检查项目','超声所见','超声描述','检查所见','超声提示','超声诊断','诊断意见','检查结论','超声结论']);
const headingPattern=/(检查部位|检查项目|超声所见|超声描述|检查所见|超声提示|超声诊断|诊断意见|检查结论|超声结论|临床诊断|临床资料|患者信息|基本信息|报告医师|审核医师|报告日期|检查日期|备注)\s*[:：]/g;
const splitWarning='同一识别文本包含多个报告分区，已拆分，请对照原图核对';
const leadingClinicalHeading=new RegExp(`^\\s*(${[...clinicalHeadings].join('|')})\\s*(?:[:：]|$)`);

export function applyConfirmedText(doc:OCRDocument,payload:QCPayload):OCRDocument{
 const sent=new Map(Object.values(payload).flat().map(entry=>[entry.sourceId,entry.text]));
 return {...doc,blocks:doc.blocks.map(block=>{
  if(!sent.has(block.sourceId))return block;
  const text=sent.get(block.sourceId)!;
  const heading=block.text.match(leadingClinicalHeading);
  // Keep explicit section labels (including separate header-only blocks) for
  // editing/retry. Actual model evidence is checked against payload, not labels.
  return {...block,text:heading&&!leadingClinicalHeading.test(text)?`${heading[1]}：${text}`:text};
 })};
}

export function normalizeReportSections(doc:OCRDocument):OCRDocument{
 const usedIds=new Set(doc.blocks.map(block=>block.sourceId));
 let changed=false;
 const blocks=doc.blocks.flatMap(block=>{
  const headings=[...block.text.matchAll(headingPattern)];
  if(headings.filter(match=>clinicalHeadings.has(match[1])).length<2)return [block];
  changed=true;
  const boundaries=[0,...headings.map(match=>match.index!).filter(index=>index>0),block.text.length];
  let nextIndex=0;
  return boundaries.slice(0,-1).flatMap((start,index)=>{
   const text=block.text.slice(start,boundaries[index+1]);
   if(!text.trim())return [];
   let sourceId:string;
   do{sourceId=`${block.sourceId}:section:${nextIndex++}`;}while(usedIds.has(sourceId));
   usedIds.add(sourceId);
   // Retain source geometry and table membership for locating text and excluding private tables.
   return [{...block,sourceId,text,kind:'paragraph' as const}];
  });
 });
 return changed?{...doc,blocks,warnings:[...new Set([...doc.warnings,splitWarning])]}:doc;
}
