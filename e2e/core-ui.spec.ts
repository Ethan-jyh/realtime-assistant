import {electronTest} from './support/electron-test';
const test=electronTest('core-ui.spec');
import {expect,_electron as electron} from '@playwright/test';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {WebSocketServer} from 'ws';import {once} from 'node:events';
test('首页三步准备、纯文字会话及结束后的本地记录可用',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-ui-'));await mkdir(join(dir,'data'));const boot=join(dir,'main.cjs');
 await writeFile(boot,`require('electron').app.setPath('userData',${JSON.stringify(join(dir,'data'))});require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
 const app=await electron.launch({args:[boot]});
 try{
  await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);
  const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
  await prep.getByRole('button',{name:'← 返回选择'}).click();await prep.getByRole('heading',{name:'选择场景'}).waitFor();
  await prep.getByRole('button',{name:'学术面试',exact:true}).click();
  await prep.getByText('姓名',{exact:true}).waitFor();await prep.getByRole('button',{name:'面试信息',exact:true}).click();await prep.getByText('岗位',{exact:true}).waitFor();
  await prep.getByRole('button',{name:'录音设置',exact:true}).click();await prep.getByRole('checkbox',{name:'采集实时音频'}).uncheck();
  await prep.getByRole('button',{name:'▶ 开始文字会话',exact:true}).click();
  await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);const overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;await expect(overlay.getByRole('button',{name:'结束并保存'})).toBeEnabled();
  await overlay.getByRole('button',{name:'结束并保存'}).click();await overlay.getByText('会话已结束，记录已保存',{exact:true}).waitFor();
  const history=await overlay.evaluate(()=>(window as any).api.listHistory());expect(history).toHaveLength(1);expect(history[0].state).toBe('stopped');
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('直接退出会封装当前会话，记录可在下次启动恢复',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-quit-'));await mkdir(join(dir,'data'));const boot=join(dir,'main.cjs');
 await writeFile(boot,`require('electron').app.setPath('userData',${JSON.stringify(join(dir,'data'))});require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
 let app=await electron.launch({args:[boot]});
 try{
  await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);
  let prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
  const id=await prep.evaluate(()=>(window as any).api.startSession({form:{audioEnabled:false},sources:['microphone'],recordAudio:false}));
  const closed=app.waitForEvent('close');await app.evaluate(({app})=>app.quit());await closed;
  app=await electron.launch({args:[boot]});await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);
  prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
  const records=await prep.evaluate(()=>(window as any).api.listHistory());expect(records.map((r:any)=>r.id)).toContain(id.id);expect(records[0].state).toBe('stopped');
  await prep.evaluate(()=>(window as any).api.startSession({form:{audioEnabled:false},sources:['microphone'],recordAudio:false}));
  const stops=await prep.evaluate(()=>Promise.all([(window as any).api.stopSession(),(window as any).api.stopSession()]));expect(stops.every((r:any)=>r.ok)).toBe(true);
 }finally{await app.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
});

test('取消等待采集的启动及并行停止，旧启动不会终止下一会话',async()=>{
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 server.on('connection',socket=>socket.on('message',bytes=>{const m=JSON.parse(bytes.toString());socket.send(JSON.stringify({header:{task_id:m.header.task_id,event:m.header.action==='run-task'?'task-started':'task-finished'},payload:{}}));}));
 const dir=await mkdtemp(join(tmpdir(),'capture-cancel-'));await mkdir(join(dir,'data'));const boot=join(dir,'main.cjs');
 await writeFile(boot,`const E=require('electron');E.app.setPath('userData',${JSON.stringify(join(dir,'data'))});
 const W=require(${JSON.stringify(require.resolve('ws'))});const Module=require('module'),load=Module._load;
 class LocalWS extends W {constructor(url,options){super(String(url).replace('wss:','ws:'),options);}}
 Module._load=function(name,...args){return name==='ws'?LocalWS:load.call(this,name,...args);};
 const lf=E.BrowserWindow.prototype.loadFile;E.BrowserWindow.prototype.loadFile=function(file,opts){if(opts?.hash==='/capture')return Promise.resolve();return lf.call(this,file,opts);};
 require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
 const app=await electron.launch({args:[boot]});
 try{
  await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
  await prep.evaluate(port=>(window as any).api.saveSettings({asr:{provider:'aliyun',endpoint:`wss://127.0.0.1:${port}`,modelName:'synthetic',apiKey:'synthetic-test-key'}}),(server.address() as any).port);
  await prep.evaluate(()=>{(window as any).pending=(window as any).api.startSession({form:{audioEnabled:true},sources:['microphone'],recordAudio:true}).catch((e:any)=>e.message);});
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(2);
  const stops=await prep.evaluate(()=>Promise.all([(window as any).api.stopSession(),(window as any).api.stopSession()]));expect(stops.every((r:any)=>r.ok)).toBe(true);
  const next=await prep.evaluate(()=>(window as any).api.startSession({form:{audioEnabled:false},sources:['microphone'],recordAudio:false}));
  await prep.evaluate(()=>(window as any).pending);const current=await prep.evaluate(()=>(window as any).api.getSession());expect(current.id).toBe(next.id);expect(current.state).toBe('running');
  await prep.evaluate(()=>(window as any).api.stopSession());
 }finally{await app.close();for(const s of server.clients)s.terminate();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
