import {useState,useEffect,useRef} from 'react';
import type {OCRDocument,QCResult,TaskEvent} from '../../../shared/contracts';
export const statusNames:Record<string,string>={passed:'通过',issues_found:'发现问题',needs_review:'需人工复核',failed:'处理失败',processing:'处理中',awaiting_confirmation:'待核对后发送'};
const categoryNames:Record<string,string>={typo:'错别字',missing_text:'缺字漏字',extra_text:'多字',unit:'单位',magnitude:'数量级',logic:'内部逻辑',ocr:'识别核对',insufficient_information:'信息不足',other:'其他'};
export default function Review({event,document,result,busy,onRetry}:{event:TaskEvent|null;document:OCRDocument|null;result:QCResult|null;busy:boolean;onRetry:(doc:OCRDocument)=>Promise<void>}){
 const [tab,setTab]=useState<'issues'|'text'>('issues'),[editing,setEditing]=useState(false),[draft,setDraft]=useState<Readonly<Record<string,string>>>({}),[active,setActive]=useState<string[]>([]),[error,setError]=useState('');
 const [extra,setExtra]=useState<OCRDocument['blocks']>([]);
 const sourceRefs=useRef(new Map<string,HTMLDivElement>());
 useEffect(()=>{setDraft({});setEditing(false);setActive([]);setExtra([]);},[document]);
 const visibleBlocks=[...(document?.blocks||[]),...extra];
 function toggleEdit(){if(editing){setDraft({});setExtra([]);}setEditing(!editing);}
 function addParagraph(){if(!document)return;setExtra([...extra,{sourceId:'manual-'+crypto.randomUUID(),kind:'paragraph',text:'',bbox:[0,0,document.width,document.height],confidence:null}]);}
 async function retry(){if(!document)return;setError('');try{await onRetry({...document,blocks:visibleBlocks.map(b=>({...b,text:draft[b.sourceId]??b.text})).filter(b=>b.kind==='cell'||b.text.trim()),warnings:[]});setEditing(false);}catch(error){setError((error as Error).message);}}
 function locate(ids:string[]){setActive(ids);setTab('text');setTimeout(()=>sourceRefs.current.get(ids[0])?.scrollIntoView({behavior:'smooth',block:'center'}),50);}
 const status=result?.status|| (event?.stage==='failed'?'failed':undefined);
 const emptyTitle=status==='passed'?'本次未发现文字质量问题':status==='failed'?'本次质控未完成':status==='needs_review'?'需要人工核对':busy?'正在处理报告':'等待报告质控';
 const emptyDescription=status==='passed'?'记录已保存，可拍摄下一份报告。':status==='failed'?'本次未取得有效质控结果，可核对识别文字后手动重试。':status==='needs_review'?'请对照原图核对报告内容。':busy?'请等待当前处理完成。':'拍照后自动识别并检查报告。';
 return <section className="panel review-panel"><div className="panel-title"><div><span className="eyebrow">QUALITY REVIEW</span><h2>质控结果</h2></div>{status&&<span className={'tag '+status}>{statusNames[status]}</span>}</div>
  {busy&&<div className="processing"><span className="spinner"/><div><strong>{event?.message||'正在处理报告'}</strong><small>请保留当前报告，等待处理完成</small></div></div>}
  {event?.stage==='failed'&&<div className="notice error"><strong>处理失败，未放行</strong><p>{event.message}</p></div>}
  {result&&<div className={'result-summary '+result.status}><div className="result-icon">{result.status==='passed'?'✓':result.status==='failed'?'×':'!'}</div><div><h3>{statusNames[result.status]}</h3><p>{result.summary}</p></div></div>}
  <div className="tabs"><button className={tab==='issues'?'active':''} onClick={()=>setTab('issues')}>问题与建议 {result?.issues.length?`(${result.issues.length})`:''}</button><button className={tab==='text'?'active':''} onClick={()=>setTab('text')}>识别文字 {document?`(${visibleBlocks.length})`:''}</button></div>
  <div className="review-scroll">
  {tab==='issues'&&<>{result?.issues.map((issue,index)=><article className="issue-card" key={index}><div className="issue-header"><span className={'issue-number '+issue.severity}>{String(index+1).padStart(2,'0')}</span><strong>{categoryNames[issue.category]||issue.category}</strong>{issue.requiresReview&&<span className="tag">人工核对</span>}</div><button className="quote" onClick={()=>locate(issue.sourceIds)}>“{issue.quote}” <small>定位原文 ↗</small></button><p>{issue.reason}</p>{issue.suggestion&&<div className="suggestion"><small>推荐修改 / 核对</small><p>{issue.suggestion}</p></div>}</article>)}{(!result||result.issues.length===0)&&<div className="empty-state"><div>{status==='passed'?'✓':status==='failed'?'×':'◈'}</div><h3>{emptyTitle}</h3><p>{emptyDescription}</p></div>}</>}
  {tab==='text'&&<>{document?<><div className="text-toolbar"><span>共 {visibleBlocks.length} 个文本 / 表格单元</span><button disabled={busy} onClick={toggleEdit}>{editing?'取消编辑':'编辑识别文字'}</button></div>{document.warnings.map((warning,i)=><div className="notice" key={i}>{warning}</div>)}{visibleBlocks.map(block=><div key={block.sourceId} ref={element=>{if(element)sourceRefs.current.set(block.sourceId,element);else sourceRefs.current.delete(block.sourceId);}} className={'source-block '+(active.includes(block.sourceId)?'highlight':'')}><small>{block.sourceId}{block.tableId?` · 表 ${block.tableId} 第 ${(block.row??0)+1} 行 / ${(block.column??0)+1} 列`:''}</small>{editing?<textarea aria-label={`编辑 ${block.sourceId}`} value={draft[block.sourceId]??block.text} onChange={e=>setDraft({...draft,[block.sourceId]:e.target.value})}/>:<p>{block.text||'（空单元格）'}</p>}</div>)}{editing&&<div className="button-row"><button disabled={busy} onClick={addParagraph}>新增文本段落</button><button className="primary" disabled={busy} onClick={()=>void retry()}>使用修订文字重新质控</button></div>}</>:<div className="empty-state"><div>≡</div><h3>等待 OCR 识别</h3><p>识别完成后显示正文与表格单元。</p></div>}</>}
  </div>{error&&<div className="notice error">{error}</div>}
  <div className="review-bottom"><span className="privacy-dot"/>辅助文字质控 · 建议由医生在原报告系统确认修改</div>
 </section>;
}
