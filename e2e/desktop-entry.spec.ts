import {electronTest} from './support/electron-test';
const test=electronTest('desktop-entry.spec');
import {expect,_electron as electron} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {once} from 'node:events';
test('程序坞隐藏，最小化不留下窗口缩略图，菜单栏恢复窗口，X保存并完全退出',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'desktop-entry-'));const data=join(dir,'data');await mkdir(data);const boot=join(dir,'main.cjs');
 await writeFile(boot,`const E=require('electron');E.app.setPath('userData',${JSON.stringify(data)});const set=E.Tray.prototype.setContextMenu;E.Tray.prototype.setContextMenu=function(menu){global.desktopMenu=menu;return set.call(this,menu);};require(${JSON.stringify(resolve(__dirname,'../out/main/index.js'))});`);
 const app=await electron.launch({args:[boot]});let closed=false;
 try{
  const prep=await app.firstWindow();await expect.poll(()=>prep.evaluate(()=>typeof (window as any).api?.getSession)).toBe('function');
  expect(await app.evaluate(({app})=>app.dock.isVisible())).toBe(false);
  const visible=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.isVisible()&&!w.isMinimized()).map(w=>w.webContents.getURL().split('#')[1]));
  const click=async(id:string)=>app.evaluate((_,id)=>{const menu=(globalThis as any).desktopMenu,item=menu?.getMenuItemById(id);if(!item)throw Error('TRAY_ACTION_MISSING:'+id);item.click(item,null,{shiftKey:false,ctrlKey:false,altKey:false,metaKey:false});},id);
  await prep.getByRole('button',{name:'最小化',exact:true}).click();await expect.poll(visible).toEqual([]);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isMinimized()))).toBe(false);await click('show');
  await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_overlay'}));await expect.poll(visible).toEqual(['/overlay']);
  await click('hide');await expect.poll(visible).toEqual([]);await click('show');await expect.poll(visible).toEqual(['/overlay']);
  await click('settings');await expect.poll(visible).toEqual(['/prepare']);
  await click('hide');await expect.poll(visible).toEqual([]);await click('show');await expect.poll(visible).toEqual(['/prepare']);
  const session=await prep.evaluate(()=>(window as any).api.startSession({sources:['microphone'],form:{audioEnabled:false},recordAudio:false}));
  const overlay=app.windows().find(p=>p.url().endsWith('#/overlay'))!;await overlay.getByRole('button',{name:'最小化浮窗',exact:true}).click();await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#/overlay'))?.isVisible())).toBe(false);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isMinimized()))).toBe(false);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isMinimizable()))).toBe(false);
  await click('show');await expect.poll(visible).toEqual(['/overlay']);expect(await overlay.evaluate(()=>(window as any).api.getSession().then((s:any)=>s.id))).toBe(session.id);
  const exit=once(app.process(),'exit');await overlay.getByRole('button',{name:'完全退出',exact:true}).click();await exit;closed=true;
  const record=JSON.parse(await readFile(join(data,'sessions',session.id,'session.json'),'utf8'));expect(record.state).toBe('stopped');
 }finally{if(!closed)await app.close();await rm(dir,{recursive:true,force:true});}
});
