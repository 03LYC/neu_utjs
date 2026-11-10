import {it,expect} from 'vitest';
import {ReplyRouter} from '../electron/worker';
it('routes_out_of_order_responses_and_chunked_lines',async()=>{
 const router=new ReplyRouter();
 const a=router.wait('a',1000),b=router.wait('b',1000);
 router.accept('{"request_id":"b","result":2}\n{"request_id":');
 router.accept('"a","result":1}\n');
 expect(await a).toBe(1);expect(await b).toBe(2);
});
it('ignores_stale_task_response',async()=>{
 const router=new ReplyRouter();router.accept('{"request_id":"old","result":0}\n');
 const a=router.wait('new',1000);router.accept('{"request_id":"new","result":1}\n');expect(await a).toBe(1);
});
it('rejects_pending_on_exit',async()=>{
 const router=new ReplyRouter();const a=router.wait('a',1000);router.fail(new Error('进程退出'));await expect(a).rejects.toThrow('退出');
});
