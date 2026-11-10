import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync,copyFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('real_report_import_ocr_and_missing_key_failure_are_fully_recorded',async()=>{
 test.setTimeout(240000);
 const root=mkdtempSync(path.join(tmpdir(),'ultrasound-real-ocr-'));
 const sample=path.resolve('../0614报告截图/0614报告截图/介入、造影/1.png');
 const selected=path.join(root,'同名报告.png');copyFileSync(sample,selected);const originalBytes=readFileSync(selected);
 const env:Record<string,string>=Object.fromEntries(Object.entries({...process.env,QC_DATA_ROOT:root}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));delete env.ELECTRON_RUN_AS_NODE;
 const application=await electron.launch({args:['.'],env});
 try{
  await application.evaluate(({dialog},filename)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[filename]})) as any;},selected);
  const page=await application.firstWindow();
  await page.getByRole('button',{name:'导入图片',exact:true}).click();
  await expect(page.getByAltText('导入报告')).toBeVisible();
  await expect(page.getByRole('button',{name:/拍照并质控/})).toBeEnabled();
  writeFileSync(selected,'external file was overwritten after import');
  await page.getByRole('button',{name:/拍照并质控/}).click();
  await expect(page.getByText('请在设置中录入 DeepSeek API 密钥',{exact:true})).toBeVisible({timeout:180000});
  const records=await page.evaluate(()=>window.qc.listRecords());
  expect(records).toHaveLength(1);expect(records[0].status).toBe('failed');
  const record=await page.evaluate(id=>window.qc.getRecord(id),records[0].recordId);
  expect(record.ocr!.blocks.length).toBeGreaterThan(10);expect(record.attempts).toHaveLength(1);
  expect(record.attempts[0].result?.status).toBe('failed');
  expect(Object.keys(record.attempts[0].payload).sort()).toEqual(['conclusion','examination','findings','measurements']);
  expect(readFileSync(record.capture.originalPath).equals(originalBytes)).toBe(true);
  await page.getByRole('button',{name:'质控历史',exact:true}).click();
  await expect(page.locator('.record-item')).toHaveCount(1);
  await page.screenshot({path:'.runtime/screenshots/real-ocr-history.png',fullPage:true});
 }finally{await application.close();rmSync(root,{recursive:true,force:true});}
});
