import {test,expect} from 'vitest';
import {runTask,decodeSentence} from '../src/main/providers/asr/aliyun';
test('阿里 run-task 使用 PCM 16k 单声道且只关联当前 task',()=>{
 const request=runTask('task','qwen-audio-3.1-asr-flash-streaming');
 expect(request.header).toEqual({action:'run-task',task_id:'task',streaming:'duplex'});
 expect(request.payload.parameters).toMatchObject({format:'pcm',sample_rate:16000});
 expect(decodeSentence({header:{event:'result-generated'},payload:{output:{sentence:{sentence_id:1,text:'数组',sentence_end:true,begin_time:20,end_time:100}}}})).toMatchObject({segmentId:'1',text:'数组',isFinal:true,startMs:20,endMs:100});
 expect(decodeSentence({payload:{output:{sentence:{heartbeat:true}}}})).toBeNull();
});
