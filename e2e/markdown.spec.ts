import {openModelDetails} from './support/launch';
import {electronTest} from './support/electron-test';
const test=electronTest('markdown.spec');
import {expect} from '@playwright/test';import {launchTestApp} from './support/launch';import {createServer} from 'node:http';
test('流式回答渲染标题粗体列表代码表格且不执行模型 HTML',async()=>{
 const markdown='## 解释\n\n**数组**保存有序数据。\n\n- 元素一\n- 元素二\n\n```js\nconst list = [1, 2];\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 长度 | 2 |\n\n<script>window.__markdownExecuted=true</script>\n\n[坏链接](javascript:alert(1))';
 const app=await launchTestApp(),server=createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:markdown.slice(0,30)},finish_reason:null}]})+'\n\n');setTimeout(()=>res.end('data: '+JSON.stringify({choices:[{delta:{content:markdown.slice(30)},finish_reason:'stop'}]})+'\n\n'),50);});});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))&&app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!,overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
  await openModelDetails(prep);await prep.evaluate(port=>(window as any).api.saveSettings({model:{baseUrl:`http://127.0.0.1:${port}/v1`,modelName:'synthetic',apiKey:'synthetic-local-only'}}),(server.address() as any).port);
  await overlay.getByLabel('浮窗问题').fill('解释数组');await overlay.getByRole('button',{name:'生成回答',exact:true}).click();
  await expect(overlay.locator('.overlay-answer h2')).toHaveText('解释');await expect(overlay.locator('.overlay-answer .markdown-body strong')).toHaveText('数组');await expect(overlay.locator('.overlay-answer li')).toHaveCount(2);await expect(overlay.locator('.overlay-answer pre code')).toContainText('const list');await expect(overlay.locator('.overlay-answer table')).toContainText('长度');
  await expect(overlay.locator('.answer-panel:not(.deep-panel) .overlay-answer')).not.toContainText('**数组**');expect(await overlay.evaluate(()=>(window as any).__markdownExecuted)).toBeUndefined();await expect(overlay.locator('.overlay-answer script')).toHaveCount(0);await expect(overlay.locator('.overlay-answer a[href^="javascript:"]')).toHaveCount(0);
  await expect(prep.locator('#model .answer h2')).toHaveText('解释');await overlay.screenshot({path:'/private/tmp/realtime-assistant-plan/markdown-rendered.png'});
 }finally{await app.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
