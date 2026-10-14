import {electronTest} from './support/electron-test';
const test=electronTest('buttons.spec');
import {expect} from '@playwright/test';import {launchTestApp} from './support/launch';import {createServer} from 'node:http';
test('明显的启动入口、纯文字会话按钮状态及问答动作可用',async()=>{
 const app=await launchTestApp();const requests:any[]=[];const server=createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{const input=JSON.parse(body);requests.push(input);res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'按钮实际响应'},finish_reason:'stop'}]})+'\n\n');});});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);
  const overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!,prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
  await expect(overlay.getByRole('button',{name:'开始',exact:true})).toBeVisible();await expect(overlay.getByRole('button',{name:'停止接收',exact:true})).toBeDisabled();
  await prep.evaluate(port=>(window as any).api.saveSettings({model:{baseUrl:`http://127.0.0.1:${port}/v1`,modelName:'synthetic',apiKey:'synthetic-local-only'}}),(server.address() as any).port);
  await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_prepare'}));
  await prep.getByRole('button',{name:'← 返回选择',exact:true}).click();await prep.screenshot({path:'/private/tmp/realtime-assistant-plan/buttons-home.png'});await prep.getByRole('button',{name:'开始面试',exact:true}).click();
  await prep.getByRole('button',{name:'录音设置',exact:true}).click();await prep.getByRole('checkbox',{name:'采集实时音频'}).uncheck();
  const start=prep.getByRole('button',{name:'▶ 开始文字会话',exact:true});await expect(start).toBeVisible();await prep.screenshot({path:'/private/tmp/realtime-assistant-plan/buttons-prepare.png'});await start.click();
  await expect(overlay.getByRole('button',{name:'暂停录音',exact:true})).toBeDisabled();await expect(overlay.getByText('文字模式',{exact:true})).toBeVisible();
  await overlay.getByRole('button',{name:'知识问答',exact:true}).click();await expect(overlay.getByRole('alert')).toContainText('请输入问题');expect(requests).toHaveLength(0);
  await overlay.getByLabel('浮窗问题').fill('什么是数组');await overlay.getByRole('button',{name:'知识问答',exact:true}).click();await overlay.getByText('按钮实际响应',{exact:true}).waitFor();expect(requests).toHaveLength(1);expect(requests[0].messages.at(-1).content).toBe('什么是数组');await expect(overlay.getByRole('alert')).toHaveCount(0);
  await overlay.getByLabel('浮窗问题').fill('翻译测试');await overlay.getByRole('button',{name:'翻译',exact:true}).click();await expect.poll(()=>requests.length).toBe(2);expect(requests[1].messages[0].content).toContain('只翻译');
  await overlay.getByRole('button',{name:'结束并保存',exact:true}).click();await overlay.getByText('会话已结束，记录已保存',{exact:true}).waitFor();await expect(overlay.getByRole('button',{name:'开始',exact:true})).toBeVisible();
  await overlay.getByRole('button',{name:'增大文字',exact:true}).click();await expect.poll(()=>overlay.locator('.assist-columns').evaluate(el=>getComputedStyle(el).fontSize)).toBe('14px');await expect.poll(()=>overlay.locator('.transcript-scroll .empty').evaluate(el=>getComputedStyle(el).fontSize)).toBe('14px');await expect(overlay.getByText('14 px',{exact:true})).toBeVisible();await overlay.getByRole('button',{name:'减小文字',exact:true}).click();await expect.poll(()=>overlay.locator('.assist-columns').evaluate(el=>getComputedStyle(el).fontSize)).toBe('13px');await overlay.getByRole('button',{name:'收起',exact:true}).click();await expect(overlay.locator('.shell')).toHaveClass(/compact/);await overlay.getByRole('button',{name:'展开',exact:true}).click();await expect(overlay.locator('.shell')).not.toHaveClass(/compact/);
  const history=await overlay.evaluate(()=>(window as any).api.listHistory());expect(history).toHaveLength(1);
 }finally{await app.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
