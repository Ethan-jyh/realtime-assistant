import {test,expect,vi} from 'vitest';import {WebSocketServer} from 'ws';import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {CoreSession} from '../src/main/session/controller';
test('双来源转写与录音保存，重复停止幂等',async()=>{
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 server.on('connection',socket=>{let task='';socket.on('message',(bytes,binary)=>{
  if(binary){socket.send(JSON.stringify({header:{event:'result-generated',task_id:task},payload:{output:{sentence:{sentence_id:1,text:'数组',sentence_end:true,begin_time:0,end_time:100}}}}));return;}
  const message=JSON.parse(bytes.toString());task=message.header.task_id;
  socket.send(JSON.stringify({header:{task_id:task,event:message.header.action==='run-task'?'task-started':'task-finished'},payload:{}}));
 });});
 const dir=await mkdtemp(join(tmpdir(),'session-flow-'));
 try{
  const events:any[]=[];const core=new CoreSession(dir,(type,data)=>events.push({type,data}),()=>{});
  const id=await core.start({audioEnabled:true},['microphone','system'],{endpoint:`ws://127.0.0.1:${(server.address() as any).port}`,modelName:'test',apiKey:'synthetic'},true);
  expect(core.pcm('microphone',new Uint8Array(3200))).toBe(true);expect(core.pcm('system',new Uint8Array(3200))).toBe(true);
  for(let i=0;i<100&&core.segments.length<2;i++)await new Promise(r=>setTimeout(r,5));
  await Promise.all([core.stop(),core.stop()]);
  expect(core.state).toBe('stopped');expect(core.recordingSaved).toBe(true);expect(core.segments.map(x=>x.sourceId).sort()).toEqual(['microphone','system']);
  const record=JSON.parse(await readFile(join(dir,id,'session.json'),'utf8'));expect(record.transcripts).toHaveLength(2);
  for(const source of ['microphone','system']){const audio=await readFile(join(dir,id,source+'.wav'));expect(audio.length).toBe(3244);expect(audio.readUInt32LE(40)).toBe(3200);}
  expect(core.pcm('microphone',new Uint8Array(3200))).toBe(false);
 }finally{await rm(dir,{recursive:true,force:true});for(const socket of server.clients)socket.terminate();await new Promise<void>(r=>server.close(()=>r()));}
});

test('启动连接尚未完成时停止，停止完成后旧启动不能改写新会话',async()=>{
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const connected=once(server,'connection');const dir=await mkdtemp(join(tmpdir(),'session-cancel-'));
 try{
  const core=new CoreSession(dir,()=>{},()=>{});
  const first=core.start({audioEnabled:true},['microphone'],{endpoint:`ws://127.0.0.1:${(server.address() as any).port}`,modelName:'test',apiKey:'synthetic'},true).catch(()=>null);
  await connected;await core.stop();await first;
  expect(core.state).toBe('stopped');
  const next=await core.start({audioEnabled:false},[],null,false);
  await new Promise(r=>setTimeout(r,30));expect(core.id).toBe(next);expect(core.state).toBe('running');await core.stop();
 }finally{for(const s of server.clients)s.terminate();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});

test('暂停期间连接已结束，继续必须建立新识别任务且保持会话与转写',async()=>{
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');let connectionCount=0;const connections:any[]=[];
 server.on('connection',socket=>{const entry={socket,task:''};connections.push(entry);connectionCount++;socket.on('message',(bytes,binary)=>{
  if(binary){socket.send(JSON.stringify({header:{event:'result-generated',task_id:entry.task},payload:{output:{sentence:{sentence_id:1,text:'第'+connectionCount+'次转写',sentence_end:true}}}}));return;}
  const m=JSON.parse(bytes.toString());entry.task=m.header.task_id;socket.send(JSON.stringify({header:{task_id:entry.task,event:m.header.action==='run-task'?'task-started':'task-finished'},payload:{}}));
 });});const dir=await mkdtemp(join(tmpdir(),'pause-resume-'));
 try{
  const core=new CoreSession(dir,()=>{},()=>{}),id=await core.start({audioEnabled:true},['microphone'],{endpoint:`ws://127.0.0.1:${(server.address() as any).port}`,modelName:'test',apiKey:'synthetic'},false);
  expect(core.pcm('microphone',new Uint8Array(3200))).toBe(true);for(let i=0;i<100&&!core.segments.length;i++)await new Promise(r=>setTimeout(r,5));
  // The fallback reproduces the old main-process pause toggle, which only changed a flag.
  if(typeof (core as any).setPaused==='function')await (core as any).setPaused(true);else core.form.paused=true;
  connections[0].socket.send(JSON.stringify({header:{task_id:connections[0].task,event:'task-finished'},payload:{}}));await new Promise(r=>setTimeout(r,30));
  if(typeof (core as any).setPaused==='function')await (core as any).setPaused(false);else core.form.paused=false;
  expect(core.pcm('microphone',new Uint8Array(3200))).toBe(true);expect(connectionCount).toBe(2);expect(core.id).toBe(id);
  for(let i=0;i<100&&core.segments.length<2;i++)await new Promise(r=>setTimeout(r,5));expect(core.segments).toHaveLength(2);expect(core.segments.map(x=>x.streamEpoch)).toEqual([1,2]);await core.stop();
 }finally{for(const c of connections)c.socket.terminate();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});

test('四次零散断线在恢复实际转写后仍能继续重连',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const sockets:any[]=[];let sequence=0;
 server.on('connection',socket=>{sockets.push(socket);let task='';socket.on('message',(bytes,binary)=>{
  if(binary){socket.send(JSON.stringify({header:{event:'result-generated',task_id:task},payload:{output:{sentence:{sentence_id:1,text:'恢复转写'+(++sequence),sentence_end:true}}}}));return;}
  const m=JSON.parse(bytes.toString());task=m.header.task_id;socket.send(JSON.stringify({header:{task_id:task,event:m.header.action==='run-task'?'task-started':'task-finished'},payload:{}}));
 });});
 const dir=await mkdtemp(join(tmpdir(),'recover-asr-'));const warnings:any[]=[];let readyCount=0;const core=new CoreSession(dir,(type,data)=>{if(type==='session.warning')warnings.push(data);if(type==='asr.lifecycle'&&data.state==='ready')readyCount++;},()=>{});
 const pump=async(predicate:()=>boolean)=>{for(let i=0;i<500&&!predicate();i++)await new Promise<void>(r=>setImmediate(r));expect(predicate()).toBe(true);};
 try{
  await core.start({audioEnabled:true},['system'],{endpoint:'ws://127.0.0.1:'+(server.address() as any).port,modelName:'test',apiKey:'synthetic'},false);
  for(let i=0;i<4;i++){
   expect(core.pcm('system',new Uint8Array(3200))).toBe(true);await pump(()=>core.segments.length===i+1);
   sockets[i].terminate();await pump(()=>warnings.length===i+1);await vi.advanceTimersByTimeAsync(1000);
   await pump(()=>sockets.length===i+2);await pump(()=>readyCount===i+2);
  }
  expect(core.state).toBe('running');expect(core.segments).toHaveLength(4);
 }finally{await core.stop();vi.useRealTimers();for(const socket of sockets)socket.terminate();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});

test('连续失败且从未恢复转写时仅重试三次',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const sockets:any[]=[];let sequence=0;
 server.on('connection',socket=>{sockets.push(socket);let task='';socket.on('message',(bytes,binary)=>{
  if(binary){socket.send(JSON.stringify({header:{event:'result-generated',task_id:task},payload:{output:{sentence:{sentence_id:1,text:'恢复转写'+(++sequence),sentence_end:true}}}}));return;}
  const m=JSON.parse(bytes.toString());task=m.header.task_id;socket.send(JSON.stringify({header:{task_id:task,event:m.header.action==='run-task'?'task-started':'task-finished'},payload:{}}));
 });});
 const dir=await mkdtemp(join(tmpdir(),'recover-asr-'));const warnings:any[]=[];let readyCount=0;let failedCount=0;const core=new CoreSession(dir,(type,data)=>{if(type==='session.warning')warnings.push(data);if(type==='asr.lifecycle'&&data.state==='ready')readyCount++;if(type==='asr.lifecycle'&&data.state==='failed')failedCount++;},()=>{});
 const pump=async(predicate:()=>boolean)=>{for(let i=0;i<500&&!predicate();i++)await new Promise<void>(r=>setImmediate(r));expect(predicate()).toBe(true);};
 try{
  await core.start({audioEnabled:true},['system'],{endpoint:'ws://127.0.0.1:'+(server.address() as any).port,modelName:'test',apiKey:'synthetic'},false);
  for(let i=0;i<3;i++){
   sockets[i].terminate();await pump(()=>failedCount===i+1);await vi.advanceTimersByTimeAsync(1000*2**i);
   await pump(()=>readyCount===i+2);
  }
  sockets[3].terminate();await pump(()=>failedCount===4);await vi.advanceTimersByTimeAsync(20000);
  expect(sockets).toHaveLength(4);expect(core.segments).toHaveLength(0);
  expect(warnings.some(x=>x.message.includes('暂停并继续'))).toBe(true);
 }finally{await core.stop();vi.useRealTimers();for(const socket of sockets)socket.terminate();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
