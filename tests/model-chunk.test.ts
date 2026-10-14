import { expect, test } from 'vitest';
import { decodeChunk } from '../src/main/providers/model/chunk';

test('标准 delta、空 usage 与 DONE', () => {
  expect(decodeChunk('{"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}'))
    .toEqual({ text: '你好', finish: null });
  expect(decodeChunk('{"choices":[],"usage":{"total_tokens":3}}')).toEqual({ text: '', finish: null });
  expect(decodeChunk('[DONE]')).toEqual({ text: '', finish: 'done' });
});

test('role-only delta 返回空字符串且 finish 为 null', () => {
  expect(decodeChunk('{"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}'))
    .toEqual({ text: '', finish: null });
});

test('finish_reason 映射 stop/length/content_filter', () => {
  expect(decodeChunk('{"choices":[{"delta":{},"finish_reason":"stop"}]}'))
    .toEqual({ text: '', finish: 'stop' });
  expect(decodeChunk('{"choices":[{"delta":{},"finish_reason":"length"}]}'))
    .toEqual({ text: '', finish: 'length' });
  expect(decodeChunk('{"choices":[{"delta":{},"finish_reason":"content_filter"}]}'))
    .toEqual({ text: '', finish: 'content_filter' });
});

test('tool_calls 输出抛出 UNSUPPORTED_OUTPUT', () => {
  expect(() =>
    decodeChunk('{"choices":[{"delta":{"tool_calls":[{"function":{"name":"search"}}]},"finish_reason":null}]}')
  ).toThrow('UNSUPPORTED_OUTPUT: tool_calls');

  expect(() =>
    decodeChunk('{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}')
  ).toThrow('UNSUPPORTED_OUTPUT: tool_calls');
});

test('服务端返回 error 对象时抛出 PROVIDER_ERROR', () => {
  expect(() =>
    decodeChunk('{"error":{"message":"Rate limit reached","type":"rate_limit_error"}}')
  ).toThrow('PROVIDER_ERROR: Rate limit reached');
});

test('非法 JSON 抛出 INVALID_JSON', () => {
  expect(() => decodeChunk('this is not json')).toThrow('INVALID_JSON');
});

test('非字符串 content 抛出 INVALID_CONTENT', () => {
  expect(() =>
    decodeChunk('{"choices":[{"delta":{"content":12345},"finish_reason":null}]}')
  ).toThrow('INVALID_CONTENT');
});
