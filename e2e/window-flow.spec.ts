import {openModelDetails} from './support/launch';
import {electronTest} from './support/electron-test';
const test=electronTest('window-flow.spec');
import {expect} from '@playwright/test';import {launchTestApp} from './support/launch';
test('启动只显示准备页，开始后切换浮窗，设置与返回会话只显示一个窗口',async()=>{
 const app=await launchTestApp({previewOverlay:false});
 try{
  await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
  const visible=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.isVisible()).map(w=>w.webContents.getURL().split('#')[1]));await expect.poll(visible).toEqual(['/prepare']);if(process.platform==='darwin')expect(await app.evaluate(({app})=>app.dock.isVisible())).toBe(false);expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);
  await prep.evaluate(()=>(window as any).api.startSession({sources:['microphone'],form:{audioEnabled:false},recordAudio:false}));await expect.poll(visible).toEqual(['/overlay']);await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);const overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
  await overlay.getByRole('button',{name:'打开设置',exact:true}).click();await expect.poll(visible).toEqual(['/prepare']);await prep.getByRole('button',{name:'← 返回选择',exact:true}).click();await prep.getByRole('button',{name:'返回当前会话',exact:true}).click();await expect.poll(visible).toEqual(['/overlay']);if(process.platform==='darwin')expect(await app.evaluate(({app})=>app.dock.isVisible())).toBe(false);await overlay.getByRole('button',{name:'结束并保存',exact:true}).click();
 }finally{await app.close();}
});
test('所有区域允许指针事件，移动由拖动 hook 管理，按钮输入保持可交互',async()=>{
 const app=await launchTestApp({previewOverlay:false});try{
  await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
  await openModelDetails(prep);await expect.poll(()=>prep.locator('.shell').evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');expect(await prep.getByRole('button',{name:'保存配置',exact:true}).evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');expect(await prep.getByLabel('问题',{exact:true}).evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
 }finally{await app.close();}
});
