import {electronTest} from './support/electron-test';
const test=electronTest('stability.spec');
import {expect} from '@playwright/test';import {launchTestApp} from './support/launch';
test('连续20次会话及窗口操作保持主进程和渲染进程可用',async()=>{
 const app=await launchTestApp();const rendererErrors:string[]=[];
 try{
  await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);
  const overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;overlay.on('pageerror',e=>rendererErrors.push(e.message));
  await app.evaluate(({BrowserWindow})=>{(globalThis as any).__crashes=[];for(const w of BrowserWindow.getAllWindows())w.webContents.on('render-process-gone',(_,details)=>(globalThis as any).__crashes.push(details.reason));});
  for(let i=0;i<20;i++){
   const state=await overlay.evaluate(async()=>{
    const api=(window as any).api;await api.startSession({form:{audioEnabled:false,auto:false},sources:['microphone'],recordAudio:false});
    await api.sendWindowCommand({action:'toggle_expand'});await api.sendWindowCommand({action:'toggle_expand'});
    await api.sendWindowCommand({action:'hide_overlay'});await api.sendWindowCommand({action:'show_overlay'});
    await Promise.all([api.stopSession(),api.stopSession()]);return api.getSession();
   });expect(state.state).toBe('stopped');
  }
  for(let i=0;i<10;i++)await overlay.evaluate(async()=>{await (window as any).api.sendWindowCommand({action:'close_prepare'});await (window as any).api.sendWindowCommand({action:'show_prepare'});});
  const records=await overlay.evaluate(()=>(window as any).api.listHistory());expect(records).toHaveLength(20);expect(records.every((r:any)=>r.state==='stopped')).toBe(true);
  expect(await app.evaluate(({BrowserWindow})=>({windows:BrowserWindow.getAllWindows().length,crashes:(globalThis as any).__crashes}))).toEqual({windows:2,crashes:[]});expect(rendererErrors).toEqual([]);
  const settings=await overlay.evaluate(()=>(window as any).api.getSettings());expect(settings.modelName).toBeTruthy();
 }finally{await app.close();}
});
