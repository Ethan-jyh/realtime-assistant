import {openModelDetails} from './support/launch';
import {electronTest} from './support/electron-test';
const test=electronTest('model-flow.spec');
import {showOverlayPreview} from './support/launch';
import { expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import {once} from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('sandbox 桥接可用，连续提问不混入旧回答，取消后可再次提问', async () => {
  const dir=await mkdtemp(join(tmpdir(),'assistant-e2e-'));
  const dataDir=join(dir,'data');await mkdir(dataDir);
  const bootstrap=join(dir,'bootstrap.cjs');
  await writeFile(bootstrap,`require('electron').app.setPath('userData',${JSON.stringify(dataDir)});require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
  let call=0;
  const server=createServer((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      const input=JSON.parse(body);call++;
      if(!input.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'连接正常'},finish_reason:'stop'}]}));return;}
      const q=input.messages.at(-1).content;res.writeHead(200,{'content-type':'text/event-stream'});
      if(q==='慢问题'){
        res.write('data: '+JSON.stringify({choices:[{delta:{content:'前缀'},finish_reason:null}]})+'\n\n');
        const timer=setTimeout(()=>res.end('data: '+JSON.stringify({choices:[{delta:{content:'迟到'},finish_reason:'stop'}]})+'\n\n'),2000);
        res.on('close',()=>clearTimeout(timer));return;
      }
      res.end('data: '+JSON.stringify({choices:[{delta:{content:q==='问题一'?'回答一':'回答二'},finish_reason:'stop'}]})+'\n\n');
    });
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  let app=await electron.launch({executablePath:process.env.ASSISTANT_ELECTRON_PATH,args:[bootstrap]});
  try{
    await app.firstWindow();await showOverlayPreview(app);
    await expect.poll(()=>app.windows().length).toBe(2);
    await expect.poll(()=>app.windows().some(p=>p.url().includes('/prepare'))).toBe(true);
    await expect.poll(()=>app.windows().some(p=>p.url().includes('/overlay'))).toBe(true);
    const prep=app.windows().find(p=>p.url().includes('/prepare'))!;
    const overlay=app.windows().find(p=>p.url().includes('/overlay'))!;
    await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_prepare'}));
    await openModelDetails(prep);
    await expect.poll(()=>prep.evaluate(()=>typeof (window as any).api?.askAnswer)).toBe('function');
    await expect.poll(()=>overlay.evaluate(()=>typeof (window as any).api?.onAnswer)).toBe('function');
    const port=(server.address() as any).port;
    await prep.getByLabel('Base URL',{exact:true}).fill(`http://127.0.0.1:${port}/v1`);
    await prep.getByRole('button',{name:'保存并测试连接'}).click();await prep.getByText('连接成功',{exact:true}).waitFor();
    const ask=async(q:string)=>{await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_prepare'}));await prep.locator('textarea').fill(q);await expect(prep.locator('textarea')).toHaveValue(q);await prep.getByRole('button',{name:'发送提问',exact:true}).click();await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_overlay'}));};
    await ask('问题一');await overlay.getByText('回答一',{exact:true}).waitFor();
    await ask('问题二');await overlay.getByText('回答二',{exact:true}).waitFor();
    await expect(overlay.locator('.answer-card').nth(0)).toContainText('回答一');await expect(overlay.locator('.answer-card').nth(1)).toContainText('回答二');await expect(overlay.locator('.answer-card').nth(1)).not.toContainText('回答一');
    await ask('慢问题');await overlay.getByText('前缀',{exact:true}).waitFor();
    await overlay.getByRole('button',{name:'停止接收',exact:true}).click();
    await expect(overlay.locator('body')).toContainText('停止接收');
    await ask('问题二');await overlay.locator('.answer-card').last().getByText('回答二',{exact:true}).waitFor();
    await expect(overlay.locator('.answer-card').last()).not.toContainText('前缀');
    await expect(overlay.locator('body')).not.toContainText('迟到');
    expect(call).toBe(5);
    // Context closure can precede process exit and single-instance lock release.
    const exited=once(app.process(),'exit');await app.close();await exited;
    app=await electron.launch({executablePath:process.env.ASSISTANT_ELECTRON_PATH,args:[bootstrap]});
    await app.firstWindow();await showOverlayPreview(app);
    await expect.poll(()=>app.windows().some(p=>p.url().includes('/prepare'))).toBe(true);
    const reopened=app.windows().find(p=>p.url().includes('/prepare'))!;
    await reopened.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_prepare'}));await openModelDetails(reopened);await expect(reopened.getByLabel('Base URL',{exact:true})).toHaveValue(`http://127.0.0.1:${port}/v1`);
  }finally{
    await app.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});
  }
});
