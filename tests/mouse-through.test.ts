import {test,expect,vi} from 'vitest';import {MouseThrough} from '../src/main/window/mouse-through';
test('pass-through until Option held; release restores; disabled stays clickable',()=>{
 vi.useFakeTimers();const apply=vi.fn();const mode=new MouseThrough(apply);mode.enable(true);expect(mode.state.ignoring).toBe(false);
 mode.pulse(false);expect(mode.state.ignoring).toBe(true);mode.pulse(true);expect(mode.state.ignoring).toBe(false);mode.pulse(false);expect(mode.state.ignoring).toBe(true);
 mode.enable(false);expect(mode.state.ignoring).toBe(false);mode.pulse(false);expect(mode.state.ignoring).toBe(false);mode.dispose();vi.useRealTimers();
});
test('missing heartbeat or helper failure always restores mouse access',()=>{
 vi.useFakeTimers();const mode=new MouseThrough(()=>{});mode.enable(true);mode.pulse(false);expect(mode.state.ignoring).toBe(true);vi.advanceTimersByTime(3100);expect(mode.state.ignoring).toBe(false);expect(mode.state.available).toBe(false);
 mode.pulse(false);expect(mode.state.ignoring).toBe(true);mode.failed();expect(mode.state.ignoring).toBe(false);mode.dispose();vi.useRealTimers();
});
test('releasing Option during a drag waits until drag completion before passing mouse through',()=>{
 vi.useFakeTimers();const mode=new MouseThrough(()=>{});mode.enable(true);mode.pulse(true);mode.setDragging(true);mode.pulse(false);expect(mode.state.ignoring).toBe(false);mode.setDragging(false);expect(mode.state.ignoring).toBe(true);mode.dispose();vi.useRealTimers();
});
test('lost drag completion expires safely and watcher failure cancels drag lease',()=>{
 vi.useFakeTimers();const mode=new MouseThrough(()=>{});mode.enable(true);mode.pulse(true);mode.setDragging(true);mode.pulse(false);
 for(let i=0;i<31;i++){vi.advanceTimersByTime(1000);mode.pulse(false);}
 expect(mode.state.dragging).toBe(false);expect(mode.state.ignoring).toBe(true);mode.setDragging(true);mode.failed();expect(mode.state.dragging).toBe(false);expect(mode.state.ignoring).toBe(false);mode.dispose();vi.useRealTimers();
});
