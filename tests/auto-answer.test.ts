import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {AutoAnswerQueue} from '../src/main/runtime/auto-answer';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

test('quick independent finals remain in a numbered batch', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('A', 'a'); vi.advanceTimersByTime(400); queue.offer('B', 'b');
 vi.advanceTimersByTime(899); expect(run).not.toHaveBeenCalled();
 vi.advanceTimersByTime(1);
 expect(run).toHaveBeenCalledWith('1. A\n2. B', [{id:'a',text:'A'},{id:'b',text:'B'}], expect.any(String));
 expect(queue.snapshot).toEqual([]);
});

test('busy answers retain all new finals and start promptly after completion', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('first', 'first'); vi.advanceTimersByTime(900);
 queue.offer('A', 'a'); queue.offer('B', 'b'); vi.advanceTimersByTime(3000);
 expect(run).toHaveBeenCalledTimes(1);
 expect(queue.snapshot).toEqual([{id:'a',text:'A'},{id:'b',text:'B'}]);
 queue.completed(); vi.advanceTimersByTime(0);
 expect(run).toHaveBeenCalledTimes(2);
 expect(run.mock.calls[1][0]).toBe('1. A\n2. B');
 expect(run.mock.calls[1][2]).not.toBe(run.mock.calls[0][2]);
});

test('not ready retains pending finals until completion makes submission possible', () => {
 let ready = false; const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => ready);
 queue.offer('A','a'); vi.advanceTimersByTime(900);
 expect(run).not.toHaveBeenCalled(); expect(queue.snapshot).toEqual([{id:'a',text:'A'}]);
 ready = true; queue.completed(); vi.advanceTimersByTime(0);
 expect(run).toHaveBeenCalledTimes(1);
});

test('continued provisional speech blocks premature answers until its final arrives', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('A','a'); vi.advanceTimersByTime(600); queue.speech('b');
 vi.advanceTimersByTime(700); queue.speech('b'); vi.advanceTimersByTime(1500);
 expect(run).not.toHaveBeenCalled(); queue.offer('B','b');
 vi.advanceTimersByTime(899); expect(run).not.toHaveBeenCalled(); vi.advanceTimersByTime(1);
 expect(run.mock.calls[0][0]).toBe('1. A\n2. B');
});

test('duplicate final IDs never cause a second answer or replace original text', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('A','a'); queue.offer('different','a'); vi.advanceTimersByTime(900);
 expect(run.mock.calls[0][1]).toEqual([{id:'a',text:'A'}]);
 queue.speech('a'); queue.offer('A','a'); queue.completed(); vi.advanceTimersByTime(10000);
 expect(run).toHaveBeenCalledTimes(1);
});

test('clear cancels finals and provisional activity and permits reusing IDs', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('cancelled','a'); queue.speech('b'); queue.clear();
 vi.advanceTimersByTime(10000); expect(run).not.toHaveBeenCalled(); expect(queue.snapshot).toEqual([]);
 queue.offer('new','a'); vi.advanceTimersByTime(900); expect(run.mock.calls[0][0]).toBe('new');
});

test('stalled provisional activity is bounded without answering an incomplete batch', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('A','a'); queue.speech('b'); vi.advanceTimersByTime(8000);
 expect(run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
 expect(queue.snapshot).toEqual([{id:'a',text:'A'}]);
 queue.offer('B','b'); vi.advanceTimersByTime(900); expect(run.mock.calls[0][0]).toBe('1. A\n2. B');
});

test('multiple provisional IDs must each finish and anonymous activity resolves on offer', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.speech('a'); queue.speech('b'); queue.offer('A','a'); vi.advanceTimersByTime(900);
 expect(run).not.toHaveBeenCalled(); queue.offer('B','b'); vi.advanceTimersByTime(900);
 expect(run.mock.calls[0][0]).toBe('1. A\n2. B');
 queue.completed(); queue.speech(); queue.offer('C'); vi.advanceTimersByTime(900);
 expect(run.mock.calls[1][0]).toBe('C');
});

test('snapshot cannot mutate pending entries and equal text with distinct IDs is preserved', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('same','a'); queue.offer('same','b'); const snapshot = queue.snapshot;
 snapshot[0].text='changed'; snapshot.pop(); vi.advanceTimersByTime(900);
 expect(run.mock.calls[0][1]).toEqual([{id:'a',text:'same'},{id:'b',text:'same'}]);
});

test('synchronous submission failure retains the batch and retries only explicitly', () => {
 let failed = true; const calls:string[] = []; const queue = new AutoAnswerQueue((text) => {
  calls.push(text); if (failed) throw new Error('submission failed');
 }, () => true);
 queue.offer('A','a'); vi.advanceTimersByTime(900); vi.advanceTimersByTime(20000);
 expect(calls).toEqual(['A']); expect(queue.snapshot).toEqual([{id:'a',text:'A'}]);
 expect(vi.getTimerCount()).toBe(0); failed = false; queue.retry(); vi.advanceTimersByTime(0);
 expect(calls).toEqual(['A','A']);
});

test('requeue restores active originals ahead of new corrections and waits for completion', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('original','a'); vi.advanceTimersByTime(900);
 queue.offer('correction','b'); queue.requeue([{id:'a',text:'original'}]);
 vi.advanceTimersByTime(900); expect(run).toHaveBeenCalledTimes(1);
 expect(queue.snapshot).toEqual([{id:'a',text:'original'},{id:'b',text:'correction'}]);
 queue.completed(); vi.advanceTimersByTime(0);
 expect(run.mock.calls[1][0]).toBe('1. original\n2. correction');
});

test('discard removes a pending final or resolves a deleted provisional segment', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('keep','a'); queue.offer('deleted','b'); queue.speech('c');
 queue.discard('b'); queue.discard('c'); vi.advanceTimersByTime(900);
 expect(run.mock.calls[0][1]).toEqual([{id:'a',text:'keep'}]);
});

test('a single final preserves its exact question text', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('Explain closures?', 'a'); vi.advanceTimersByTime(900);
 expect(run).toHaveBeenCalledWith('Explain closures?', [{id:'a',text:'Explain closures?'}], expect.any(String));
});

test('suspend preserves finals and resolves abandoned provisional activity before retry', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('saved','a'); queue.speech('abandoned'); queue.speech(); queue.suspend();
 vi.advanceTimersByTime(20000); expect(run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
 expect(queue.snapshot).toEqual([{id:'a',text:'saved'}]);
 queue.retry(); vi.advanceTimersByTime(0);
 expect(run.mock.calls[0][0]).toBe('saved');
 queue.completed(); queue.offer('duplicate','a'); vi.advanceTimersByTime(900);
 expect(run).toHaveBeenCalledTimes(1);
});

test('suspend does not release a busy answer before completed', () => {
 const run = vi.fn(); const queue = new AutoAnswerQueue(run, () => true);
 queue.offer('active','a'); vi.advanceTimersByTime(900); queue.offer('saved','b'); queue.speech('c');
 queue.suspend(); queue.retry(); vi.advanceTimersByTime(20000); expect(run).toHaveBeenCalledTimes(1);
 queue.completed(); vi.advanceTimersByTime(0);
 expect(run.mock.calls[1][0]).toBe('saved');
});
