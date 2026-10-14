import {electronTest} from './support/electron-test';
const test=electronTest('minimal-ui.spec');
import {expect} from '@playwright/test';
import {launchTestApp} from './support/launch';
test('首页仅保留场景入口，三个入口直达准备页且不自动启动采集',async()=>{
 const app=await launchTestApp({previewOverlay:false});try{
  const page=await app.firstWindow();await expect.poll(()=>page.evaluate(()=>typeof (window as any).api?.saveSettings)).toBe('function');
  await page.evaluate(()=>(window as any).api.saveSettings({model:{baseUrl:'http://127.0.0.1:9/v1',modelName:'synthetic',apiKey:'synthetic'}}));
  await page.getByRole('button',{name:'← 返回选择',exact:true}).click();
  await expect(page.getByRole('button',{name:'设置并开始',exact:true})).toHaveCount(0);
  await expect(page.locator('.mode-card')).toHaveCount(3);
  await page.screenshot({path:'/private/tmp/realtime-assistant-plan/ui-home-0.2.7.png'});
  await expect(page.locator('body')).not.toContainText('自有 API');await expect(page.locator('body')).not.toContainText('本地保存');await expect(page.locator('body')).not.toContainText('DeepSeek');
  for(const name of ['开始面试','学术面试','截图问答']){
   await page.getByRole('button',{name,exact:true}).click();await expect(page.getByLabel('自定义提示词',{exact:true})).toBeVisible();
   expect((await page.evaluate(()=>(window as any).api.getSession())).state).toBe('idle');
   if(name==='开始面试')await page.screenshot({path:'/private/tmp/realtime-assistant-plan/ui-prepare-0.2.7.png'});
   await page.getByRole('button',{name:'← 返回选择',exact:true}).click();
  }
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.screenshot({path:'/private/tmp/realtime-assistant-plan/ui-settings-0.2.7.png'});
 }finally{await app.close();}
});
