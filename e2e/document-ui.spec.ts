import {electronTest} from './support/electron-test';
const test=electronTest('document-ui.spec');
import {expect} from '@playwright/test';import {launchTestApp} from './support/launch';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createServer} from 'node:http';
test('导入预览确认、资料问答、历史查看与导出有实际结果',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'document-buttons-')),file=join(dir,'资料.txt'),exported=join(dir,'导出.txt');await writeFile(file,'合成资料：项目使用数组保存商品列表。');let request:any;
 const server=createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{request=JSON.parse(body);res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'**资料已用于回答**'},finish_reason:'stop'}]})+'\n\n');});});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const app=await launchTestApp();
 try{
  await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))&&app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!,overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
  prep.on('dialog',d=>d.dismiss());await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[paths.file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:paths.exported});},{file,exported});
  await prep.evaluate(port=>(window as any).api.saveSettings({model:{baseUrl:`http://127.0.0.1:${port}/v1`,modelName:'synthetic',apiKey:'synthetic-local-only'}}),(server.address() as any).port);
  await prep.getByRole('button',{name:'← 返回选择',exact:true}).click();await prep.getByRole('button',{name:'学术面试',exact:true}).click();await prep.getByRole('button',{name:'导入 TXT / DOCX / PDF',exact:true}).click();
  await expect(prep.getByRole('button',{name:'确认导入',exact:true})).toBeVisible();await expect(prep.getByText('合成资料：项目使用数组保存商品列表。',{exact:true})).toBeVisible();await prep.getByRole('button',{name:'确认导入',exact:true}).click();await expect(prep.getByLabel('补充资料',{exact:true})).toHaveValue(/项目使用数组/);
  await prep.getByRole('button',{name:'录音设置',exact:true}).click();await prep.getByRole('checkbox',{name:'采集实时音频'}).uncheck();await prep.getByRole('button',{name:'▶ 开始文字会话',exact:true}).click();
  await overlay.getByLabel('浮窗问题').fill('项目如何保存商品');await overlay.getByRole('button',{name:'知识问答',exact:true}).click();await overlay.getByText('资料已用于回答',{exact:true}).waitFor();expect(JSON.stringify(request.messages)).toContain('项目使用数组');await overlay.getByRole('button',{name:'资料问答',exact:true}).click();await overlay.getByText('资料已用于回答',{exact:true}).last().waitFor();expect(JSON.stringify(request.messages)).toContain('项目使用数组');
  await overlay.getByRole('button',{name:'结束并保存',exact:true}).click();await overlay.getByText('会话已结束，记录已保存',{exact:true}).waitFor();await overlay.getByRole('button',{name:'打开设置',exact:true}).click();await prep.getByRole('button',{name:'← 返回选择',exact:true}).click();await prep.getByRole('button',{name:'历史记录',exact:true}).click();await prep.getByRole('button',{name:'查看',exact:true}).click();await expect(prep.locator('.answer strong').last()).toHaveText('资料已用于回答');
  await prep.getByRole('button',{name:'导出',exact:true}).click();await expect.poll(async()=>readFile(exported,'utf8').catch(()=>'' )).toContain('资料已用于回答');
 }finally{await app.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
