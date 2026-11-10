import {it,expect} from 'vitest';
import {mapPreviewROI,shouldCaptureShortcut} from '../src/features/capture/geometry';
it('roi_maps_letterboxed_preview_to_image',()=>{
 expect(mapPreviewROI({x:0,y:25,width:200,height:100},{width:200,height:150},{width:400,height:200})).toEqual({x:0,y:0,width:1,height:1});
});
it('roi_is_clamped_and_cannot_be_empty',()=>{
 expect(()=>mapPreviewROI({x:0,y:0,width:10,height:10},{width:200,height:150},{width:400,height:200})).toThrow();
});
it('typing_does_not_capture',()=>{
 const key={key:'Q',ctrlKey:true,shiftKey:true,altKey:false,metaKey:false,repeat:false};
 expect(shouldCaptureShortcut(key,'INPUT',false)).toBe(false);
 expect(shouldCaptureShortcut(key,'DIV',false)).toBe(true);
 expect(shouldCaptureShortcut({...key,repeat:true},'DIV',false)).toBe(false);
});
