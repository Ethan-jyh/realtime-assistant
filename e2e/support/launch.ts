import {_electron as electron,expect,type ElectronApplication} from '@playwright/test';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
export async function launchTestApp({previewOverlay=true}:{previewOverlay?:boolean}={}){
 const dir=await mkdtemp(join(tmpdir(),'isolated-app-'));await mkdir(join(dir,'data'));const boot=join(dir,'main.cjs');
 await writeFile(boot,`require('electron').app.setPath('userData',${JSON.stringify(join(dir,'data'))});require(${JSON.stringify(resolve(__dirname,'../../out/main/index.js'))});`);
 const app=await electron.launch({args:[boot],executablePath:process.env.ASSISTANT_ELECTRON_PATH});
 if(previewOverlay){try{await showOverlayPreview(app);}catch(e){await app.close();await rm(dir,{recursive:true,force:true});throw e;}}
 app.once('close',()=>{void rm(dir,{recursive:true,force:true});});return app;
}

export async function showOverlayPreview(app:ElectronApplication){
 await app.firstWindow();await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/prepare'))).toBe(true);const prep=app.windows().find(p=>p.url().endsWith('#/prepare'))!;await expect.poll(()=>prep.evaluate(()=>typeof (window as any).api?.sendWindowCommand)).toBe('function');await prep.evaluate(()=>(window as any).api.sendWindowCommand({action:'show_overlay'}));
}

/** Existing detail-form regressions now explicitly enter the active scheme editor. */
export async function openModelDetails(page:import('@playwright/test').Page){
 await page.getByRole('heading',{name:/^(回答方案|模型配置与手动提问)$/}).first().waitFor();
 if(await page.getByRole('heading',{name:'回答方案',exact:true}).count()){
  await page.locator('.provider-card.selected').getByRole('button',{name:/^编辑 /}).click();
 }
 await page.getByRole('heading',{name:'模型配置与手动提问',exact:true}).waitFor();
}
