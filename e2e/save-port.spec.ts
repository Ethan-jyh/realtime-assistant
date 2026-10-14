import {openModelDetails} from './support/launch';
import {electronTest} from './support/electron-test';
const test=electronTest('save-port.spec');
import {expect,_electron as electron} from '@playwright/test';import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
test('非 5173 开发端口可以独立保存配置，不调用模型测试',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'port-save-'));await mkdir(join(dir,'data'));
 const bootstrap=join(dir,'main.cjs');await writeFile(bootstrap,`require('electron').app.setPath('userData',${JSON.stringify(join(dir,'data'))});require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
 const server=createServer(async(req,res)=>{const rel=new URL(req.url!,'http://localhost').pathname;try{
  if(rel.includes('..'))throw Error('bad path');const file=resolve(__dirname,'../out/renderer',rel==='/'?'index.html':'.'+rel);
  const bytes=await readFile(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(bytes);
 }catch{res.writeHead(404);res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const app=await electron.launch({args:[bootstrap],env:{...process.env,ELECTRON_RENDERER_URL:origin}});
 try{
  await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
  await openModelDetails(prep);
  await prep.getByLabel('Base URL',{exact:true}).fill('http://127.0.0.1:9/v1');
  await prep.getByRole('button',{name:'保存配置',exact:true}).click();await prep.getByText('配置已保存',{exact:true}).waitFor();
  const saved=await prep.evaluate(()=>(window as any).api.getSettings());expect(saved.baseUrl).toBe('http://127.0.0.1:9/v1');
 }finally{await app.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
