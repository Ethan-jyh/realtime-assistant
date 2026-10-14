import {test,expect,vi} from 'vitest';
import {OverlayShortcuts} from '../src/main/window/shortcuts';
test('Option 左右与 Control Z 只在显示浮窗时注册，隐藏和退出立即释放',()=>{
 const actions=new Map<string,()=>void>();const opacity=vi.fn(),capture=vi.fn();
 const register=vi.fn((key:string,fn:()=>void)=>{actions.set(key,fn);return true;});const unregister=vi.fn((key:string)=>actions.delete(key));
 const keys=new OverlayShortcuts({register,unregister,opacity,capture,onFailure:vi.fn()});
 keys.setVisible(true);keys.setVisible(true);expect([...actions.keys()]).toEqual(['Alt+Left','Alt+Right','Control+Z']);expect(register).toHaveBeenCalledTimes(3);
 actions.get('Alt+Left')!();actions.get('Alt+Right')!();actions.get('Control+Z')!();expect(opacity.mock.calls).toEqual([[-0.1],[0.1]]);expect(capture).toHaveBeenCalledTimes(1);
 keys.setVisible(false);expect(actions.size).toBe(0);keys.setVisible(true);keys.dispose();expect(actions.size).toBe(0);
});
test('注册失败有提示且不释放其他软件已经占用的键',()=>{
 const unregister=vi.fn(),onFailure=vi.fn();const keys=new OverlayShortcuts({register:()=>false,unregister,opacity:vi.fn(),capture:vi.fn(),onFailure});
 keys.setVisible(true);expect(onFailure).toHaveBeenCalledTimes(3);keys.dispose();expect(unregister).not.toHaveBeenCalled();
});
