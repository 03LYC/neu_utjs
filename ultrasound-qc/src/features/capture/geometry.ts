import type {ROI} from '../../../shared/contracts';
export function mapPreviewROI(rect:ROI,preview:{width:number;height:number},image:{width:number;height:number}):ROI{
 const scale=Math.min(preview.width/image.width,preview.height/image.height);
 const visibleWidth=image.width*scale,visibleHeight=image.height*scale;
 const left=(preview.width-visibleWidth)/2,top=(preview.height-visibleHeight)/2;
 const x=Math.max(0,Math.min(1,(rect.x-left)/visibleWidth));
 const y=Math.max(0,Math.min(1,(rect.y-top)/visibleHeight));
 const right=Math.max(0,Math.min(1,(rect.x+rect.width-left)/visibleWidth));
 const bottom=Math.max(0,Math.min(1,(rect.y+rect.height-top)/visibleHeight));
 if(right-x<0.01||bottom-y<0.01)throw new Error('请选择画面内有效报告区域');
 return {x,y,width:right-x,height:bottom-y};
}
export function shouldCaptureShortcut(event:{key:string;ctrlKey:boolean;shiftKey:boolean;altKey:boolean;metaKey:boolean;repeat:boolean},tagName:string,editable:boolean):boolean{
 return event.ctrlKey&&event.shiftKey&&!event.altKey&&!event.metaKey&&!event.repeat&&event.key.toLowerCase()==='q'&&!editable&&!['INPUT','TEXTAREA','SELECT'].includes(tagName);
}
