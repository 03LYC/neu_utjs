type CameraOptions={signal?:AbortSignal;timeoutMs?:number};
type CameraDevice=Pick<MediaDeviceInfo,'deviceId'|'kind'>;
const retryableErrors=new Set(['OverconstrainedError','ConstraintNotSatisfiedError','NotReadableError','TrackStartError','AbortError']);
const errorName=(error:unknown)=>error&&typeof error==='object'&&'name' in error?String(error.name):'';
const errorConstraint=(error:unknown)=>error&&typeof error==='object'&&'constraint' in error?String(error.constraint):'';
const cancelled=()=>new DOMException('摄像头连接已取消','AbortError');
const timedOut=()=>new DOMException('摄像头启动超时','TimeoutError');

export function stopCameraStream(stream:MediaStream|null|undefined){
 for(const track of stream?.getTracks()||[]){try{track.stop();}catch{/* Continue releasing the other tracks. */}}
}

export function selectedCameraMissing(deviceId:string,devices:readonly CameraDevice[]):boolean{
 return !!deviceId&&!devices.some(device=>device.kind==='videoinput'&&device.deviceId===deviceId);
}

function requestStream(devices:Pick<MediaDevices,'getUserMedia'>,constraints:MediaStreamConstraints,{signal,timeoutMs=15000}:CameraOptions):Promise<MediaStream>{
 if(signal?.aborted)return Promise.reject(cancelled());
 return new Promise((resolve,reject)=>{
  let pending=true;
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const fail=(error:unknown)=>{if(!pending)return;pending=false;cleanup();reject(error);};
  const abort=()=>fail(cancelled());
  const timer=setTimeout(()=>fail(timedOut()),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{if(signal?.aborted)throw cancelled();return devices.getUserMedia(constraints);}).then(stream=>{
   if(!pending||signal?.aborted){stopCameraStream(stream);return;}
   pending=false;cleanup();resolve(stream);
  },fail);
 });
}

export async function openCameraStream(devices:Pick<MediaDevices,'getUserMedia'>,deviceId:string,options:CameraOptions={}):Promise<MediaStream>{
 const selected=deviceId?{deviceId:{exact:deviceId}}:{};
 try{
  return await requestStream(devices,{video:{...selected,width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:15,max:30}},audio:false},options);
 }catch(error){
  if(options.signal?.aborted||errorConstraint(error)==='deviceId'||!retryableErrors.has(errorName(error)))throw error;
  // Keep the selected device. Only relax its capture parameters, never switch cameras.
  return requestStream(devices,{video:deviceId?selected:true,audio:false},options);
 }
}

export function waitForCameraPreview(video:HTMLVideoElement,stream:MediaStream,{signal,timeoutMs=10000}:CameraOptions={}):Promise<void>{
 return new Promise((resolve,reject)=>{
  let pending=true,played=false;
  const events=['loadeddata','canplay','playing','resize','loadedmetadata'];
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);for(const event of events)video.removeEventListener(event,check);};
  const fail=(error:unknown)=>{
   if(!pending)return;pending=false;cleanup();stopCameraStream(stream);
   if(video.srcObject===stream)video.srcObject=null;
   reject(error);
  };
  const check=()=>{if(pending&&played&&video.videoWidth>0&&video.videoHeight>0&&video.readyState>=2){pending=false;cleanup();resolve();}};
  const abort=()=>fail(cancelled());
  const timer=setTimeout(()=>fail(timedOut()),timeoutMs);
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  for(const event of events)video.addEventListener(event,check);
  try{
   video.srcObject=stream;
   Promise.resolve(video.play()).then(()=>{played=true;check();},fail);
  }catch(error){fail(error);}
 });
}

export function cameraErrorMessage(error:unknown):string{
 if(errorConstraint(error)==='deviceId')return '未找到所选摄像头，设备可能已断开，请重新连接并在列表中重新选择';
 switch(errorName(error)){
  case 'NotAllowedError':case 'PermissionDeniedError':case 'SecurityError':return '摄像头访问被拒绝，请检查 Windows 摄像头隐私权限及应用访问授权';
  case 'NotFoundError':case 'DevicesNotFoundError':return '未找到所选摄像头，设备可能已断开，请重新连接并在列表中重新选择';
  case 'OverconstrainedError':case 'ConstraintNotSatisfiedError':return '所选摄像头不支持当前采集参数，请检查设备选择及驱动后重试';
  case 'NotReadableError':case 'TrackStartError':return '无法读取所选摄像头画面，请检查其他程序占用、原装数据线、USB 3 接口及驱动';
  case 'AbortError':return '摄像头启动被中断，请检查设备连接、原装数据线、USB 3 接口及其他程序占用';
  case 'TimeoutError':return '摄像头启动超时，尚未取得可用画面，请检查原装数据线、USB 3 接口及设备占用后重试';
  default:return '无法打开所选摄像头，请检查设备选择、连接、Windows 摄像头权限及驱动';
 }
}
