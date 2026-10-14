import { expect, test } from 'vitest';
import { ModelClient } from '../src/main/providers/model/client';

async function run(response: Response) {
  const tokens: string[] = [], finishes: string[] = [], errors: string[] = [];
  await new ModelClient(async () => response).streamChat({
    baseUrl: 'http://127.0.0.1/v1', modelName: 'test', messages: [],
    sessionId: 's', generation: 1, requestId: 'r'
  }, {onToken: x => tokens.push(x), onFinish: x => finishes.push(x), onError: x => errors.push(x.message)});
  return { tokens, finishes, errors };
}
const sse = (data: string) => new Response(data, {headers: {'content-type': 'text/event-stream'}});

test.each(['{}','{"choices":[]}','{"choices":[{"message":{"content":7},"finish_reason":"stop"}]}'])('非法完整响应 %s 不误报成功', async data => {
  const result = await run(new Response(data, {headers: {'content-type':'application/json'}}));
  expect(result.finishes).toEqual([]);
  expect(result.errors).toHaveLength(1);
});
test('同批 stop 与 DONE 仅完成一次', async () => {
  const result=await run(sse('data: {"choices":[{"delta":{"content":"A"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
  expect(result.tokens).toEqual(['A']); expect(result.finishes).toEqual(['stop']);
});
test('完成后同批迟到内容和错误均拒收', async () => {
  const result=await run(sse('data: [DONE]\n\ndata: {"choices":[{"delta":{"content":"LATE"}}]}\n\ndata: invalid\n\n'));
  expect(result.tokens).toEqual([]); expect(result.errors).toEqual([]); expect(result.finishes).toEqual(['done']);
});
test('协议结束释放底层未关闭流', async () => {
  let released=false;
  const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));},cancel(){released=true;}});
  await run(new Response(stream,{headers:{'content-type':'text/event-stream'}}));
  expect(released).toBe(true);
});
test('协议错误释放底层流', async () => {
  let released=false;
  const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('data: invalid\n\n'));},cancel(){released=true;}});
  const result=await run(new Response(stream,{headers:{'content-type':'text/event-stream'}}));
  expect(result.errors).toEqual(['INVALID_JSON']); expect(released).toBe(true);
});

test('非法端点通过错误事件返回而非未处理的拒绝', async () => {
  const errors:string[]=[];
  await new ModelClient().streamChat({baseUrl:'bad-url',modelName:'test',messages:[],sessionId:'s',generation:1,requestId:'r'}, {onError:e=>errors.push(e.message)});
  expect(errors).toEqual(['INVALID_PREFIX']);
});
