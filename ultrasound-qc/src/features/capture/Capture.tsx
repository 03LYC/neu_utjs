import {useState,useRef,useEffect} from 'react';
import type {ROI,Settings} from '../../../shared/contracts';
import {mapPreviewROI,shouldCaptureShortcut} from './geometry';
import {cameraErrorMessage,openCameraStream,selectedCameraMissing,stopCameraStream,waitForCameraPreview} from './camera';
type Props={busy:boolean;settings:Settings;onCapture:(input:{dataUrl:string;fileToken?:string;roi:ROI|null})=>Promise<void>;onCameraChange:(deviceId:string)=>Promise<void>;onError:(message:string)=>void};
export default function Capture({busy,settings,onCapture,onCameraChange,onError}:Props){
 const [devices,setDevices]=useState<MediaDeviceInfo[]>([]),[devicesLoaded,setDevicesLoaded]=useState(false),[deviceId,setDeviceId]=useState(settings.cameraId);
 const [running,setRunning]=useState(false),[connecting,setConnecting]=useState(false),[cameraReady,setCameraReady]=useState(false);
 const [imported,setImported]=useState<{dataUrl:string;fileToken:string}|null>(null);
 const [roi,setROI]=useState<ROI|null>(null),[selecting,setSelecting]=useState(false);
 const [needsRegionConfirmation,setNeedsRegionConfirmation]=useState(false);
 const [drag,setDrag]=useState<ROI|null>(null),[size,setSize]=useState({width:0,height:0}),[hostSize,setHostSize]=useState({width:1,height:1});
 const video=useRef<HTMLVideoElement>(null),host=useRef<HTMLDivElement>(null),stream=useRef<MediaStream|null>(null),start=useRef<{x:number;y:number}|null>(null);
 const actionRef=useRef<()=>void>(()=>{});
 const videoSize=useRef({width:0,height:0});
 useEffect(()=>setDeviceId(settings.cameraId),[settings.cameraId]);
 useEffect(()=>{let active=true;const refresh=()=>{void navigator.mediaDevices.enumerateDevices().then(items=>{if(active){setDevices(items.filter(d=>d.kind==='videoinput'));setDevicesLoaded(true);}}).catch(()=>{});};refresh();navigator.mediaDevices.addEventListener('devicechange',refresh);return ()=>{active=false;navigator.mediaDevices.removeEventListener('devicechange',refresh);};},[]);
 useEffect(()=>{const element=host.current;if(!element)return;const observer=new ResizeObserver(()=>setHostSize({width:element.clientWidth,height:element.clientHeight}));observer.observe(element);return ()=>observer.disconnect();},[]);
 useEffect(()=>{
  let cancelled=false,ownedStream:MediaStream|null=null;
  const abort=new AbortController(),frame=video.current;
  let track:MediaStreamTrack|undefined;
  const release=()=>{const media=ownedStream;stopCameraStream(media);if(stream.current===media)stream.current=null;if(frame?.srcObject===media)frame.srcObject=null;ownedStream=null;};
  const ended=()=>{if(cancelled||stream.current!==ownedStream)return;setCameraReady(false);setConnecting(false);setRunning(false);setROI(null);setSelecting(false);start.current=null;setDrag(null);if(frame)frame.srcObject=null;onError('摄像头连接已中断，请重新连接后再拍照');};
  setConnecting(running);setCameraReady(false);setROI(null);setSelecting(false);start.current=null;setDrag(null);setSize({width:0,height:0});videoSize.current={width:0,height:0};
  if(!running)setNeedsRegionConfirmation(false);
  if(running){
   setImported(null);
   openCameraStream(navigator.mediaDevices,deviceId,{signal:abort.signal}).then(async media=>{
    if(cancelled){stopCameraStream(media);return;}
    ownedStream=media;stream.current=media;track=media.getVideoTracks()[0];
    if(!track||!frame)throw new DOMException('摄像头没有可用视频轨道','NotReadableError');
    track.addEventListener('ended',ended,{once:true});
    await waitForCameraPreview(frame,media,{signal:abort.signal});
    if(cancelled)return;
    if(track.readyState!=='live')throw new DOMException('摄像头视频轨道已停止','NotReadableError');
    videoSize.current={width:frame.videoWidth,height:frame.videoHeight};setSize(videoSize.current);setCameraReady(true);setConnecting(false);
    // A failed device-list refresh must not close an otherwise working stream.
    void navigator.mediaDevices.enumerateDevices().then(list=>{if(!cancelled){setDevices(list.filter(d=>d.kind==='videoinput'));setDevicesLoaded(true);}}).catch(()=>{});
   }).catch(error=>{release();if(!cancelled&&!abort.signal.aborted){setConnecting(false);setRunning(false);onError(cameraErrorMessage(error));}});
  }
  return ()=>{cancelled=true;abort.abort();track?.removeEventListener('ended',ended);release();};
 },[running,deviceId]);
 async function capture(){
  if(busy)return;
  try{
   if(imported){await onCapture({...imported,roi});return;}
   const frame=video.current;const track=stream.current?.getVideoTracks()[0];if(!cameraReady||!frame?.videoWidth||track?.readyState!=='live'||track.muted||frame.readyState<2)throw new Error('摄像头当前没有可用画面，请检查连接后重新拍照');
   if(needsRegionConfirmation)throw new Error('请先重新框选报告区域或确认全画面');
   if(frame.videoWidth!==size.width||frame.videoHeight!==size.height){updateVideoDimensions();throw new Error('摄像头分辨率已变化，请重新确认报告区域');}
   const canvas=document.createElement('canvas');canvas.width=frame.videoWidth;canvas.height=frame.videoHeight;canvas.getContext('2d')!.drawImage(frame,0,0);
   await onCapture({dataUrl:canvas.toDataURL('image/png'),roi});
  }catch(error){onError((error as Error).message);}
 }
 actionRef.current=()=>{void capture();};
 useEffect(()=>{const listener=(event:KeyboardEvent)=>{const target=event.target as HTMLElement;if(shouldCaptureShortcut(event,target?.tagName||'',target?.isContentEditable||false)){event.preventDefault();actionRef.current();}};window.addEventListener('keydown',listener);return ()=>window.removeEventListener('keydown',listener);},[]);
 async function importImage(){try{const value=await window.qc.importImage();if(value){setRunning(false);setImported(value);setROI(null);setNeedsRegionConfirmation(false);}}catch(error){onError((error as Error).message);}}
 function updateVideoDimensions(){const frame=video.current;if(!frame?.videoWidth||!frame.videoHeight)return;const next={width:frame.videoWidth,height:frame.videoHeight};if(videoSize.current.width&&(videoSize.current.width!==next.width||videoSize.current.height!==next.height)){setROI(null);setSelecting(false);start.current=null;setDrag(null);setNeedsRegionConfirmation(true);}videoSize.current=next;setSize(next);}
 function point(event:React.PointerEvent){const rect=host.current!.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
 const scale=size.width?Math.min(hostSize.width/size.width,hostSize.height/size.height):1;
 const visible={width:size.width*scale,height:size.height*scale};
 const roiStyle=roi?{left:(hostSize.width-visible.width)/2+roi.x*visible.width,top:(hostSize.height-visible.height)/2+roi.y*visible.height,width:roi.width*visible.width,height:roi.height*visible.height}:undefined;
 const missingSelection=devicesLoaded&&selectedCameraMissing(deviceId,devices);
 return <section className="panel capture-panel">
  <div className="panel-title"><div><span className="eyebrow">CAPTURE</span><h2>报告采集</h2></div><span className={'tag '+(cameraReady?'green':'')}>{connecting?'正在连接':cameraReady?'摄像头已连接':imported?'图片模式':'等待输入'}</span></div>
  <div className="camera-tools"><select aria-label="摄像头" value={deviceId} onChange={e=>{const id=e.target.value;setDeviceId(id);setROI(null);if(running)setNeedsRegionConfirmation(true);void onCameraChange(id).catch(error=>onError(error.message));}} disabled={busy}><option value="">默认摄像头</option>{missingSelection&&<option value={deviceId}>已断开的摄像头（请重新选择）</option>}{devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`摄像头 ${i+1}`}</option>)}</select><button onClick={()=>setRunning(!running)} disabled={busy||(!running&&missingSelection)}>{running?(connecting?'取消连接':'关闭摄像头'):'打开摄像头'}</button><button onClick={importImage} disabled={busy}>导入图片</button></div>
  {missingSelection&&<div className="notice">已保存的摄像头已断开或设备标识已变化，请在列表中重新选择；不会自动切换到其他摄像头。</div>}
  <div ref={host} className={'camera-preview '+(selecting?'selecting':'')} onPointerDown={e=>{if(!selecting||!size.width)return;const p=point(e);start.current=p;setDrag({...p,width:0,height:0});e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!start.current)return;const p=point(e);setDrag({x:Math.min(start.current.x,p.x),y:Math.min(start.current.y,p.y),width:Math.abs(p.x-start.current.x),height:Math.abs(p.y-start.current.y)});}} onPointerUp={e=>{if(!start.current)return;const p=point(e);const rect={x:Math.min(start.current.x,p.x),y:Math.min(start.current.y,p.y),width:Math.abs(p.x-start.current.x),height:Math.abs(p.y-start.current.y)};start.current=null;setDrag(null);try{setROI(mapPreviewROI(rect,hostSize,size));setSelecting(false);setNeedsRegionConfirmation(false);}catch(error){onError((error as Error).message);}}}>
   <video ref={video} muted playsInline style={{display:running?'block':'none'}} onLoadedMetadata={updateVideoDimensions} onResize={updateVideoDimensions}/>
   {imported&&<img draggable={false} src={imported.dataUrl} alt="导入报告" onLoad={e=>setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}/>}
   {!running&&!imported&&<div className="empty-camera"><div className="camera-symbol">▣</div><h3>将完整报告置于画面内</h3><p>打开摄像头，或导入一张报告图片</p><small>请确保检查部位、所见、测量表和结论完整可见</small></div>}
   {roiStyle&&!drag&&<div className="roi-box" style={roiStyle}><span>报告识别区域</span></div>}
   {drag&&<div className="roi-box" style={{left:drag.x,top:drag.y,width:drag.width,height:drag.height}}/>}
   {selecting&&<div className="selection-hint">拖动框选完整报告区域</div>}
  </div>
  {needsRegionConfirmation&&<div className="notice">摄像头设备或分辨率已变化，请重新框选报告区域或确认全画面。</div>}<div className="capture-footer"><div><button disabled={busy||!size.width} onClick={()=>setSelecting(!selecting)}>{selecting?'取消框选':'框选报告区域'}</button><button className="link-button" disabled={busy||(!roi&&!needsRegionConfirmation)} onClick={()=>{setROI(null);setSelecting(false);setNeedsRegionConfirmation(false);}}>{needsRegionConfirmation?'确认全画面':'重置'}</button></div><span>{size.width?`${size.width} × ${size.height}`:'—'} {roi?' · 已框选':' · 全画面'}</span></div>
  <button className="primary capture-button" disabled={busy||needsRegionConfirmation||(!cameraReady&&!imported)} onClick={()=>void capture()}>{busy?'正在处理报告…':'拍照并质控'}<kbd>Ctrl Shift Q</kbd></button>
  <p className="footnote">原始照片完整留在本机，模型仅接收筛选后的报告文字。</p>
 </section>;
}
