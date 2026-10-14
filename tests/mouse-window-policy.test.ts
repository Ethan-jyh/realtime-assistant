import {expect,test,vi} from 'vitest';
vi.mock('electron',()=>({BrowserWindow:class{},screen:{},globalShortcut:{}}));
import {WindowManager} from '../src/main/window/manager';
test('启用穿透不主动 blur 或重新显示当前浮窗',()=>{
 const win={isDestroyed:()=>false,isFocused:()=>true,setIgnoreMouseEvents:vi.fn(),setFocusable:vi.fn(),blur:vi.fn(),hide:vi.fn(),show:vi.fn()};
 const manager=new WindowManager({preloadPath:'/test'});(manager as any).overlayWindow=win;
 manager.setMouseIgnoring(true,true);manager.setMouseIgnoring(false,false);
 expect(win.setIgnoreMouseEvents.mock.calls.map(args=>args[0])).toEqual([true,false]);
 expect(win.setFocusable).not.toHaveBeenCalled();expect(win.blur).not.toHaveBeenCalled();expect(win.hide).not.toHaveBeenCalled();expect(win.show).not.toHaveBeenCalled();
});
