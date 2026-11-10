import {contextBridge,ipcRenderer} from 'electron';
import type {DesktopAPI} from '../shared/api';
const api:DesktopAPI={
 getSettings:()=>ipcRenderer.invoke('settings:get'),saveSettings:s=>ipcRenderer.invoke('settings:save',s),
 setApiKey:key=>ipcRenderer.invoke('key:set',key),clearApiKey:()=>ipcRenderer.invoke('key:clear'),checkConnection:()=>ipcRenderer.invoke('api:check'),
 importImage:()=>ipcRenderer.invoke('capture:import'),submitCapture:input=>ipcRenderer.invoke('capture:submit',input),
 confirmPayload:(id,payload)=>ipcRenderer.invoke('task:confirm',id,payload),dismissPending:id=>ipcRenderer.invoke('task:dismiss',id),
 retryTask:(id,document)=>ipcRenderer.invoke('task:retry',id,document),initializeOCR:()=>ipcRenderer.invoke('ocr:initialize'),
 listRecords:(status,offset)=>ipcRenderer.invoke('records:list',status,offset),getRecord:id=>ipcRenderer.invoke('records:get',id),
 getRecordImage:(id,kind)=>ipcRenderer.invoke('records:image',id,kind),deleteRecord:id=>ipcRenderer.invoke('records:delete',id),
 onTask:callback=>{const listener=(_event:unknown,data:any)=>callback(data);ipcRenderer.on('task:event',listener);return ()=>ipcRenderer.removeListener('task:event',listener);}
};
contextBridge.exposeInMainWorld('qc',api);
