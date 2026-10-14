import {test,expect} from 'vitest';
import {createServer} from 'node:http';
import {ModelClient} from '../src/main/providers/model/client';
import {resolveThinking} from '../src/main/runtime/answer-policy';

test.each([
 ['普通对话','数组和链表有什么区别？','low',false],
 ['纯文字代码题','请写一个快速排序算法','low',false],
 ['实际截图','解释图片内容','max',true]
])('%s sends the selected effort in the actual HTTP body',async(_label,question,effort,hasImage)=>{
 let payload:any;const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{payload=JSON.parse(body);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: {"choices":[{"delta":{"content":"合成回答"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{let result='';const errors:string[]=[];await new ModelClient().streamChat({baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,modelName:'deepseek-flash',messages:[{role:'user',content:hasImage?[{type:'text',text:question as string},{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]:question as string}],sessionId:'synthetic',generation:1,requestId:'synthetic',...resolveThinking('https://api.deepseek.com/v1','deepseek-flash','balanced',question as string,hasImage as boolean)},{onToken:t=>result+=t,onError:e=>errors.push(e.message)});
 expect(errors).toEqual([]);expect(result).toBe('合成回答');expect(payload.thinking).toEqual({type:'enabled'});expect(payload.reasoning_effort).toBe(effort);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
