import {_electron as electron} from 'playwright';
import path from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k!=='ELECTRON_RUN_AS_NODE'&&k!=='QC_DATA_ROOT'&&typeof v==='string'));
const application=await electron.launch({executablePath:path.resolve('dist/win-unpacked/UltrasoundQC.exe'),args:[],env});
try{
 const page=await application.firstWindow();
 await page.getByRole('heading',{name:'超声报告质控',exact:true}).waitFor();
 const info=await page.evaluate(()=>window.qc.getSettings());
 const records=await page.evaluate(()=>window.qc.listRecords());
 mkdirSync('.runtime/screenshots',{recursive:true});
 await page.screenshot({path:'.runtime/screenshots/packaged-capture.png',fullPage:true});
 const result={packagedWindowOpened:true,backendResponded:true,records:records.length,hasKey:info.hasKey,model:info.settings.model,dataRoot:info.dataRoot};
 if(process.argv.includes('--camera')){
  result.camera=await page.evaluate(async()=>{
   try{const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});const tracks=stream.getVideoTracks();const metadata=tracks.map(track=>({label:track.label,width:track.getSettings().width,height:track.getSettings().height}));stream.getTracks().forEach(track=>track.stop());return {opened:true,devices:metadata};}
   catch(error){return {opened:false,error:error.name};}
  });
 }
 writeFileSync('.runtime/package-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await application.close();}
