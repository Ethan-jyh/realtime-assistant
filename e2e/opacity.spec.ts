import {openModelDetails} from './support/launch';
import {electronTest} from './support/electron-test';
const test=electronTest('opacity.spec');
import {showOverlayPreview} from './support/launch';
import { expect, _electron as electron } from '@playwright/test';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';import { tmpdir } from 'node:os';
test('滑块改变原生窗口不透明度，重启恢复，ASR 配置不回传密钥',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'opacity-e2e-'));await mkdir(join(dir,'data'));
  const file=join(dir,'bootstrap.cjs');await writeFile(file,`require('electron').safeStorage.isEncryptionAvailable=()=>false;require('electron').app.setPath('userData',${JSON.stringify(join(dir,'data'))});require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
  let app=await electron.launch({args:[file]});
  try{
    await app.firstWindow();await showOverlayPreview(app);await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);
    let prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
    await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_prepare'}));await openModelDetails(prep);const slider=prep.getByLabel('窗口不透明度');await expect(slider).toBeVisible();
    await slider.press('Home');
    for(let i=0;i<40;i++)await slider.press('ArrowRight');
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isAlwaysOnTop())!.getOpacity())).toBeCloseTo(0.4,2);
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isAlwaysOnTop())!.getOpacity())).toBeCloseTo(0.4,2);
    const saved=await prep.evaluate(async()=>{
      await (window as any).api.saveSettings({asr:{provider:'aliyun',endpoint:'wss://dashscope.aliyuncs.com/api-ws/v1/inference',modelName:'qwen-audio-3.1-asr-flash-streaming',language:'zh',apiKey:'synthetic-asr'}});
      return (window as any).api.getSettings();
    });
    expect(saved.asr.modelName).toBe('qwen-audio-3.1-asr-flash-streaming');expect(saved.asr.apiKey).toBeUndefined();
    await app.close();app=await electron.launch({args:[file]});await app.firstWindow();await showOverlayPreview(app);
    await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);
    prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
    await openModelDetails(prep);await expect(prep.getByLabel('窗口不透明度')).toHaveValue('40');
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isAlwaysOnTop())!.getOpacity())).toBeCloseTo(0.4,2);
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isAlwaysOnTop())!.getOpacity())).toBeCloseTo(0.4,2);
    const result=await prep.evaluate(()=>(window as any).api.getSettings());
    expect(result.asr.modelName).toBe('qwen-audio-3.1-asr-flash-streaming');
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('Option 左右在穿透时调节透明度，不重建窗口，隐藏后释放',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'control-opacity-'));await mkdir(join(dir,'data'));const boot=join(dir,'main.cjs');
 await writeFile(boot,`const E=require('electron');E.app.setPath('userData',${JSON.stringify(join(dir,'data'))});const keys=globalThis.testKeys=new Map();E.globalShortcut.isRegistered=k=>keys.has(k);E.globalShortcut.register=(k,f)=>{keys.set(k,f);return true};E.globalShortcut.unregister=k=>keys.delete(k);E.globalShortcut.unregisterAll=()=>keys.clear();require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
 const app=await electron.launch({args:[boot]});
 try{
  await showOverlayPreview(app);await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);const overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
  await overlay.getByRole('heading',{name:'快速',exact:true}).waitFor();await overlay.evaluate(()=>(window as any).api.sendWindowCommand({action:'set_mouse_through',enabled:true}));
  await expect.poll(()=>app.evaluate(()=>['Alt+Left','Alt+Right'].every(k=>(globalThis as any).testKeys.has(k)))).toBe(true);
  const identity=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.isAlwaysOnTop())!;return {id:w.id,bounds:w.getBounds()}});
  const press=async(key:string,count=1)=>app.evaluate(({BrowserWindow},{key,count})=>{for(let i=0;i<count;i++)(globalThis as any).testKeys.get(key)();},{key,count});
  await press('Alt+Left',3);await expect.poll(()=>overlay.evaluate(()=>(window as any).api.getSettings().then((s:any)=>s.opacity))).toBeCloseTo(.7,2);
  await press('Alt+Right');await expect.poll(()=>overlay.evaluate(()=>(window as any).api.getSettings().then((s:any)=>s.opacity))).toBeCloseTo(.8,2);
  await press('Alt+Left',12);await expect.poll(()=>overlay.evaluate(()=>(window as any).api.getSettings().then((s:any)=>s.opacity))).toBe(0);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isAlwaysOnTop())!.getOpacity())).toBe(0);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isAlwaysOnTop())!.isVisible())).toBe(true);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isAlwaysOnTop())!.getOpacity())).toBe(1);
  await press('Alt+Right');await expect.poll(()=>overlay.evaluate(()=>(window as any).api.getSettings().then((s:any)=>s.opacity))).toBe(.1);
  await press('Alt+Right',12);await expect.poll(()=>overlay.evaluate(()=>(window as any).api.getSettings().then((s:any)=>s.opacity))).toBe(1);
  expect(await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.isAlwaysOnTop())!;return {id:w.id,bounds:w.getBounds()}})).toEqual(identity);
  await overlay.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_prepare'}));
  await expect.poll(()=>app.evaluate(()=>['Alt+Left','Alt+Right','Control+Z'].some(k=>(globalThis as any).testKeys.has(k)))).toBe(false);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('滑块支持零，重启恢复完全透明且设置页仍可操作',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zero-opacity-e2e-'));await mkdir(join(dir,'data'));const boot=join(dir,'main.cjs');await writeFile(boot,`require('electron').app.setPath('userData',${JSON.stringify(join(dir,'data'))});require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
 let app=await electron.launch({args:[boot]});
 try{
  await showOverlayPreview(app);const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;
  await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_prepare'}));await openModelDetails(prep);
  await prep.getByLabel('窗口不透明度').press('Home');await expect.poll(()=>prep.evaluate(()=>(window as any).api.getSettings().then((s:any)=>s.opacity))).toBe(0);
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isAlwaysOnTop())!.getOpacity())).toBe(0);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isAlwaysOnTop())!.getOpacity())).toBe(1);
  const exit=new Promise<void>(r=>app.process().once('exit',()=>r()));await app.evaluate(({app})=>app.quit());await exit;
  app=await electron.launch({args:[boot]});await showOverlayPreview(app);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isAlwaysOnTop())!.getOpacity())).toBe(0);
  const settings=app.windows().find(p=>p.url().endsWith('#/prepare'))!;await settings.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_prepare'}));await openModelDetails(settings);
  await expect(settings.getByLabel('窗口不透明度')).toHaveValue('0');expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isAlwaysOnTop())!.getOpacity())).toBe(1);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
