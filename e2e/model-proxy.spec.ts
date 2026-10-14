import {openModelDetails} from './support/launch';
import {electronTest} from './support/electron-test';
import {launchTestApp} from './support/launch';
import {expect} from '@playwright/test';
import {createServer} from 'node:http';
const test=electronTest('model-proxy.spec');

test('模型请求使用 Electron 会话代理，并正常解析流式回答',async()=>{
 const requests:string[]=[];
 const proxy=createServer((req,res)=>{
  requests.push(req.url??'');req.resume();
  req.on('end',()=>{
   res.writeHead(200,{'content-type':'text/event-stream'});
   res.end('data: '+JSON.stringify({choices:[{delta:{content:'代理链路正常'},finish_reason:'stop'}]})+'\n\n');
  });
 });
 await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 const app=await launchTestApp({previewOverlay:false});
 try{
  const port=(proxy.address() as any).port;
  await app.evaluate(async({session},port)=>{
   await session.defaultSession.setProxy({mode:'fixed_servers',proxyRules:`http=127.0.0.1:${port}`,proxyBypassRules:'<-loopback>'});
  },port);
  const page=await app.firstWindow();
  await page.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_prepare'}));
  await openModelDetails(page);
  // No upstream exists here: only the isolated test proxy can answer this request.
  await page.getByLabel('Base URL',{exact:true}).fill('http://127.0.0.1:45678/v1');
  await page.getByRole('button',{name:'保存并测试连接'}).click();
  await page.getByText('连接成功',{exact:true}).waitFor({timeout:5000});
  expect(requests).toContain('http://127.0.0.1:45678/v1/chat/completions');
 }finally{
  await app.close();proxy.closeAllConnections();await new Promise<void>(r=>proxy.close(()=>r()));
 }
});
