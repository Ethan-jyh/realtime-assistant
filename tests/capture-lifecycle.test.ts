import {test,expect,vi} from 'vitest';
import {CaptureLifecycle} from '../src/audio/capture-lifecycle';
test('pause releases tracks; resume rebuilds with original device; failure can retry',async()=>{
 const release=vi.fn(),opened:string[]=[];let fail=false;
 const life=new CaptureLifecycle(async(device:string)=>{opened.push(device);if(fail)throw Error('DEVICE_LOST');return {dispose:release};});
 await life.start('original-device');await life.pause();expect(release).toHaveBeenCalledTimes(1);
 fail=true;await expect(life.resume()).rejects.toThrow('DEVICE_LOST');fail=false;await life.resume();
 expect(opened).toEqual(['original-device','original-device','original-device']);await life.stop();expect(release).toHaveBeenCalledTimes(2);
 await expect(life.resume()).rejects.toThrow('CAPTURE_NOT_CONFIGURED');
});
test('stop while rebuilding disposes late stream and does not leave capture active',async()=>{
 const dispose=vi.fn();let resolve!:(r:{dispose:()=>void})=>void;
 const life=new CaptureLifecycle(()=>new Promise<{dispose:()=>void}>(r=>resolve=r));
 const start=life.start('device');await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));const stop=life.stop();resolve({dispose});await expect(start).rejects.toThrow('CAPTURE_CANCELLED');await stop;expect(dispose).toHaveBeenCalledTimes(1);
});
