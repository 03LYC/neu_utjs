import {useState,useEffect,useRef} from 'react';
import Capture from './features/capture/Capture';
import Review from './features/review/Review';
import SendPreview from './features/review/SendPreview';
import Settings from './features/settings/Settings';
import History from './features/history/History';
import {defaults,type Settings as SettingsType,type TaskEvent,type OCRDocument,type QCResult,type ROI} from '../shared/contracts';
import type {} from '../shared/api';

export default function App(){
 const [page,setPage]=useState<'capture'|'history'|'settings'>('capture'),[settings,setSettings]=useState<SettingsType>(defaults),[info,setInfo]=useState<any>(null),[error,setError]=useState('');
 const [event,setEvent]=useState<TaskEvent|null>(null),[document,setDocument]=useState<OCRDocument|null>(null),[result,setResult]=useState<QCResult|null>(null),[busy,setBusy]=useState(false),[snapshot,setSnapshot]=useState('');
 const settingsRef=useRef(settings),sounds=useRef(new Set<string>());
 settingsRef.current=settings;
 const awaiting=event?.stage==='awaiting_confirmation';
 async function reloadSettings(){try{const value=await window.qc.getSettings();setInfo(value);setSettings(value.settings);}catch(error){setError((error as Error).message);}}
 useEffect(()=>{void reloadSettings();return window.qc.onTask(value=>{
  if(['ready','initializing','runtime_error'].includes(value.stage)){void reloadSettings();return;}
  setEvent(value);if(value.document)setDocument(value.document);if(value.result)setResult(value.result);
  if(['done','failed','awaiting_confirmation'].includes(value.stage))setBusy(false);else setBusy(true);
  if(value.stage==='done'&&value.result?.status==='issues_found'&&value.attemptId&&settingsRef.current.soundEnabled&&!sounds.current.has(value.attemptId)){
   sounds.current.add(value.attemptId);
   try{const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain();osc.connect(gain);gain.connect(audio.destination);osc.frequency.value=740;const now=audio.currentTime;gain.gain.setValueAtTime(settingsRef.current.volume*.15,now);gain.gain.setValueAtTime(0,now+.18);gain.gain.setValueAtTime(settingsRef.current.volume*.15,now+.28);osc.start();osc.stop(now+.55);osc.onended=()=>void audio.close();void audio.resume();}catch{setError('发现问题，但提示音无法播放，请检查声音设备');}
  }
 });},[]);
 async function submit(input:{dataUrl:string;fileToken?:string;roi:ROI|null}){setBusy(true);setError('');setResult(null);setDocument(null);setSnapshot(input.dataUrl);setEvent({stage:'capturing',message:'正在保存照片'});try{const value=await window.qc.submitCapture(input);setEvent(old=>old?.recordId?old:{...old!,recordId:value.recordId});}catch(error){setBusy(false);setEvent({stage:'failed',message:(error as Error).message});throw error;}}
 async function retry(id:string,doc?:OCRDocument){setPage('capture');setResult(null);setBusy(true);setError('');try{if(awaiting&&event?.recordId===id)await window.qc.dismissPending(id);const record=await window.qc.getRecord(id);setDocument(doc||record.ocr);setSnapshot(await window.qc.getRecordImage(id,'original'));setEvent({recordId:id,stage:'ocr',message:'正在重新质控'});await window.qc.retryTask(id,doc);}catch(error){setBusy(false);setError((error as Error).message);}}
 const subtitles={capture:'手动采集 · 本地识别 · 文字质量审核',history:'完整留档，随时回看每次质控依据',settings:'配置本机识别环境与模型连接'};
 return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-icon">✚</div><div><strong>超声质控</strong><span>Ultrasound QC</span></div></div><div className="sidebar-label">工作台</div><nav><button className={page==='capture'?'active':''} onClick={()=>setPage('capture')}><span aria-hidden="true">▣</span>报告质控</button><button className={page==='history'?'active':''} disabled={busy||awaiting} onClick={()=>setPage('history')}><span aria-hidden="true">▤</span>质控历史</button><button className={page==='settings'?'active':''} disabled={busy||awaiting} onClick={()=>{void reloadSettings();setPage('settings');}}><span aria-hidden="true">⚙</span>设置</button></nav><div className="sidebar-bottom"><div className="local-status"><span className="privacy-dot"/>本机完整留档</div><p>原图保存在本机<br/>模型仅接收筛选文字</p><span className="version">v0.1.0 · 桌面版</span></div></aside>
 <main className="workspace"><header className="topbar"><div><div className="breadcrumb">工作台 <span>/</span> {page==='capture'?'报告质控':page==='history'?'质控历史':'设置'}</div><h1>{page==='capture'?'超声报告质控':page==='history'?'质控历史':'应用设置'}</h1><p>{subtitles[page]}</p></div><div className="topbar-status"><span className="tag">DeepSeek</span><span className={'tag '+(info?.hasKey?'green':'')}>{info?.hasKey?'API 已配置':'API 待配置'}</span><small>{new Date().toLocaleDateString('zh-CN')}</small></div></header>
 {info?.testMode&&<div className="notice">测试数据目录模式 · 与正式报告记录隔离</div>}
 {error&&<div role="alert" className="notice error global-error"><span>{error}</span><button onClick={()=>setError('')}>关闭</button></div>}
 {page==='capture'&&<><div className="workflow"><span className={busy?'current':''}>01 采集报告</span><i>→</i><span>02 本地 OCR</span><i>→</i><span>03 模型质控</span><i>→</i><span>04 结果留档</span></div><div className="work-grid"><div><Capture busy={busy||awaiting} settings={settings} onCameraChange={async cameraId=>{const previous=settingsRef.current;const next={...previous,cameraId};settingsRef.current=next;setSettings(next);try{await window.qc.saveSettings(next);}catch(error){settingsRef.current=previous;setSettings(previous);throw error;}}} onCapture={submit} onError={setError}/>{snapshot&&<details className="panel snapshot"><summary>本次报告原始照片（本机留档）</summary><img src={snapshot} alt="本次报告原图"/></details>}</div><div><Review event={event} document={document} result={result} busy={busy} onRetry={doc=>event?.recordId?retry(event.recordId,doc):Promise.reject(new Error('没有当前记录'))}/>{awaiting&&event?.payload&&<section className="panel"><SendPreview key={event.recordId} payload={event.payload} reasons={event.reasons||[]} onError={setError} onConfirm={async payload=>{setBusy(true);try{await window.qc.confirmPayload(event.recordId!,payload);}catch(error){setBusy(false);throw error;}}} onDismiss={()=>window.qc.dismissPending(event.recordId!)}/></section>}{event?.stage==='failed'&&event.recordId&&<button className="retry-button" disabled={busy} onClick={()=>void retry(event.recordId!)}>重试这份报告</button>}</div></div></>}
 {page==='settings'&&info&&<Settings onChanged={reloadSettings} initial={settings} hasKey={info.hasKey} dataRoot={info.dataRoot} runtime={info.runtime} onError={setError} onSave={async value=>{await window.qc.saveSettings(value);setSettings(value);}}/>}
 {page==='history'&&<History onError={setError} onRetry={retry}/>}<footer className="app-footer">报告文字辅助质控 · 不自动修改或签发医院报告</footer></main></div>;
}
