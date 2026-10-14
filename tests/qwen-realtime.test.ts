import {test,expect} from 'vitest';import {WebSocketServer} from 'ws';
import {QwenRealtime} from '../src/main/providers/realtime/qwen';
async function fixture(){const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(r=>server.once('listening',r));let peer:any;const messages:any[]=[];server.on('connection',ws=>{peer=ws;ws.on('message',b=>{const e=JSON.parse(b.toString());messages.push(e);if(e.type==='session.update')ws.send(JSON.stringify({type:'session.updated',session:e.session}));if(e.type==='response.create'){ws.send(JSON.stringify({type:'response.created',response:{id:'r1'}}));ws.send(JSON.stringify({type:'response.text.delta',response_id:'r1',delta:'回答'}));ws.send(JSON.stringify({type:'response.done',response:{id:'r1',status:'completed'}}));}})});return{server,messages,send:(e:any)=>peer.send(JSON.stringify(e)),url:`ws://127.0.0.1:${(server.address() as any).port}`}}
test('实时客户端内置转写且不会自行回复或打断，显式请求正确输出',async()=>{
 const f=await fixture();const transcripts:any[]=[],turns:string[]=[],tokens:string[]=[];
 const c=new QwenRealtime({endpoint:f.url,modelName:'qwen3.8-omni-flash-realtime',apiKey:'fake'},r=>transcripts.push(r),()=>{},id=>turns.push(id));
 try{await c.connect();expect(f.messages[0].session.turn_detection).toMatchObject({create_response:false,interrupt_response:false});expect(f.messages[0].session.input_audio_transcription.model).toBe('qwen3-asr-flash-realtime');
 f.send({type:'input_audio_buffer.committed',item_id:'i1'});f.send({type:'conversation.item.input_audio_transcription.completed',item_id:'i1',transcript:'一个问题'});
 await new Promise(r=>setTimeout(r,20));expect(turns).toEqual(['i1']);expect(transcripts[0]).toMatchObject({segmentId:'i1',text:'一个问题',isFinal:true});expect(f.messages.some(e=>e.type==='response.create')).toBe(false);
 await c.respond({messages:[{role:'user',content:'只回答音频问题'}],audio:true}, {onToken:t=>tokens.push(t)});expect(tokens).toEqual(['回答']);
 }finally{c.close();for(const ws of f.server.clients)ws.terminate();await new Promise<void>(r=>f.server.close(()=>r()))}
});
test('取消只停止当前请求，不接受迟到输出；自身文本上下文不创建回答',async()=>{
 const f=await fixture();const c=new QwenRealtime({endpoint:f.url,modelName:'qwen3.8-omni-flash-realtime',apiKey:'fake'},()=>{},()=>{},()=>{});
 try{await c.connect();c.addContext('[我] 我的回答');await new Promise(r=>setTimeout(r,15));expect(f.messages.at(-1).type).toBe('conversation.item.create');expect(f.messages.some(e=>e.type==='response.create')).toBe(false);
 }finally{c.close();for(const ws of f.server.clients)ws.terminate();await new Promise<void>(r=>f.server.close(()=>r()))}
});

test('取消后迟到输出不污染下个请求，待服务端收尾后可继续',async()=>{
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(r=>server.once('listening',r));let peer:any,calls=0;server.on('connection',ws=>{peer=ws;ws.on('message',b=>{const e=JSON.parse(b.toString());if(e.type==='session.update')ws.send(JSON.stringify({type:'session.updated'}));if(e.type==='response.create'){calls++;ws.send(JSON.stringify({type:'response.created',response:{id:'r'+calls}}));if(calls===2){ws.send(JSON.stringify({type:'response.text.delta',response_id:'r2',delta:'新回答'}));ws.send(JSON.stringify({type:'response.done',response:{id:'r2',status:'completed'}}));}}});});
 const c=new QwenRealtime({endpoint:`ws://127.0.0.1:${(server.address() as any).port}`,modelName:'qwen3.8-omni-flash-realtime',apiKey:'fake'},()=>{},()=>{},()=>{});const tokens:string[]=[];
 try{await c.connect();const abort=new AbortController();const first=c.respond({messages:[{role:'user',content:'旧问题'}],signal:abort.signal},{onToken:t=>tokens.push(t)});await new Promise(r=>setTimeout(r,20));abort.abort();await first;const second=c.respond({messages:[{role:'user',content:'新问题'}]},{onToken:t=>tokens.push(t)});peer.send(JSON.stringify({type:'response.text.delta',response_id:'r1',delta:'迟到'}));peer.send(JSON.stringify({type:'response.done',response:{id:'r1',status:'cancelled'}}));await second;expect(tokens).toEqual(['新回答']);
 }finally{c.close();for(const w of server.clients)w.terminate();await new Promise<void>(r=>server.close(()=>r()))}
});

test('单句转写失败只警告，不关闭连接或中断正在生成的回答',async()=>{
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(r=>server.once('listening',r));let peer:any;let created!:()=>void;const started=new Promise<void>(r=>created=r);
 server.on('connection',ws=>{peer=ws;ws.on('message',raw=>{const e=JSON.parse(raw.toString());if(e.type==='session.update')ws.send(JSON.stringify({type:'session.updated'}));if(e.type==='response.create'){ws.send(JSON.stringify({type:'response.created',response:{id:'recover'}}));created();}})});
 const warnings:string[]=[],errors:string[]=[],tokens:string[]=[],finishes:string[]=[];
 const c=new QwenRealtime({endpoint:`ws://127.0.0.1:${(server.address() as any).port}`,modelName:'test',apiKey:'synthetic'},()=>{},e=>errors.push(e.message),()=>{},e=>warnings.push(e.message));
 try{await c.connect();const response=c.respond({messages:[{role:'user',content:'合成问题'}],audio:true},{onToken:t=>tokens.push(t),onFinish:r=>finishes.push(r)});await started;
 peer.send(JSON.stringify({type:'conversation.item.input_audio_transcription.failed',item_id:'test-item'}));peer.send(JSON.stringify({type:'response.text.delta',response_id:'recover',delta:'连接仍然可以回答'}));peer.send(JSON.stringify({type:'response.done',response:{id:'recover',status:'completed'}}));await response;
 expect(warnings).toEqual(['REALTIME_TRANSCRIPTION_FAILED']);expect(errors).toEqual([]);expect(tokens).toEqual(['连接仍然可以回答']);expect(finishes).toEqual(['stop']);
 }finally{c.close();for(const ws of server.clients)ws.terminate();await new Promise<void>(r=>server.close(()=>r()));}
});
