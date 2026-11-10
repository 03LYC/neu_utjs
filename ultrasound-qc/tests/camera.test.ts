import {afterEach,describe,it,expect,vi} from 'vitest';
import {cameraErrorMessage,openCameraStream,selectedCameraMissing,stopCameraStream,waitForCameraPreview} from '../src/features/capture/camera';

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function media(){
 const tracks=[{stop:vi.fn()},{stop:vi.fn()}];
 return {stream:{getTracks:()=>tracks} as unknown as MediaStream,tracks};
}
function video(width=0,height=0,readyState=0){
 return Object.assign(new EventTarget(),{srcObject:null,videoWidth:width,videoHeight:height,readyState,play:vi.fn(async()=>{})}) as unknown as HTMLVideoElement;
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const failure=(name:string,constraint?:string)=>Object.assign(new Error('synthetic camera failure'),{name,...(constraint?{constraint}:{})});

describe('camera_stream_requests',()=>{
 it('opens_only_the_selected_device_with_moderate_video_preferences_and_no_audio',async()=>{
  const {stream}=media();const getUserMedia=vi.fn(async()=>stream);
  expect(await openCameraStream({getUserMedia},'rgb-selected')).toBe(stream);
  expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({video:{deviceId:{exact:'rgb-selected'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:15,max:30}},audio:false});
 });
 it.each(['OverconstrainedError','NotReadableError','AbortError'])('relaxes_parameters_on_%s_without_switching_cameras',async name=>{
  const {stream}=media();const getUserMedia=vi.fn().mockRejectedValueOnce(failure(name,'width')).mockResolvedValueOnce(stream);
  expect(await openCameraStream({getUserMedia},'rgb-selected')).toBe(stream);
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  expect(getUserMedia.mock.calls[1][0]).toEqual({video:{deviceId:{exact:'rgb-selected'}},audio:false});
 });
 it.each(['NotAllowedError','NotFoundError','SecurityError'])('does_not_retry_%s',async name=>{
  const error=failure(name);const getUserMedia=vi.fn().mockRejectedValue(error);
  await expect(openCameraStream({getUserMedia},'rgb-selected')).rejects.toBe(error);
  expect(getUserMedia).toHaveBeenCalledTimes(1);
 });
 it('does_not_retry_an_exact_device_id_constraint_failure',async()=>{
  const error=failure('OverconstrainedError','deviceId');const getUserMedia=vi.fn().mockRejectedValue(error);
  await expect(openCameraStream({getUserMedia},'stale-id')).rejects.toBe(error);
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  expect(cameraErrorMessage(error)).toContain('重新选择');
 });
 it('reports_the_fallback_error_and_makes_at_most_two_requests',async()=>{
  const finalError=failure('NotReadableError');const getUserMedia=vi.fn().mockRejectedValueOnce(failure('OverconstrainedError','width')).mockRejectedValue(finalError);
  await expect(openCameraStream({getUserMedia},'rgb-selected')).rejects.toBe(finalError);
  expect(getUserMedia).toHaveBeenCalledTimes(2);
 });
 it('cancels_a_pending_request_and_releases_every_track_if_it_resolves_late',async()=>{
  const pending=deferred<MediaStream>();const {stream,tracks}=media();const getUserMedia=vi.fn(()=>pending.promise);const controller=new AbortController();
  const opening=openCameraStream({getUserMedia},'rgb-selected',{signal:controller.signal});
  const rejected=expect(opening).rejects.toMatchObject({name:'AbortError'});
  await Promise.resolve();controller.abort();await rejected;
  pending.resolve(stream);await Promise.resolve();await Promise.resolve();
  for(const track of tracks)expect(track.stop).toHaveBeenCalled();
  expect(getUserMedia).toHaveBeenCalledTimes(1);
 });
 it('does_not_start_a_request_when_cancelled_before_opening',async()=>{
  const controller=new AbortController();controller.abort();const getUserMedia=vi.fn();
  await expect(openCameraStream({getUserMedia},'rgb-selected',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(getUserMedia).not.toHaveBeenCalled();
 });
 it('times_out_a_stalled_request_and_stops_its_late_stream_without_retry',async()=>{
  vi.useFakeTimers();const pending=deferred<MediaStream>();const {stream,tracks}=media();const getUserMedia=vi.fn(()=>pending.promise);
  const opening=openCameraStream({getUserMedia},'rgb-selected',{timeoutMs:100});
  const rejected=expect(opening).rejects.toMatchObject({name:'TimeoutError'});
  await vi.advanceTimersByTimeAsync(100);await rejected;
  pending.resolve(stream);await Promise.resolve();await Promise.resolve();
  for(const track of tracks)expect(track.stop).toHaveBeenCalled();
  expect(getUserMedia).toHaveBeenCalledTimes(1);
 });
});

describe('camera_preview_readiness',()=>{
 it('requires_playback_and_a_nonzero_frame_with_current_data',async()=>{
  const frame=video();const {stream,tracks}=media();const ready=waitForCameraPreview(frame,stream);
  await Promise.resolve();
  Object.assign(frame,{videoWidth:1280,videoHeight:800,readyState:2});frame.dispatchEvent(new Event('loadeddata'));
  await ready;expect(frame.srcObject).toBe(stream);
  for(const track of tracks)expect(track.stop).not.toHaveBeenCalled();
 });
 it.each([[0,0,4],[1280,800,1]])('does_not_accept_missing_or_undecoded_frames_%j',async(width,height,state)=>{
  vi.useFakeTimers();const frame=video(width,height,state);const {stream,tracks}=media();
  const rejected=expect(waitForCameraPreview(frame,stream,{timeoutMs:100})).rejects.toMatchObject({name:'TimeoutError'});
  await vi.advanceTimersByTimeAsync(100);await rejected;
  expect(frame.srcObject).toBeNull();for(const track of tracks)expect(track.stop).toHaveBeenCalled();
 });
 it('bounds_a_play_promise_that_never_resolves_and_ignores_its_late_success',async()=>{
  vi.useFakeTimers();const frame=video(1280,800,4);const play=deferred<void>();frame.play=vi.fn(()=>play.promise);const {stream,tracks}=media();
  const rejected=expect(waitForCameraPreview(frame,stream,{timeoutMs:100})).rejects.toMatchObject({name:'TimeoutError'});
  await vi.advanceTimersByTimeAsync(100);await rejected;play.resolve();await Promise.resolve();
  expect(frame.srcObject).toBeNull();for(const track of tracks)expect(track.stop).toHaveBeenCalled();
 });
 it('releases_all_tracks_if_playback_fails',async()=>{
  const frame=video();frame.play=vi.fn().mockRejectedValue(failure('NotReadableError'));const {stream,tracks}=media();
  await expect(waitForCameraPreview(frame,stream)).rejects.toMatchObject({name:'NotReadableError'});
  expect(frame.srcObject).toBeNull();for(const track of tracks)expect(track.stop).toHaveBeenCalled();
 });
 it('cancels_an_old_preview_without_clearing_or_stopping_a_newer_stream',async()=>{
  const frame=video();const old=media(),current=media();const controller=new AbortController();
  const rejected=expect(waitForCameraPreview(frame,old.stream,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  frame.srcObject=current.stream;controller.abort();await rejected;
  expect(frame.srcObject).toBe(current.stream);
  for(const track of old.tracks)expect(track.stop).toHaveBeenCalled();
  for(const track of current.tracks)expect(track.stop).not.toHaveBeenCalled();
 });
});

describe('camera_selection_and_diagnostics',()=>{
 it('marks_a_saved_missing_device_without_substituting_the_default_or_depth_stream',()=>{
  const devices=[{deviceId:'depth-device',kind:'videoinput' as const},{deviceId:'rgb-device',kind:'videoinput' as const}];
  expect(selectedCameraMissing('old-device',devices)).toBe(true);
  expect(selectedCameraMissing('rgb-device',devices)).toBe(false);
  expect(selectedCameraMissing('',devices)).toBe(false);
 });
 it.each([
  ['NotAllowedError','访问被拒绝'],['NotFoundError','重新选择'],['OverconstrainedError','采集参数'],
  ['NotReadableError','其他程序占用'],['AbortError','启动被中断'],['TimeoutError','启动超时'],
 ])('distinguishes_%s_in_the_visible_message', (name,message)=>expect(cameraErrorMessage(failure(name))).toContain(message));
 it('continues_releasing_tracks_when_one_stop_throws',()=>{
  const broken={stop:vi.fn(()=>{throw new Error('synthetic stop failure');})},other={stop:vi.fn()};
  stopCameraStream({getTracks:()=>[broken,other]} as unknown as MediaStream);
  expect(other.stop).toHaveBeenCalledTimes(1);
 });
});
