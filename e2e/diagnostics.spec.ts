import {electronTest} from './support/electron-test';
const test=electronTest('diagnostics.spec');
import {expect} from '@playwright/test';import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {launchTestApp} from './support/launch';
test('diagnostics are persisted with reload and session events, excluding private content',async()=>{
 const app=await launchTestApp({previewOverlay:false});try{
  const page=await app.firstWindow();await page.getByRole('button',{name:'窗口与日志',exact:true}).click();await expect(page.getByRole('button',{name:'打开日志目录',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).api.saveSettings({profile:{customPrompt:'PRIVATE_TEST_PROMPT'}}));
  await page.evaluate(()=>(window as any).api.startSession({sources:['microphone'],form:{audioEnabled:false},recordAudio:false}));await page.evaluate(()=>(window as any).api.stopSession());
  const {directory}=await page.evaluate(()=>(window as any).api.diagnostics('get'));
  const content=await readFile(join(directory,'diagnostics.log'),'utf8');expect(content).not.toContain('PRIVATE_TEST_PROMPT');
  const events=content.trim().split('\n').map(line=>JSON.parse(line).event);expect(events).toContain('app.started');expect(events).toContain('renderer.load_end');expect(events).toContain('session.state');
 }finally{await app.close();}
});
