import {describe,expect,it} from 'vitest';
import {answerCardsReducer} from '../src/shared/answer-cards';
const started=(requestId:string,question:string)=>({type:'event' as const,event:{status:{state:'started',requestId,question}}});
const token=(requestId:string,text:string)=>({type:'event' as const,event:{text,status:{state:'streaming',requestId}}});
describe('persistent answer cards',()=>{
 it('retains old answers and appends each token only to its request',()=>{
  let cards=answerCardsReducer([],started('a','第一个问题'));
  cards=answerCardsReducer(cards,token('a','旧回答'));
  cards=answerCardsReducer(cards,{type:'event',event:{status:{state:'completed',requestId:'a',finishReason:'stop'}}});
  cards=answerCardsReducer(cards,started('b','第二个问题'));
  cards=answerCardsReducer(cards,token('b','新'));
  cards=answerCardsReducer(cards,token('b','回答'));
  expect(cards.map(c=>[c.requestId,c.question,c.text,c.state])).toEqual([['a','第一个问题','旧回答','completed'],['b','第二个问题','新回答','generating']]);
  expect(answerCardsReducer(cards,token('a','迟到内容'))).toBe(cards);
  expect(answerCardsReducer(cards,token('unknown','未知内容'))).toBe(cards);
 });
 it('preserves partial output and rejects late events after cancellation or error',()=>{
  let cards=answerCardsReducer([],started('a','问题'));
  cards=answerCardsReducer(cards,token('a','部分回答'));
  cards=answerCardsReducer(cards,{type:'event',event:{status:{state:'completed',requestId:'a',finishReason:'interrupted'}}});
  expect(cards[0]).toMatchObject({text:'部分回答',state:'cancelled'});
  expect(answerCardsReducer(cards,token('a','迟到'))).toBe(cards);
  cards=answerCardsReducer(cards,started('b','另一个问题'));
  cards=answerCardsReducer(cards,{type:'event',event:{status:{state:'error',requestId:'b',error:'网络错误'}}});
  expect(cards[1]).toMatchObject({state:'error',error:'网络错误'});
  expect(answerCardsReducer(cards,{type:'event',event:{status:{state:'completed',requestId:'b'}}})).toBe(cards);
 });
 it('hydrates persisted results, merges tokens received before hydration, and clears on a new session',()=>{
  const live=answerCardsReducer(answerCardsReducer([],started('b','新问题')),token('b','正在回答'));
  const cards=answerCardsReducer(live,{type:'hydrate',answers:[{requestId:'a',question:'旧问题',text:'旧回答',state:'completed'},{requestId:'b',question:'新问题',text:'正在',state:'generating'},{requestId:'c',question:'失败问题',text:'',state:'failed'}]});
  expect(cards.map(c=>[c.requestId,c.text,c.state])).toEqual([['a','旧回答','completed'],['b','正在回答','generating'],['c','','error']]);
  expect(answerCardsReducer(cards,{type:'clear'})).toEqual([]);
  expect(answerCardsReducer([] ,token('a','旧会话事件'))).toEqual([]);
 });
 it('ignores repeated starts and cancels an unfinished card when a replacement starts',()=>{
  let cards=answerCardsReducer([],started('a','问题'));
  cards=answerCardsReducer(cards,token('a','部分'));
  expect(answerCardsReducer(cards,started('a','问题'))).toBe(cards);
  cards=answerCardsReducer(cards,started('b','新问题'));
  expect(cards[0]).toMatchObject({text:'部分',state:'cancelled'});
 });
 it('replays buffered tokens and completion newer than a delayed snapshot',()=>{
  const cards=answerCardsReducer([],{type:'hydrate',answers:[{requestId:'a',question:'问题',text:'已保存',state:'generating',sequence:1}],bufferedEvents:[{text:'新内容',status:{state:'streaming',requestId:'a',sequence:2}},{status:{state:'completed',requestId:'a',sequence:3,finishReason:'stop'}}]});
  expect(cards[0]).toMatchObject({text:'已保存新内容',state:'completed',sequence:3});
 });
 it('does not replay tokens already included in the snapshot',()=>{
  const cards=answerCardsReducer([],{type:'hydrate',answers:[{requestId:'a',question:'问题',text:'完整内容',state:'generating',sequence:2}],bufferedEvents:[{text:'完整',status:{state:'streaming',requestId:'a',sequence:1}},{text:'内容',status:{state:'streaming',requestId:'a',sequence:2}},{status:{state:'error',requestId:'a',sequence:3,error:'网络错误'}}]});
  expect(cards[0]).toMatchObject({text:'完整内容',state:'error',sequence:3,error:'网络错误'});
 });
 it('replays a request started after snapshot capture and rejects repeated sequenced tokens',()=>{
  const cards=answerCardsReducer([],{type:'hydrate',answers:[],bufferedEvents:[{status:{state:'started',requestId:'a',sequence:0,question:'新问题'}},{text:'回答',status:{state:'streaming',requestId:'a',sequence:1}}]});
  expect(cards[0]).toMatchObject({question:'新问题',text:'回答',sequence:1});
  expect(answerCardsReducer(cards,{type:'event',event:{text:'回答',status:{state:'streaming',requestId:'a',sequence:1}}})).toBe(cards);
 });

});
it('parallel lanes never cancel each other, including hydration',()=>{
 let cards=answerCardsReducer([],started('a','快速问题'));
 cards=answerCardsReducer(cards,{type:'event',event:{status:{state:'started',requestId:'d',question:'深度问题',lane:'deep'}}});
 expect(cards.map(c=>c.state)).toEqual(['generating','generating']);
 cards=answerCardsReducer(cards,token('d','深度'));cards=answerCardsReducer(cards,token('a','快速'));
 expect(cards.map(c=>c.text)).toEqual(['快速','深度']);
 const hydrated=answerCardsReducer([],{type:'hydrate',answers:cards});expect(hydrated[1].lane).toBe('deep');
 cards=answerCardsReducer(cards,started('b','快速下一题'));expect(cards[1].state).toBe('generating');
});
