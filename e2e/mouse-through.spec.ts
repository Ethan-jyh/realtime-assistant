import {electronTest} from './support/electron-test';
const test=electronTest('mouse-through.spec');
import {expect,_electron as electron} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
test('Option press/release changes native mouse policy; failed watcher releases; preferences persist',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mouse-through-'));await mkdir(join(dir,'data'));const boot=join(dir,'boot.cjs');
 await writeFile(boot,`const E=require('electron');E.app.setPath('userData',${JSON.stringify(join(dir,'data'))});const original=E.BrowserWindow.prototype.setIgnoreMouseEvents;E.BrowserWindow.prototype.setIgnoreMouseEvents=function(ignore,opts){this.__ignoring=ignore;return original.call(this,ignore,opts);};const focus=E.BrowserWindow.prototype.setFocusable;E.BrowserWindow.prototype.setFocusable=function(value){this.__focusWrites=(this.__focusWrites||0)+1;return focus.call(this,value);};const blur=E.BrowserWindow.prototype.blur;E.BrowserWindow.prototype.blur=function(){this.__blurs=(this.__blurs||0)+1;return blur.call(this);};const position=E.BrowserWindow.prototype.setPosition;E.BrowserWindow.prototype.setPosition=function(...args){this.__moves=(this.__moves||0)+1;return position.apply(this,args);};const cp=require('node:child_process'),spawn=cp.spawn;cp.spawn=function(file,...args){if(!file.endsWith('option-modifier'))return spawn.call(this,file,...args);const c=new (require('node:events').EventEmitter)();c.stdout=new (require('node:stream').PassThrough)();c.kill=()=>c.emit('exit',0);global.testModifier=c;queueMicrotask(()=>c.stdout.write('0\\n'));return c;};require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
 const app=await electron.launch({args:[boot]});try{
  const prep=await app.firstWindow();await prep.waitForFunction(()=>typeof (window as any).api?.sendWindowCommand==='function');await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_overlay'}));await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);const overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
  const native=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({overlay:w.webContents.getURL().endsWith('#/overlay'),ignoring:(w as any).__ignoring??false,focusable:w.isFocusable(),focusWrites:(w as any).__focusWrites||0,blurs:(w as any).__blurs||0,moves:(w as any).__moves||0})));
  await expect.poll(async()=>(await native()).find(x=>x.overlay)?.ignoring).toBe(true);expect((await native()).find(x=>!x.overlay)?.ignoring).toBe(false);
  const beforeOption=(await native()).find(x=>x.overlay)!;
  await app.evaluate(()=>{(globalThis as any).testModifier.stdout.write('1\n');});await expect.poll(async()=>(await native()).find(x=>x.overlay)?.ignoring).toBe(false);expect((await native()).find(x=>x.overlay)?.focusable).toBe(true);
  const bounds=(await overlay.evaluate(()=>(window as any).api.sendWindowCommand({action:'get_bounds',target:'overlay'}))).bounds;
  await overlay.evaluate(b=>document.querySelector('.shell')!.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,screenX:b.x+20,screenY:b.y+20})),bounds);
  await expect.poll(()=>overlay.evaluate(async()=>(await (window as any).api.sendWindowCommand({action:'get_mouse_mode'})).dragging)).toBe(true);
  await overlay.evaluate(b=>{for(let i=0;i<=150;i++)document.querySelector('.shell')!.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,screenX:b.x+20-i*100/150,screenY:b.y+20+i*40/150}));},bounds);
  await app.evaluate(()=>{(globalThis as any).testModifier.stdout.write('0\n');});
  const heldDrag=await overlay.evaluate(()=>(window as any).api.sendWindowCommand({action:'get_mouse_mode'}));expect(heldDrag.held).toBe(false);expect(heldDrag.ignoring).toBe(false);
  await overlay.evaluate(b=>document.querySelector('.shell')!.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,screenX:b.x-80,screenY:b.y+60})),bounds);
  await expect.poll(async()=>(await native()).find(x=>x.overlay)?.ignoring).toBe(true);
  const end=(await overlay.evaluate(()=>(window as any).api.sendWindowCommand({action:'get_bounds',target:'overlay'}))).bounds;expect(end).toEqual({...bounds,x:bounds.x-100,y:bounds.y+40});
  const afterOption=(await native()).find(x=>x.overlay)!;expect(afterOption.focusWrites).toBe(beforeOption.focusWrites);expect(afterOption.blurs).toBe(beforeOption.blurs);expect(afterOption.moves-beforeOption.moves).toBeLessThanOrEqual(3);
  await app.evaluate(()=>{(globalThis as any).testModifier.emit('exit',1);});await expect.poll(async()=>(await native()).find(x=>x.overlay)?.ignoring).toBe(false);
  await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'set_mouse_through',enabled:false}));expect(JSON.parse(await readFile(join(dir,'data','assistant-settings.json'),'utf8')).mouseThrough).toBe(false);
  await expect(overlay.getByRole('button',{name:'穿透：关',exact:true})).toBeVisible();
  await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'set_mouse_through',enabled:true}));await expect.poll(async()=>(await native()).find(x=>x.overlay)?.ignoring).toBe(true);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});


test('穿透快捷键切换不隐藏、不重载、不更换原生窗口',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mouse-toggle-'));await mkdir(join(dir,'data'));const boot=join(dir,'boot.cjs');
 await writeFile(boot,`const E=require('electron');E.app.setPath('userData',${JSON.stringify(join(dir,'data'))});global.hotkeys={};for(const method of ['show','showInactive','hide','close','destroy','loadURL','loadFile','blur','setFocusable']){const original=E.BrowserWindow.prototype[method];E.BrowserWindow.prototype[method]=function(...args){if(this.__tracking)this.__calls.push(method);return original.apply(this,args);};}const register=E.globalShortcut.register;E.globalShortcut.register=function(key,fn){global.hotkeys[key]=fn;return register.call(this,key,fn);};require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
 const app=await electron.launch({args:[boot]});try{
  const prep=await app.firstWindow();await expect.poll(()=>prep.evaluate(()=>typeof (window as any).api?.sendWindowCommand)).toBe('function');
  await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'set_mouse_through',enabled:false}));
  await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_overlay'}));
  await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);const overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
  await expect.poll(()=>overlay.evaluate(()=>typeof (window as any).api?.sendWindowCommand)).toBe('function');
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#/overlay'))?.isVisible())).toBe(true);
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#/overlay'))!;(w as any).__tracking=true;(w as any).__calls=[];(w as any).__events=[];for(const event of ['hide','closed'])w.on(event,()=>((w as any).__events).push(event));w.webContents.on('did-start-loading',()=>((w as any).__events).push('load'));(w as any).__handle=w.getNativeWindowHandle().toString('hex');});
  for(let i=0;i<4;i++){await overlay.evaluate(enabled=>(window as any).api.sendWindowCommand({action:'set_mouse_through',enabled}),i%2===0);}
  const result=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#/overlay'))!;return {events:(w as any).__events,calls:(w as any).__calls,visible:w.isVisible(),sameHandle:(w as any).__handle===w.getNativeWindowHandle().toString('hex')};});
  expect(result).toEqual({events:[],calls:[],visible:true,sameHandle:true});
  expect(await app.evaluate(({globalShortcut})=>globalShortcut.isRegistered('`'))).toBe(true);
  await app.evaluate(()=>{(globalThis as any).hotkeys['`']();});
  await expect.poll(()=>overlay.evaluate(async()=>(await (window as any).api.sendWindowCommand({action:'get_mouse_mode'})).enabled)).toBe(true);
  await app.evaluate(()=>{(globalThis as any).hotkeys['`']();});
  await expect.poll(()=>overlay.evaluate(async()=>(await (window as any).api.sendWindowCommand({action:'get_mouse_mode'})).enabled)).toBe(false);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
