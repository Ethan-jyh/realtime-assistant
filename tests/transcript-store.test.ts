import { expect, test } from 'vitest';
import { putSegment, Segment } from '../src/main/transcript/store';

test('修订替换同片段，正常重复句保留', () => {
  const rows = new Map<string, Segment>();
  const base = { sourceId: 'microphone' as const, streamEpoch: 1, revision: 0, isFinal: false };
  putSegment(rows, { ...base, segmentId: 'a', text: '数' });
  putSegment(rows, { ...base, segmentId: 'a', revision: 1, text: '数组', isFinal: true });
  putSegment(rows, { ...base, segmentId: 'b', text: '数组', isFinal: true });
  expect([...rows.values()].map((x) => x.text)).toEqual(['数组', '数组']);
});

test('不同 source 和不同 epoch 视为独立片段', () => {
  const rows = new Map<string, Segment>();
  putSegment(rows, { sourceId: 'microphone', streamEpoch: 1, segmentId: 'seg-1', revision: 0, text: '麦克风', isFinal: true });
  putSegment(rows, { sourceId: 'system', streamEpoch: 1, segmentId: 'seg-1', revision: 0, text: '系统音', isFinal: true });
  putSegment(rows, { sourceId: 'microphone', streamEpoch: 2, segmentId: 'seg-1', revision: 0, text: '重连后', isFinal: true });

  expect(rows.size).toBe(3);
  expect([...rows.values()].map((x) => x.text)).toEqual(['麦克风', '系统音', '重连后']);
});

test('倒序到达的旧 revision 被忽略', () => {
  const rows = new Map<string, Segment>();
  putSegment(rows, { sourceId: 'microphone', streamEpoch: 1, segmentId: 'seg-1', revision: 2, text: '最新', isFinal: false });
  const result = putSegment(rows, { sourceId: 'microphone', streamEpoch: 1, segmentId: 'seg-1', revision: 1, text: '过期', isFinal: false });

  expect(result).toBe(false);
  expect(rows.get(JSON.stringify(['microphone', 1, 'seg-1']))?.text).toBe('最新');
});

test('已 final 片段不可降级也不被修改', () => {
  const rows = new Map<string, Segment>();
  putSegment(rows, { sourceId: 'microphone', streamEpoch: 1, segmentId: 'seg-1', revision: 1, text: '定稿', isFinal: true });
  const tryDowngrade = putSegment(rows, { sourceId: 'microphone', streamEpoch: 1, segmentId: 'seg-1', revision: 2, text: '修改定稿', isFinal: false });
  const tryModify = putSegment(rows, { sourceId: 'microphone', streamEpoch: 1, segmentId: 'seg-1', revision: 2, text: '覆盖定稿', isFinal: true });

  expect(tryDowngrade).toBe(false);
  expect(tryModify).toBe(false);
  expect(rows.get(JSON.stringify(['microphone', 1, 'seg-1']))?.text).toBe('定稿');
});
