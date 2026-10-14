import {electronTest} from './support/electron-test';
const test=electronTest('lifecycle.spec');
import { expect } from '@playwright/test';
import {launchTestApp} from './support/launch';
test('销毁窗口后迟到的可见性事件不再访问失效对象',async()=>{
  const app=await launchTestApp();
  try{
    await app.firstWindow();await expect.poll(()=>app.windows().length).toBe(2);
    const errors=await app.evaluate(({BrowserWindow})=>{
      const failures:string[]=[];const targets=BrowserWindow.getAllWindows();
      // Keep the automation connection alive while testing destruction of all targets.
      new BrowserWindow({show:false,webPreferences:{sandbox:true}});
      for(const w of targets){
        w.destroy();
        for(const event of ['hide','show','minimize','restore','ready-to-show']){
          try{w.emit(event);}catch(error:any){failures.push(`${event}: ${error.message}`);}
        }
      }
      return failures;
    });
    expect(errors).toEqual([]);
  }finally{await app.close();}
});

test('准备页快速关闭重开不会留下失效引用',async()=>{
  const app=await launchTestApp();
  try{
    await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);
    const overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
    await overlay.getByText('等待助手输出...', {exact:true}).waitFor();
    for(let i=0;i<10;i++){
      await overlay.evaluate(async()=>{await (window as any).api.sendWindowCommand({action:'close_prepare'});await (window as any).api.sendWindowCommand({action:'show_prepare'});});
    }
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()).length)).toBe(2);
    await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);
    const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
    await expect.poll(()=>prep.locator('body').innerText()).toMatch(/回答方案|模型配置与手动提问|选择场景/);
  }finally{await app.close();}
});
