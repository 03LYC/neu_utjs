import {useState} from 'react';
import type {QCPayload} from '../../../shared/contracts';
export default function SendPreview({payload,reasons,onConfirm,onDismiss,onError}:{payload:QCPayload;reasons:string[];onConfirm:(value:QCPayload)=>Promise<void>;onDismiss:()=>Promise<void>;onError:(message:string)=>void}){
 const [draft,setDraft]=useState(payload),[busy,setBusy]=useState(false);
 const names={examination:'检查部位',findings:'超声所见',measurements:'测量表',conclusion:'超声结论'};
 async function send(){setBusy(true);try{await onConfirm(draft);}catch(error){onError((error as Error).message);}finally{setBusy(false);}}
 return <div className="send-preview"><h3>发送前需核对</h3><p>{reasons.join('；')}</p><p className="muted">仅以下四项会发送。请删除身份、年龄和性别信息，并对照原图修正识别。</p>
 {Object.entries(names).map(([key,title])=><div key={key} className="preview-section"><label>{title}</label>{draft[key as keyof QCPayload].length?draft[key as keyof QCPayload].map((entry,i)=><div key={entry.sourceId}><small>{entry.sourceId}</small><textarea value={entry.text} onChange={e=>setDraft({...draft,[key]:draft[key as keyof QCPayload].map((item,n)=>n===i?{...item,text:e.target.value}:item)})}/></div>):<p className="muted">未提取到；请使用“编辑识别文字”补充分区。</p>}</div>)}
 <div className="button-row"><button className="primary" disabled={busy} onClick={()=>void send()}>已核对，发送质控</button><button disabled={busy} onClick={()=>void onDismiss().catch(e=>onError(e.message))}>暂不发送，留待复核</button></div></div>;
}
