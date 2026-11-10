import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('camera_capture_submits_image_and_roi_through_the_safe_bridge',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'ultrasound-camera-submit-'));
 const env=Object.fromEntries(Object.entries({...process.env,QC_DATA_ROOT:root}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
 delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:['.','--use-fake-device-for-media-stream'],env});
 try{
  const page=await app.firstWindow();
  await app.evaluate(({ipcMain,BrowserWindow,nativeImage})=>{
   ipcMain.removeHandler('capture:submit');
   ipcMain.handle('capture:submit',(_event,input)=>{
    const image=nativeImage.createFromDataURL(input.dataUrl);
    (globalThis as any).cameraSubmission={size:image.getSize(),roi:input.roi,hasFileToken:!!input.fileToken};
    setTimeout(()=>BrowserWindow.getAllWindows()[0].webContents.send('task:event',{recordId:'synthetic-camera',stage:'failed',message:'合成测试：仅验证拍照提交，不调用模型'}),10);
    return {recordId:'synthetic-camera'};
   });
  });
  await page.getByRole('button',{name:'打开摄像头',exact:true}).click();
  await expect(page.getByText('摄像头已连接',{exact:true})).toBeVisible();
  const box=(await page.locator('.camera-preview').boundingBox())!;
  await page.getByRole('button',{name:'框选报告区域',exact:true}).click();
  await page.mouse.move(box.x+box.width*.1,box.y+box.height*.15);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.9,box.y+box.height*.85);await page.mouse.up();
  await page.getByRole('button',{name:/拍照并质控/}).click();
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).cameraSubmission?.size.width)).toBeGreaterThan(0);
  const submitted=await app.evaluate(()=>(globalThis as any).cameraSubmission);
  expect(submitted.size.height).toBeGreaterThan(0);expect(submitted.hasFileToken).toBe(false);
  expect(submitted.roi.width).toBeGreaterThan(0);expect(submitted.roi.width).toBeLessThan(1);
  await expect(page.getByRole('heading',{name:'本次质控未完成',exact:true})).toBeVisible();
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
