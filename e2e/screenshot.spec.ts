import {electronTest} from './support/electron-test';
const test=electronTest('screenshot.spec');
import {showOverlayPreview} from './support/launch';
import {expect,_electron as electron} from '@playwright/test';
import {createServer} from 'node:http';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
test('真实屏幕截图经按钮发送到本机测试接口并保存回答',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'screenshot-local-'));await mkdir(join(dir,'data'));const boot=join(dir,'main.cjs');
 await writeFile(boot,`require('electron').app.setPath('userData',${JSON.stringify(join(dir,'data'))});require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
 let received:{width:number;height:number;valid:boolean}|null=null;
 const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
  if(req.headers.authorization!=='Bearer synthetic-local-only'){res.writeHead(400);res.end();return;}
  const input=JSON.parse(body),parts=input.messages.at(-1).content;const image=parts.find((x:any)=>x.type==='image_url')?.image_url.url;
  if(typeof image!=='string'||!image.startsWith('data:image/png;base64,')){res.writeHead(400);res.end();return;}
  const png=Buffer.from(image.split(',')[1],'base64');received={valid:png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),width:png.readUInt32BE(16),height:png.readUInt32BE(20)};
  body='';res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'本机截图链路通过'},finish_reason:'stop'}]})+'\n\n');
 });});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const app=await electron.launch({args:[boot]});
 try{
  await app.firstWindow();await showOverlayPreview(app);await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);
  const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!,overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
  await prep.evaluate(port=>(window as any).api.saveSettings({model:{baseUrl:`http://127.0.0.1:${port}/v1`,modelName:'local-synthetic',apiKey:'synthetic-local-only'}}),(server.address() as any).port);
  await prep.evaluate(()=>(window as any).api.startSession({form:{audioEnabled:false,auto:false,mode:'exam'},sources:['microphone'],recordAudio:false}));
  await overlay.getByLabel('浮窗问题').fill('本机截图测试');await expect(overlay.getByLabel('浮窗问题')).toHaveValue('本机截图测试');await overlay.getByRole('button',{name:'截图提问',exact:true}).click();
  await overlay.getByText('本机截图链路通过',{exact:true}).waitFor();expect(received!.valid).toBe(true);expect(received!.width).toBeGreaterThan(0);expect(received!.height).toBeGreaterThan(0);
  await overlay.getByRole('button',{name:'结束并保存',exact:true}).click();await overlay.getByText('会话已结束，记录已保存',{exact:true}).waitFor();
  const saved=await prep.evaluate(async()=>{const records=await (window as any).api.listHistory();return (window as any).api.getHistory({sessionId:records[0].id});});expect(saved.answers[0]).toMatchObject({question:'本机截图测试',text:'本机截图链路通过',state:'completed'});
  await test.info().attach('capture-metadata',{body:JSON.stringify(received),contentType:'application/json'});
 }finally{await app.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
