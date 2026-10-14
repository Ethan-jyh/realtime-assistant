import {electronTest} from './support/electron-test';
const test=electronTest('window.spec');
import { expect } from '@playwright/test';
import {launchTestApp} from './support/launch';

test('两个本地窗口加载后，浮窗失焦可见且调整尺寸保留实例', async () => {
  const app=await launchTestApp();
  try {
    await app.firstWindow();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const wins=BrowserWindow.getAllWindows();
      return wins.length === 2 && wins.filter(w=>w.isVisible()).length===1 && wins.every(w=>!w.webContents.isLoading());
    })).toBe(true);
    const info=await app.evaluate(({ BrowserWindow }) => {
      const wins=BrowserWindow.getAllWindows();
      const overlay=wins.find(w=>w.webContents.getURL().endsWith('#/overlay'))!;
      const id=overlay.id;
      overlay.blur();
      const bounds=overlay.getBounds();
      overlay.setBounds({...bounds,width:320,height:80});
      return {count:wins.length, visible:overlay.isVisible(), top:overlay.isAlwaysOnTop(),
        protected:overlay.isContentProtected(), idPreserved:id===overlay.id,
        localPages:wins.every(w=>w.webContents.getURL().startsWith('file:'))};
    });
    expect(info).toEqual({count:2,visible:true,top:true,protected:true,idPreserved:true,localPages:true});
  } finally { await app.close(); }
});
