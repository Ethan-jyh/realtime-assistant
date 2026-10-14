import {describe,it,expect} from 'vitest';
import {DeepAnswerQueue} from '../src/main/runtime/deep-answer-queue';
describe('independent deep answer queue',()=>{
 it('keeps continuous questions and waits for the current response',()=>{
  const started:any[]=[];const q=new DeepAnswerQueue((job,signal)=>{started.push({job,signal});return new Promise(()=>{})});
  q.offer({question:'一',kind:'knowledge'});q.offer({question:'二',kind:'knowledge'});expect(started).toHaveLength(1);
  q.pause(true);expect(started[0].signal.aborted).toBe(true);q.resume();expect(started[1].job.question).toBe('一');
  q.stop();expect(started[1].signal.aborted).toBe(true);q.resume();expect(started).toHaveLength(2);
 });
 it('continues after a failed answer without blocking later questions',async()=>{
  const started:string[]=[];const q=new DeepAnswerQueue(async job=>{started.push(job.question);throw Error('synthetic')});
  q.offer({question:'一',kind:'knowledge'});q.offer({question:'二',kind:'knowledge'});await new Promise(r=>setTimeout(r,0));expect(started).toEqual(['一','二']);
 });
});
it('completed jobs are not replayed while transport cleanup is pending',()=>{
 let complete!:()=>void;const runs:string[]=[];const q=new DeepAnswerQueue((job,_signal,done)=>{complete=done;runs.push(job.question);return new Promise(()=>{});});q.offer({question:'已完成',kind:'knowledge'});complete();q.pause(true);q.resume();expect(runs).toEqual(['已完成']);
});
it('turning off auto drops automatic backlog but keeps manual input',()=>{
 const runs:string[]=[];const q=new DeepAnswerQueue((job)=>{runs.push(job.question);return new Promise(()=>{});});q.offer({question:'自动一',kind:'knowledge',automatic:true});q.offer({question:'自动二',kind:'knowledge',automatic:true});q.setAutomatic(false);q.offer({question:'手动',kind:'knowledge'});q.resume();expect(runs).toEqual(['自动一','手动']);
});
