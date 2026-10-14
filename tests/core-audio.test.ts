import {test,expect} from 'vitest';
import {pcm16,wavHeader} from '../src/main/session/audio';
test('PCM 饱和，小端 WAV 头匹配帧长度',()=>{
 const bytes=pcm16(new Float32Array([-2,0,2]));const view=new DataView(bytes.buffer);
 expect([0,1,2].map(i=>view.getInt16(i*2,true))).toEqual([-32768,0,32767]);
 const h=wavHeader(6);expect(new DataView(h.buffer).getUint32(40,true)).toBe(6);
});
