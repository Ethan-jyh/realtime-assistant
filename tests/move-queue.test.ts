import {test,expect,vi} from 'vitest';import {LatestMoveQueue} from '../src/shared/move-queue';
test('slow IPC never accumulates intermediate positions and drain waits for final endpoint',async()=>{
 const pending:Array<()=>void>=[],points:any[]=[];const queue=new LatestMoveQueue(point=>new Promise<void>(resolve=>{points.push(point);pending.push(resolve);}));
 queue.submit({x:0,y:0});for(let i=1;i<=100;i++)queue.submit({x:i,y:i});expect(points).toEqual([{x:0,y:0}]);const done=vi.fn();const drain=queue.drain().then(done);
 pending.shift()!();await vi.waitFor(()=>expect(points).toEqual([{x:0,y:0},{x:100,y:100}]));expect(done).not.toHaveBeenCalled();pending.shift()!();await drain;expect(done).toHaveBeenCalledOnce();
 queue.submit({x:100,y:100});await queue.drain();expect(points).toHaveLength(2);
});
test('a move rejection releases the queue and subsequent drag can finish',async()=>{
 const send=vi.fn().mockRejectedValueOnce(Error('MOVE_FAILED')).mockResolvedValue(undefined);const queue=new LatestMoveQueue(send);queue.submit({x:1,y:1});await expect(queue.drain()).rejects.toThrow('MOVE_FAILED');queue.submit({x:2,y:2});await expect(queue.drain()).resolves.toBeUndefined();
});
