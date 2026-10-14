import {electronTest} from './support/electron-test';
const test=electronTest('answer-retention.spec');
import {expect} from '@playwright/test';import {launchTestApp} from './support/launch';
test('new answer keeps earlier question and answer cards throughout generation',async()=>{
 const app=await launchTestApp();try{await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);const page=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
 const emit=async(event:any)=>app.evaluate(({BrowserWindow},e)=>{for(const w of BrowserWindow.getAllWindows())w.webContents.send('answer.event',e);},event);
 await emit({status:{state:'started',requestId:'first',question:'第一个问题'}});await emit({text:'上一条完整回答',status:{state:'streaming',requestId:'first'}});await emit({status:{state:'completed',requestId:'first',finishReason:'stop'}});await expect(page.locator('.answer-panel:not(.deep-panel) .overlay-answer')).toContainText('上一条完整回答');
 await emit({status:{state:'started',requestId:'second',question:'第二个问题'}});await expect(page.locator('.answer-panel:not(.deep-panel) .overlay-answer')).toContainText('上一条完整回答');
 await emit({text:'新回答',status:{state:'streaming',requestId:'second'}});await expect(page.locator('.answer-panel:not(.deep-panel) .overlay-answer')).toContainText('新回答');await expect(page.locator('.answer-panel:not(.deep-panel) .overlay-answer')).toContainText('上一条完整回答');
 await expect(page.locator('.answer-card')).toHaveCount(2);
 await expect(page.locator('[data-request-id=first]')).toContainText('第一个问题');await expect(page.locator('[data-request-id=first]')).toContainText('上一条完整回答');
 await expect(page.locator('[data-request-id=second]')).toContainText('第二个问题');await expect(page.locator('[data-request-id=second]')).toContainText('新回答');
 await emit({text:'的第二段',status:{state:'streaming',requestId:'second'}});
 await expect(page.locator('[data-request-id=second]')).toContainText('新回答的第二段');await expect(page.locator('[data-request-id=first]')).not.toContainText('新回答');
 await emit({text:'迟到内容',status:{state:'streaming',requestId:'first'}});
 await expect(page.locator('.answer-panel:not(.deep-panel) .overlay-answer')).not.toContainText('迟到内容');
 }finally{await app.close();}
});

test('answer panel follows latest output and preserves an earlier reading position until requested',async()=>{
 const app=await launchTestApp();try{
  await expect.poll(()=>app.windows().some(p=>p.url().endsWith('#/overlay'))).toBe(true);const page=app.windows().find(p=>p.url().endsWith('#/overlay'))!;
  const emit=async(event:any)=>app.evaluate(({BrowserWindow},e)=>{for(const w of BrowserWindow.getAllWindows())w.webContents.send('answer.event',e);},event);
  const panel=page.locator('.answer-panel:not(.deep-panel) .overlay-answer');
  const bottomGap=()=>panel.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop);
  await emit({status:{state:'started',requestId:'long-old',question:'较长的旧问题'}});
  await emit({text:Array.from({length:80},(_,i)=>`旧回答第 ${i+1} 段。`).join('\n\n'),status:{state:'streaming',requestId:'long-old'}});
  await emit({status:{state:'completed',requestId:'long-old',finishReason:'stop'}});
  await expect.poll(()=>panel.evaluate(node=>node.scrollHeight>node.clientHeight+100)).toBe(true);
  await expect.poll(bottomGap).toBeLessThanOrEqual(1);
  await emit({status:{state:'started',requestId:'latest',question:'最新问题'}});
  await emit({text:'最新回答开头',status:{state:'streaming',requestId:'latest'}});
  await expect(page.locator('[data-request-id=latest]')).toContainText('最新回答开头');
  await expect.poll(bottomGap).toBeLessThanOrEqual(1);
  await expect.poll(()=>panel.evaluate(node=>{const card=node.querySelector('[data-request-id=latest]')!;return card.getBoundingClientRect().bottom<=node.getBoundingClientRect().bottom&&card.getBoundingClientRect().bottom>node.getBoundingClientRect().top;})).toBe(true);
  await panel.evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'));});
  await expect(page.getByRole('button',{name:'查看最新回答'})).toBeVisible();
  const readingPosition=await panel.evaluate(node=>node.scrollTop);
  await emit({text:'\n\n最新回答补充内容',status:{state:'streaming',requestId:'latest'}});
  await expect(page.locator('[data-request-id=latest]')).toContainText('最新回答补充内容');
  await expect.poll(()=>panel.evaluate(node=>node.scrollTop)).toBe(readingPosition);
  expect(await bottomGap()).toBeGreaterThan(100);
  await page.getByRole('button',{name:'查看最新回答'}).click();
  await expect.poll(bottomGap).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button',{name:'查看最新回答'})).toHaveCount(0);
  await emit({text:'\n\n继续跟随的新内容',status:{state:'streaming',requestId:'latest'}});
  await expect(page.locator('[data-request-id=latest]')).toContainText('继续跟随的新内容');
  await expect.poll(bottomGap).toBeLessThanOrEqual(1);
 }finally{await app.close();}
});
