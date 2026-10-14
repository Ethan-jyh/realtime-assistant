import { expect, test } from 'vitest';

test('测试运行器支持取消请求所需环境', () => {
  const controller = new AbortController();
  controller.abort();
  expect(controller.signal.aborted).toBe(true);
  expect(typeof TextDecoder).toBe('function');
});
