import {electronTest} from './support/electron-test';
const test=electronTest('compositing.spec');
import {expect} from '@playwright/test';import {launchTestApp} from './support/launch';
test('transparent windows have no native shadow and no backdrop blur',async()=>{
 const app=await launchTestApp();try{await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);
 expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.hasShadow()))).toEqual([false,false]);
 for(const page of app.windows())expect(await page.locator('.glass').evaluate(el=>getComputedStyle(el).backdropFilter)).toBe('none');
 }finally{await app.close();}
});
