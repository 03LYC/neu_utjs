import {describe,it,expect} from 'vitest';
import {ResultValidationError,validateResult,type OCRDocument,type QCResult} from '../shared/contracts';
const doc={blocks:[{sourceId:'b1',text:'右肾长径9.7cm'}]} as any;
const issue={category:'unit',severity:'warning',sourceIds:['b1'],quote:'右肾长径9.7cm',reason:'需核对',suggestion:null,requiresReview:false};
it('unknown_quote_is_rejected',()=>expect(()=>validateResult({status:'issues_found',summary:'',issues:[{...issue,quote:'左肾10cm'}]},doc)).toThrow());
it('definite_issue_cannot_hide_as_review_status',()=>expect(validateResult({status:'needs_review',summary:'',issues:[issue]},doc).status).toBe('issues_found'));
it('uncertain_issues_are_retained_as_needs_review',()=>{const result=validateResult({status:'issues_found',summary:'需核对',issues:[{...issue,requiresReview:true}]},doc);expect(result.status).toBe('needs_review');expect(result.issues).toHaveLength(1);});
it('review_only_issue_cannot_hide_as_passed',()=>expect(()=>validateResult({status:'passed',summary:'',issues:[{...issue,requiresReview:true}]},doc)).toThrow());

describe('strict_source_quotes',()=>{
 const document:OCRDocument={width:100,height:100,warnings:[],blocks:[
  {sourceId:'b1',text:'右肾长径9.7cm，实质回声均匀。',kind:'paragraph',bbox:[0,0,100,20]},
  {sourceId:'b2',text:'左肾长径10.1cm。',kind:'paragraph',bbox:[0,20,100,40]},
 ]};
 const result=(quote:string,sourceIds=['b1']):QCResult=>({status:'issues_found',summary:'合成测试',issues:[{...issue,category:'unit',severity:'warning',quote,sourceIds}]});
 it('accepts_a_quote_from_any_one_of_multiple_cited_sources',()=>{
  expect(validateResult(result('左肾长径10.1cm。',['b1','b2']),document).issues[0].quote).toBe('左肾长径10.1cm。');
 });
 it('rejects_a_quote_spanning_two_sources_even_when_their_text_would_concatenate',()=>{
  expect(()=>validateResult(result('实质回声均匀。左肾长径10.1cm。',['b1','b2']),document)).toThrow('模型摘录与原文不符');
 });
 it('does_not_form_a_word_across_source_boundaries',()=>{
  const split={...document,blocks:document.blocks.map((block,index)=>({...block,text:index===0?'右':'肾'}))};
  expect(()=>validateResult(result('右肾',['b1','b2']),split)).toThrow('模型摘录与原文不符');
 });
 it.each([' ','\t\n','\u3000 \r\n'])('rejects_whitespace_only_quote_%j',quote=>{
  expect(()=>validateResult(result(quote),document)).toThrow('模型摘录与原文不符');
 });
 it('rejects_an_unknown_or_unsent_source_even_when_another_cited_source_matches',()=>{
  expect(()=>validateResult(result('右肾长径9.7cm',['b1','not-sent']),document)).toThrow('模型引用了不存在的原文位置');
 });
 it('rejects_a_quote_from_a_source_that_was_not_cited',()=>{
  expect(()=>validateResult(result('左肾长径10.1cm。'),document)).toThrow('模型摘录与原文不符');
 });
 it('keeps_whitespace_normalization_for_real_ocr_quotes',()=>{
  const spaced={...document,blocks:document.blocks.map(block=>({...block,text:block.sourceId==='b1'?'右 肾长径 9.7 cm，\n实质回声均匀。':block.text}))};
  expect(validateResult(result('右肾 长径9.7cm，实质\t回声均匀。'),spaced).issues).toHaveLength(1);
 });
 it.each([
  ['number','右肾长径9.8cm'],
  ['unit','右肾长径9.7mm'],
  ['punctuation','右肾长径9.7cm,实质回声均匀。'],
  ['removed_punctuation','右肾长径9.7cm实质回声均匀。'],
  ['ellipsis','右肾长径9.7cm……实质回声均匀。'],
 ])('rejects_changes_to_%s',(_kind,quote)=>{
  expect(()=>validateResult(result(quote),document)).toThrow('模型摘录与原文不符');
 });
 it('exposes_only_structured_reference_failure_context',()=>{
  const value=result('右肾长径9.7cm');value.issues.push({...value.issues[0],sourceIds:['b2'],quote:'不存在的摘录'});
  try{validateResult(value,document);expect.fail('should reject');}catch(error){
   expect(error).toBeInstanceOf(ResultValidationError);
   expect(error).toMatchObject({code:'quote_mismatch',issueIndex:1,sourceIds:['b2'],message:'模型摘录与原文不符'});
   expect(JSON.stringify(error)).not.toContain('不存在的摘录');
  }
 });
 it('marks_missing_sources_with_a_distinct_safe_error_code',()=>{
  expect(()=>validateResult(result('右肾长径9.7cm',['missing']),document)).toThrow(expect.objectContaining({code:'unknown_source',issueIndex:0,sourceIds:['missing']}));
 });
});

describe('quality_status_rules',()=>{
 it('keeps_a_passed_result_without_issues',()=>expect(validateResult({status:'passed',summary:'无问题',issues:[]},doc).status).toBe('passed'));
 it.each(['issues_found','needs_review'])('rejects_%s_without_evidence',status=>{
  expect(()=>validateResult({status,summary:'缺少依据',issues:[]},doc)).toThrow('问题状态缺少原文核对依据');
 });
 it('keeps_a_definite_issue_when_mixed_with_review_only_issues',()=>{
  expect(validateResult({status:'needs_review',summary:'合成测试',issues:[{...issue,requiresReview:true},issue]},doc).status).toBe('issues_found');
 });
 it('keeps_failed_results_as_failed',()=>expect(validateResult({status:'failed',summary:'处理失败',issues:[]},doc).status).toBe('failed'));
});
