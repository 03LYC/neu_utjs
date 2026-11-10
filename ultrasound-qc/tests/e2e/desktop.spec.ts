import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
let application:ElectronApplication,page:Page,root:string;
test.beforeAll(async()=>{
 root=mkdtempSync(path.join(tmpdir(),'ultrasound-ui-'));
 execFileSync(path.resolve('.venv/Scripts/python.exe'),['scripts/seed-test-data.py',root],{cwd:process.cwd(),windowsHide:true});
 const env:Record<string,string>=Object.fromEntries(Object.entries({...process.env,QC_DATA_ROOT:root}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));delete env.ELECTRON_RUN_AS_NODE;
 application=await electron.launch({args:['.','--use-fake-device-for-media-stream'],env});
 page=await application.firstWindow();
});
test.afterAll(async()=>{await application?.close();if(root)rmSync(root,{recursive:true,force:true});});
test('independent_window_and_safe_bridge',async()=>{
 await expect(page.getByRole('heading',{name:'超声报告质控',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>typeof (window as any).require)).toBe('undefined');
 const settings=await page.evaluate(()=>window.qc.getSettings());
 expect(settings).not.toHaveProperty('key');expect(settings.testMode).toBe(true);
 const preferences=await application.evaluate(({BrowserWindow})=>(BrowserWindow.getAllWindows()[0].webContents as any).getLastWebPreferences());
 expect(preferences.contextIsolation).toBe(true);expect(preferences.sandbox).toBe(true);expect(preferences.nodeIntegration).toBe(false);
});
test('failed_review_never_shows_waiting_or_passed_placeholder',async()=>{
 await application.evaluate(({BrowserWindow})=>{
  BrowserWindow.getAllWindows()[0].webContents.send('task:event',{stage:'failed',message:'合成测试：模型输出被截断，未放行'});
 });
 await expect(page.getByRole('heading',{name:'本次质控未完成',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'等待报告质控',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'本次未发现文字质量问题',exact:true})).toHaveCount(0);
});
test('imports_images_from_nested_chinese_and_space_folders',async()=>{
 for(const relative of ['外部 数据/腹部浅表/报告 01.png','另一个目录/介入、造影/报告#02.PNG']){
  const filename=path.join(root,'sources',relative);
  mkdirSync(path.dirname(filename),{recursive:true});copyFileSync(path.join(root,'合成测试报告.png'),filename);
  await application.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},filename);
  await page.getByRole('button',{name:'导入图片',exact:true}).click();
  await expect(page.getByAltText('导入报告')).toBeVisible();
  await expect(page.getByRole('button',{name:/拍照并质控/})).toBeEnabled();
 }
});
test('camera_preview_and_roi_controls',async()=>{
 await page.getByRole('button',{name:'打开摄像头',exact:true}).click();
 await expect(page.getByText('摄像头已连接',{exact:true})).toBeVisible();
 const frame=page.locator('.camera-preview');const box=(await frame.boundingBox())!;
 await page.getByRole('button',{name:'框选报告区域',exact:true}).click();
 await page.mouse.move(box.x+box.width*.2,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.7);await page.mouse.up();
 await expect(page.locator('.roi-box')).toBeVisible();
 await page.getByRole('button',{name:'关闭摄像头',exact:true}).click();
});
test('camera_refresh_failure_keeps_a_working_preview_open',async()=>{
 await page.evaluate(()=>{
  (window as any).savedEnumerateDevices=navigator.mediaDevices.enumerateDevices;
  navigator.mediaDevices.enumerateDevices=()=>Promise.reject(new DOMException('synthetic enumeration failure','NotReadableError'));
 });
 try{
  await page.getByRole('button',{name:'打开摄像头',exact:true}).click();
  await expect(page.getByText('摄像头已连接',{exact:true})).toBeVisible();
  await expect(page.locator('.capture-button')).toBeEnabled();
  expect(await page.evaluate(()=>(document.querySelector('video')!.srcObject as MediaStream).getVideoTracks()[0].readyState)).toBe('live');
 }finally{
  const close=page.getByRole('button',{name:'关闭摄像头',exact:true});if(await close.isVisible())await close.click();
  await page.evaluate(()=>{navigator.mediaDevices.enumerateDevices=(window as any).savedEnumerateDevices;delete (window as any).savedEnumerateDevices;});
 }
});
test('camera_constraint_retry_keeps_the_explicit_device_selection',async()=>{
 const camera=page.getByLabel('摄像头',{exact:true});
 const deviceId=await camera.locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value).find(Boolean));
 expect(deviceId).toBeTruthy();await camera.selectOption(deviceId!);
 await page.evaluate(()=>{
  const original=navigator.mediaDevices.getUserMedia;
  (window as any).savedGetUserMedia=original;(window as any).cameraRequests=[];
  navigator.mediaDevices.getUserMedia=constraints=>{
   const requests=(window as any).cameraRequests;requests.push(constraints);
   if(requests.length===1)return Promise.reject(Object.assign(new DOMException('synthetic size failure','OverconstrainedError'),{constraint:'width'}));
   return original.call(navigator.mediaDevices,constraints);
  };
 });
 try{
  await page.getByRole('button',{name:'打开摄像头',exact:true}).click();
  await expect(page.getByText('摄像头已连接',{exact:true})).toBeVisible();
  const requests=await page.evaluate(()=>(window as any).cameraRequests);
  expect(requests).toHaveLength(2);
  expect(requests[0].video.deviceId.exact).toBe(deviceId);
  expect(requests[1]).toEqual({video:{deviceId:{exact:deviceId}},audio:false});
 }finally{
  const close=page.getByRole('button',{name:'关闭摄像头',exact:true});if(await close.isVisible())await close.click();
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=(window as any).savedGetUserMedia;delete (window as any).savedGetUserMedia;delete (window as any).cameraRequests;});
 }
});
test('missing_saved_camera_requires_reselection_instead_of_using_the_default',async()=>{
 const previous=await page.evaluate(async()=>(await window.qc.getSettings()).settings);
 try{
  await page.evaluate(settings=>window.qc.saveSettings({...settings,cameraId:'synthetic-disconnected-camera'}),previous);
  await page.reload();
  await expect(page.getByText('已保存的摄像头已断开或设备标识已变化，请在列表中重新选择；不会自动切换到其他摄像头。',{exact:true})).toBeVisible();
  await expect(page.getByLabel('摄像头',{exact:true})).toHaveValue('synthetic-disconnected-camera');
  await expect(page.getByRole('button',{name:'打开摄像头',exact:true})).toBeDisabled();
  await page.getByLabel('摄像头',{exact:true}).selectOption('');
  await expect(page.getByRole('button',{name:'打开摄像头',exact:true})).toBeEnabled();
 }finally{
  await page.evaluate(settings=>window.qc.saveSettings(settings),previous);await page.reload();
  await expect(page.getByRole('heading',{name:'超声报告质控',exact:true})).toBeVisible();
 }
});
test('camera_resolution_change_invalidates_roi',async()=>{
 await page.getByRole('button',{name:'打开摄像头',exact:true}).click();
 try{
  await expect(page.getByText('摄像头已连接',{exact:true})).toBeVisible();
  const box=(await page.locator('.camera-preview').boundingBox())!;
  await page.getByRole('button',{name:'框选报告区域',exact:true}).click();
  await page.mouse.move(box.x+box.width*.2,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.7);await page.mouse.up();
  await expect(page.locator('.roi-box')).toBeVisible();
  await page.evaluate(()=>{const video=document.querySelector('video')!;Object.defineProperty(video,'videoWidth',{configurable:true,value:video.videoWidth+100});video.dispatchEvent(new Event('resize'));});
  await expect(page.locator('.roi-box')).toHaveCount(0);
 }finally{await page.getByRole('button',{name:'关闭摄像头',exact:true}).click();}
});
test('camera_disconnect_prevents_capturing_frozen_frame',async()=>{
 await page.getByRole('button',{name:'打开摄像头',exact:true}).click();
 try{
  await expect(page.getByText('摄像头已连接',{exact:true})).toBeVisible();
  await page.evaluate(()=>{const stream=document.querySelector('video')!.srcObject as MediaStream;stream.getVideoTracks()[0].dispatchEvent(new Event('ended'));});
  await expect(page.locator('.capture-button')).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('摄像头连接已中断');
 }finally{const close=page.getByRole('button',{name:'关闭摄像头',exact:true});if(await close.isVisible())await close.click();}
});
test('selected_camera_is_kept_when_returning_from_history',async()=>{
 const camera=page.getByLabel('摄像头',{exact:true});
 await page.getByRole('button',{name:'打开摄像头',exact:true}).click();
 await expect(page.getByText('摄像头已连接',{exact:true})).toBeVisible();
 await expect.poll(()=>camera.locator('option').count()).toBeGreaterThan(1);
 await page.getByRole('button',{name:'关闭摄像头',exact:true}).click();
 const deviceId=await camera.locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value).find(Boolean));
 expect(deviceId).toBeTruthy();await camera.selectOption(deviceId!);
 await expect.poll(()=>page.evaluate(async()=>(await window.qc.getSettings()).settings.cameraId)).toBe(deviceId);
 await page.getByRole('button',{name:'质控历史',exact:true}).click();
 await page.getByRole('button',{name:'报告质控',exact:true}).click();
 await expect(page.getByLabel('摄像头',{exact:true})).toHaveValue(deviceId!);
});
test('encrypted_key_settings_never_return_plaintext',async()=>{
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.locator('input[type=password]').fill('synthetic-e2e-key-only');
 await page.getByRole('button',{name:'保存设置',exact:true}).click();
 await expect(page.locator('input[type=password]')).toHaveValue('');
 await expect(page.getByText('API 已配置',{exact:true})).toBeVisible();
 const info=await page.evaluate(()=>window.qc.getSettings());expect(info.hasKey).toBe(true);expect(JSON.stringify(info)).not.toContain('synthetic-e2e-key-only');
 const keyfile=path.join(root,'api-key.enc');if(existsSync(keyfile))expect(readFileSync(keyfile,'utf8')).not.toContain('synthetic-e2e-key-only');
 await page.getByRole('button',{name:'清除密钥',exact:true}).click();
 await expect(page.getByText('已清除本机密钥',{exact:true})).toBeVisible();
});
test('history_loads_original_ocr_payload_and_result',async()=>{
 await page.getByRole('button',{name:'质控历史',exact:true}).click();
 await expect(page.locator('.record-item')).toHaveCount(1);
 await page.locator('.record-item').click();
 await expect(page.getByText('合成测试：未发现问题',{exact:true})).toBeVisible();
 await expect(page.getByAltText('历史报告原图')).toBeVisible();
 await page.getByText('原始 OCR 与实际发送内容',{exact:true}).click();
 await expect(page.getByText('synthetic-test',{exact:false})).toBeVisible();
 await page.screenshot({path:'test-results/desktop-history.png',fullPage:true});
});
test('issue_event_rings_once_and_locates_original_text',async()=>{
 await page.getByRole('button',{name:'报告质控',exact:true}).click();
 await page.evaluate(()=>{
  (window as any).toneStarts=0;
  (window as any).AudioContext=class{currentTime=0;destination={};createOscillator(){return {connect(){},frequency:{value:0},start(){(window as any).toneStarts++;},stop(){},onended:null};}createGain(){return {connect(){},gain:{setValueAtTime(){}}};}resume(){return Promise.resolve();}close(){return Promise.resolve();}};
 });
 await application.evaluate(({BrowserWindow})=>{
  const event={recordId:'synthetic',attemptId:'synthetic-issue-attempt',stage:'done',document:{width:100,height:100,warnings:[],blocks:[{sourceId:'b1',text:'由肾轮廓清晰',kind:'paragraph',bbox:[0,0,100,20]}]},result:{status:'issues_found',summary:'合成测试：文字错误',issues:[{category:'typo',severity:'warning',sourceIds:['b1'],quote:'由肾',reason:'合成错字示例',suggestion:'右肾',requiresReview:false}]}};
  BrowserWindow.getAllWindows()[0].webContents.send('task:event',event);
  BrowserWindow.getAllWindows()[0].webContents.send('task:event',event);
 });
 await expect(page.getByText('合成测试：文字错误',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).toneStarts)).toBe(1);
 await page.locator('.quote').click();await expect(page.locator('.source-block.highlight')).toContainText('由肾轮廓清晰');
});
test('missing_ocr_paragraph_can_be_added_without_overwriting_original',async()=>{
 const record=(await page.evaluate(()=>window.qc.listRecords()))[0];
 const original=await page.evaluate(id=>window.qc.getRecord(id),record.recordId);
 await application.evaluate(({BrowserWindow,ipcMain},{recordId,document})=>{
  ipcMain.removeHandler('task:retry');
  ipcMain.handle('task:retry',(_event,id,draft)=>{(globalThis as any).revisedDocument={id,draft};});
  BrowserWindow.getAllWindows()[0].webContents.send('task:event',{recordId,stage:'done',document,result:{status:'needs_review',summary:'合成测试：补录漏识别内容',issues:[]}});
 },{recordId:record.recordId,document:original.ocr});
 await page.getByRole('button',{name:/^识别文字/}).click();
 await page.getByRole('button',{name:'编辑识别文字',exact:true}).click();
 await page.getByRole('button',{name:'新增文本段落',exact:true}).click();
 await page.getByRole('textbox',{name:/编辑 manual-/}).fill('超声提示：补录的合成测试结论');
 await page.getByRole('button',{name:'使用修订文字重新质控',exact:true}).click();
 await expect.poll(()=>application.evaluate(()=>(globalThis as any).revisedDocument?.draft.blocks.at(-1).text)).toBe('超声提示：补录的合成测试结论');
 const unchanged=await page.evaluate(id=>window.qc.getRecord(id),record.recordId);
 expect(unchanged.ocr).toEqual(original.ocr);
});
