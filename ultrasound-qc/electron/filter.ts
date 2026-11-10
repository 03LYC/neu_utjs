import {payloadSchema,type QCPayload,type OCRDocument} from '../shared/contracts';
const identityNames=['患者姓名','病人姓名','姓名','身份证号','身份证','证件号','就诊号','住院号','门诊号','病案号','检查号','申请单号','联系电话','联系方式','电话','手机号','出生日期','出生年月','年龄','性别','报告医师','审核医师'];
const spacedIdentity=new RegExp(identityNames.map(label=>[...label].join('\\s*')).join('|'),'g');
const normalizeLabels=(text:string)=>text.replace(spacedIdentity,match=>match.replace(/\s/g,''));
const sensitiveLabel=/(?:患者姓名|病人姓名|姓名|身份证(?:号)?|证件号|就诊号|住院号|门诊号|病案号|检查号|申请单号|联系电话|联系方式|电话|手机号|出生日期|出生年月|年龄|性别)\s*[:：]?\s*[^，,。；;\n\t]*/g;
const privatePattern=/(?:姓名|身份证|证件号|就诊号|住院号|门诊号|病案号|检查号|联系电话|电话|手机号|出生日期|年龄|性别)\s*[:：]?\s*\S|\b1[3-9]\d{9}\b|\b\d{17}[\dXx]\b|\b\d{15,18}\b|\d+\s*(?:岁|周岁)|(?:男性|女性)/;
const personalField=/(?:患者姓名|病人姓名|姓名|身份证(?:号)?|证件号|就诊号|住院号|门诊号|病案号|检查号|申请单号|联系电话|联系方式|电话|手机号|出生日期|出生年月|年龄|性别)/;
const labelOnly=/^\s*(?:患者姓名|病人姓名|姓名|身份证(?:号)?|证件号|就诊号|住院号|门诊号|病案号|检查号|申请单号|联系电话|联系方式|电话|手机号|出生日期|出生年月|年龄|性别)\s*[:：]?\s*$/;
const sectionHeading=/^(?:检查部位|检查项目|超声所见|超声描述|检查所见|超声提示|超声诊断|诊断意见|检查结论|超声结论)\s*(?:[:：]|$)/;
const meaningful=(text:string)=>/[\p{L}\p{N}]/u.test(text.replace(/\[已去除[^\]]*\]/g,''));
const findingsHeaderOnly=/^(?:超声所见|超声描述|检查所见)\s*[:：]?\s*$/;
const tableContext=(block:OCRDocument['blocks'][number])=>block.tableId&&(block.kind==='cell'||block.kind==='table')?{table:{id:block.tableId,row:block.row??0,column:block.column??0,rowspan:block.rowspan??1,colspan:block.colspan??1}}:{};
function redact(text:string):string{
 text=normalizeLabels(text);
 return text.replace(sensitiveLabel,'[已去除个人信息]').replace(/\b1[3-9]\d{9}\b/g,'[已去除联系方式]').replace(/\b\d{15,18}[Xx]?\b/g,'[已去除编号]').replace(/\d+\s*(?:周岁|岁)/g,'[已去除年龄]').replace(/(?:男性|女性)/g,'[已去除性别]').trim();
}
export function validatePayloadPrivacy(raw:unknown):QCPayload{
 const value=payloadSchema.parse(raw);
 for(const section of Object.values(value)) for(const item of section){
  const normalized=normalizeLabels(item.text);if(privatePattern.test(normalized)||labelOnly.test(normalized)||/(?:报告医师|审核医师)/.test(normalized))throw new Error('发送内容疑似包含个人信息，请在发送预览中删除');
 }
 const findingsBody=value.findings.some(entry=>meaningful(entry.text)&&!findingsHeaderOnly.test(entry.text));
 const tabularFindings=value.findings.some(entry=>findingsHeaderOnly.test(entry.text))&&value.measurements.some(entry=>meaningful(entry.text)&&!findingsHeaderOnly.test(entry.text));
 if(!value.examination.some(x=>meaningful(x.text))||(!findingsBody&&!tabularFindings)||!value.conclusion.some(x=>meaningful(x.text)))throw new Error('检查部位、所见和结论不能为空或仅含脱敏占位符');
 return value;
}
export function preparePayload(doc:OCRDocument):{payload:QCPayload;needsConfirmation:boolean;reasons:string[]}{
 const payload:QCPayload={examination:[],findings:[],measurements:[],conclusion:[]};
 const reasons=[...doc.warnings];
 const privateTables=new Set<string>();
 const privateBlocks=new Set<string>();
 for(let index=0;index<doc.blocks.length;index++){
  const block=doc.blocks[index];
  const normalized=normalizeLabels(block.text);
  if(block.tableId&&(personalField.test(normalized)||/(?:报告医师|审核医师)/.test(normalized)))privateTables.add(block.tableId);
  if(labelOnly.test(normalized)){
   privateBlocks.add(block.sourceId);
   // OCR can put an identity label and its value in separate paragraphs/cells.
   for(let next=index+1;next<doc.blocks.length;next++){
    const candidate=doc.blocks[next];
    if(sectionHeading.test(candidate.text)||labelOnly.test(normalizeLabels(candidate.text)))break;
    privateBlocks.add(candidate.sourceId);
    if(candidate.text.trim())break;
   }
  }
 }
 if(privateTables.size||privateBlocks.size)reasons.push('检测到分散的个人信息字段，相关表格或相邻内容已排除，请核对是否影响报告完整性');
 let section:'examination'|'findings'|'conclusion'|null=null;
 let unknown=0;
 for(const block of doc.blocks){
  if(privateBlocks.has(block.sourceId)||(block.tableId&&privateTables.has(block.tableId)))continue;
  let text=block.text.trim();
  const match=text.match(/^(检查部位|检查项目|超声所见|超声描述|检查所见|超声提示|超声诊断|诊断意见|检查结论|超声结论)\s*(?:[:：]\s*([\s\S]*)|$)/);
  if(match){
   section=/检查部位|检查项目/.test(match[1])?'examination':/所见|描述/.test(match[1])?'findings':'conclusion';
   text=match[2]||'';
   if(section==='findings'&&!text){payload.findings.push({sourceId:block.sourceId,text:block.text.trim(),...tableContext(block)});continue;}
  }else if(/^(临床诊断|临床资料|患者信息|基本信息|报告医师|审核医师|报告日期|检查日期|备注)(?:[:：]|$)/.test(text.replace(/\s/g,''))){
   section=null;continue;
  }
  if(!section){if(text)unknown++;continue;}
  if(!text&&block.kind!=='cell')continue;
  const beforeRedaction=text;
  text=redact(text);
  if(text!==beforeRedaction)reasons.push('报告正文中已去除个人信息，请核对脱敏后内容是否完整');
  if(!meaningful(text)&&block.kind!=='cell')continue;
  if(!text&&block.kind!=='cell')continue;
  const target=section==='findings'&&(block.kind==='cell'||block.kind==='table')?'measurements':section;
  payload[target].push({sourceId:block.sourceId,text,...tableContext(block)});
 }
 try{validatePayloadPrivacy(payload);}catch(error){reasons.push((error as Error).message);}
 if(!doc.blocks.length)reasons.push('未识别到报告文字，请重拍');
 // Unclassified headers are expected; unclassified body-sized text needs confirmation.
 if(unknown>8)reasons.push('存在较多未能归入报告分区的内容，请核对');
 return {payload,needsConfirmation:reasons.length>0,reasons:[...new Set(reasons)]};
}
