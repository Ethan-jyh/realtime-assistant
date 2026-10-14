import {electronTest} from './support/electron-test';
const test=electronTest('drag-regression.spec');
import {expect} from '@playwright/test';
import {launchTestApp} from './support/launch';
test('blank area drag moves window, buttons and inputs do not initiate drag',async()=>{
 const app=await launchTestApp();try{
  await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);
  const page=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
  const before=await page.evaluate(()=>(window as any).api.sendWindowCommand({action:'get_bounds',target:'overlay'}));
  const gesture=async(selector:string)=>page.evaluate(async({selector,x,y})=>{
   const element=document.querySelector(selector)!;
   element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,screenX:x+50,screenY:y+50}));
   await new Promise(r=>setTimeout(r,100));
   element.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,screenX:x-50,screenY:y+100}));
   element.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,screenX:x-50,screenY:y+100}));
  },{selector,x:before.bounds.x,y:before.bounds.y});
  await gesture('.shell');await expect.poll(async()=>((await page.evaluate(()=>(window as any).api.sendWindowCommand({action:'get_bounds',target:'overlay'}))).bounds.x)).toBe(before.bounds.x-100);
  const moved=await page.evaluate(()=>(window as any).api.sendWindowCommand({action:'get_bounds',target:'overlay'}));
  await gesture('button');await gesture('textarea');await page.waitForTimeout(150);
  const after=await page.evaluate(()=>(window as any).api.sendWindowCommand({action:'get_bounds',target:'overlay'}));expect(after.bounds).toEqual(moved.bounds);
 }finally{await app.close();}
});
