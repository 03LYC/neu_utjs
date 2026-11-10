import { describe, it, expect } from 'vitest';
import { resultSchema, validateResult } from '../shared/contracts';
describe('quality result contract',()=>{
  it('rejects_unknown_status',()=>expect(resultSchema.safeParse({status:'ok',summary:'',issues:[]}).success).toBe(false));
  it('passed_with_issues_is_rejected',()=>expect(()=>validateResult({status:'passed',summary:'',issues:[{category:'typo',severity:'warning',sourceIds:['b1'],quote:'原文',reason:'错字',suggestion:'改',requiresReview:false}]},{blocks:[{sourceId:'b1',text:'原文'}]} as any)).toThrow());
  it('requires_issue_source_reference',()=>expect(()=>validateResult({status:'issues_found',summary:'',issues:[{category:'typo',severity:'warning',sourceIds:['missing'],quote:'原文',reason:'错字',suggestion:'改',requiresReview:false}]},{blocks:[{sourceId:'b1',text:'原文'}]} as any)).toThrow());
});
