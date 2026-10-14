import {expect, test} from 'vitest';
import {isExplicitCorrection, resolveThinking} from '../src/main/runtime/answer-policy';

const official = 'https://api.deepseek.com/v1';
test('ordinary and code-knowledge questions use low reasoning', () => {
 for (const question of ['介绍自己', '数组和链表有什么区别？', '算法的时间复杂度是什么？', '为什么要写代码？']) {
  expect(resolveThinking(official, 'deepseek-chat', 'balanced', question)).toEqual({thinking:'enabled',reasoningEffort:'low'});
 }
});
test('text-only coding tasks still use low reasoning', () => {
 for (const question of ['写一个快速排序算法', '实现一个LRU缓存', '给我一段反转数组的代码', '这道编程题：合并有序链表', '1. 介绍自己\n2. 请写一个排序算法', '算法题：合并有序链表', '给定一个整数数组。请用 Python 编写代码返回两数之和的下标。', '对方：请实现一个LRU缓存']) {
  expect(resolveThinking(official, 'deepseek-chat', 'balanced', question)).toEqual({thinking:'enabled',reasoningEffort:'low'});
 }
});
test('deep mode explicitly enables thinking even for ordinary questions', () => {
 expect(resolveThinking(official, 'deepseek-reasoner', 'deep', '介绍自己')).toEqual({thinking:'enabled',reasoningEffort:'low'});
});
test('missing or unknown mode still applies low for ordinary dialogue', () => {
 expect(resolveThinking(official, 'deepseek-chat', undefined, '你好')).toEqual({thinking:'enabled',reasoningEffort:'low'});
 expect(resolveThinking(official, 'deepseek-chat', 'unexpected', '你好')).toEqual({thinking:'enabled',reasoningEffort:'low'});
});
test('other providers and models receive no DeepSeek-specific options', () => {
 for (const url of ['https://example.com/v1','https://api.deepseek.com.evil.test/v1','https://api.deepseek.com@evil.test','not a URL']) {
  expect(resolveThinking(url, 'deepseek-chat', 'deep', '写代码')).toEqual({});
 }
 expect(resolveThinking(official, 'other-model', 'deep', '写代码')).toEqual({});
});
test('correction requires an explicit beginning and accepts leading whitespace', () => {
 for (const prefix of ['不是','不对','纠正','更正','我说的是','我的意思是','补充一下','补充条件','改成']) {
  expect(isExplicitCorrection('  '+prefix+'这个条件')).toBe(true);
 }
});
test('independent questions and quoted correction phrases are not corrections', () => {
 for (const text of ['数组和链表有什么区别？','另外介绍一下你的项目','他说不是这个意思','“不是”的英文怎么说？','请解释不对称加密','什么叫纠正码？','']) {
  expect(isExplicitCorrection(text)).toBe(false);
 }
});

test('only actual image input selects max; mentioning screenshots in text remains low',()=>{expect(resolveThinking(official,'deepseek-flash','balanced','请解释截图内容',true)).toEqual({thinking:'enabled',reasoningEffort:'max'});expect(resolveThinking(official,'deepseek-flash','balanced','如何截图？')).toEqual({thinking:'enabled',reasoningEffort:'low'});expect(resolveThinking('https://example.com/v1','deepseek-flash','balanced','图片',true)).toEqual({});});

test('正常否定句和不对称概念不应取消正在生成的回答',()=>{
 for(const text of ['不是所有索引都有效，请解释原因','不是每个请求都需要重试','不对称加密有什么特点？','不是很理解数组，请再解释一次'])expect(isExplicitCorrection(text)).toBe(false);
 for(const text of ['不是，刚才说的是链表','不对，这里要求常数空间','我说的是多线程','补充条件：输入有重复值'])expect(isExplicitCorrection(text)).toBe(true);
});

import {resolveAnswerProvider,resolveAnswerThinking} from '../src/main/runtime/answer-policy';
test('实时方案截图走 API max，实时音频不假装使用 DeepSeek 思考参数',()=>{
 expect(resolveAnswerProvider('realtime',true)).toBe('api');expect(resolveAnswerProvider('realtime',false)).toBe('realtime');expect(resolveAnswerProvider('codex',true)).toBe('codex');
 expect(resolveAnswerThinking('realtime','https://api.deepseek.com/v1','deepseek-flash',true)).toEqual({thinking:'enabled',reasoningEffort:'max'});
 expect(resolveAnswerThinking('realtime','https://api.deepseek.com/v1','deepseek-flash',false)).toEqual({});expect(resolveAnswerThinking('codex','https://api.deepseek.com/v1','deepseek-flash',true)).toEqual({});
});
