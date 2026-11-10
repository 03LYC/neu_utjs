import type {Settings,TaskEvent,FullRecord,RecordSummary,ROI,OCRDocument,QCPayload} from './contracts';
export type DesktopAPI={
 getSettings:()=>Promise<{settings:Settings;hasKey:boolean;dataRoot:string;runtime:any;testMode:boolean}>;
 saveSettings:(settings:Settings)=>Promise<void>;
 setApiKey:(key:string)=>Promise<{persistent:boolean}>;
 clearApiKey:()=>Promise<void>;
 checkConnection:()=>Promise<{models:string[];selected:string}>;
 importImage:()=>Promise<{dataUrl:string;fileToken:string}|null>;
 submitCapture:(input:{dataUrl:string;fileToken?:string;roi:ROI|null})=>Promise<{recordId:string}>;
 confirmPayload:(recordId:string,payload:QCPayload)=>Promise<void>;
 dismissPending:(recordId:string)=>Promise<void>;
 retryTask:(recordId:string,document?:OCRDocument)=>Promise<void>;
 initializeOCR:()=>Promise<any>;
 listRecords:(status?:string,offset?:number)=>Promise<RecordSummary[]>;
 getRecord:(recordId:string)=>Promise<FullRecord>;
 getRecordImage:(recordId:string,kind:'original'|'crop')=>Promise<string>;
 deleteRecord:(recordId:string)=>Promise<void>;
 onTask:(callback:(event:TaskEvent)=>void)=>()=>void;
};
declare global{interface Window{qc:DesktopAPI;}}
