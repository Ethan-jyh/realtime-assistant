import { expect, test } from 'vitest';
import { SseDecoder } from '../src/main/providers/model/sse';

test('中文跨字节与 CRLF 分隔仍正确', () => {
  const got: string[] = [];
  const parser = new SseDecoder((x) => got.push(x));
  const bytes = new TextEncoder().encode('data: 中文\r\n\r\n');
  for (const byte of bytes) parser.push(new Uint8Array([byte]));
  parser.end();
  expect(got).toEqual(['中文']);
});

test('多行 data 按换行拼接，注释被忽略', () => {
  const got: string[] = [];
  const parser = new SseDecoder((x) => got.push(x));
  const raw = ': ping comment\ndata: line 1\n: comment 2\ndata: line 2\n\n';
  parser.push(new TextEncoder().encode(raw));
  parser.end();
  expect(got).toEqual(['line 1\nline 2']);
});

test('CRLF 跨分块被正确合并', () => {
  const got: string[] = [];
  const parser = new SseDecoder((x) => got.push(x));
  parser.push(new TextEncoder().encode('data: hello\r'));
  parser.push(new TextEncoder().encode('\n\r\n'));
  parser.end();
  expect(got).toEqual(['hello']);
});

test('无最终空行分隔符的未完成事件不能派发', () => {
  const got: string[] = [];
  const parser = new SseDecoder((x) => got.push(x));
  parser.push(new TextEncoder().encode('data: partial event'));
  parser.end();
  expect(got).toEqual([]);
});

test('孤立 CR 在 end 时能正确截断行', () => {
  const got: string[] = [];
  const parser = new SseDecoder((x) => got.push(x));
  parser.push(new TextEncoder().encode('data: foo\r\r'));
  parser.end();
  expect(got).toEqual(['foo']);
});

test('pending 超限抛出 PROTOCOL_LIMIT', () => {
  const parser = new SseDecoder(() => {});
  const hugeChunk = new Uint8Array(1024 * 1024 + 10);
  expect(() => parser.push(hugeChunk)).toThrow('PROTOCOL_LIMIT');
});

test('单事件数据超过 1 MB 抛出 PROTOCOL_LIMIT', () => {
  const parser = new SseDecoder(() => {});
  const prefix = new TextEncoder().encode('data: ' + 'x'.repeat(1024 * 1024 + 5) + '\n');
  expect(() => parser.push(prefix)).toThrow('PROTOCOL_LIMIT');
});
