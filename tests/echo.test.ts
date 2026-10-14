import {expect,test} from 'vitest';import {EchoReference,microphoneConstraints} from '../src/audio/echo';
const wave=(n:number,seed:number)=>{let x=seed;return Float32Array.from({length:n},()=>{x=(1664525*x+1013904223)>>>0;return ((x/4294967296)-.5)*.2;});};
const energy=(a:Float32Array)=>a.reduce((s,x)=>s+x*x,0)/a.length;
test('reference suppresses a delayed copy but keeps unrelated and double-talk speech',()=>{
 const reference=wave(10000,1),echo=new EchoReference();echo.push(reference);
 const mic=reference.slice(6500,8100).map(x=>x*.4);const cleaned=echo.clean(mic);expect(energy(cleaned)).toBeLessThan(energy(mic)*.01);
 const me=wave(1600,10);expect(echo.clean(me)).toEqual(me);
 const both=mic.map((x,i)=>x+me[i]);expect(echo.clean(both)).toEqual(both);
});
test('no reference, silent reference and stale reference preserve microphone',()=>{
 const mic=wave(1600,2),echo=new EchoReference();expect(echo.clean(mic)).toEqual(mic);echo.push(new Float32Array(1600));expect(echo.clean(mic)).toEqual(mic);echo.clear();expect(echo.clean(mic)).toEqual(mic);
});
test('microphone requests system-wide echo cancellation and retains chosen device',()=>{
 const c=microphoneConstraints('device-id');expect(c.audio).toMatchObject({deviceId:{exact:'device-id'},echoCancellation:{ideal:'all'},noiseSuppression:true,autoGainControl:false});
});
