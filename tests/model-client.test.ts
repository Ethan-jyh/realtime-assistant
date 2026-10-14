import { expect, test } from 'vitest';
import * as http from 'http';
import { RequestSlot } from '../src/main/runtime/request-slot';
import { ModelClient } from '../src/main/providers/model/client';

test('新请求使旧增量无效，终态只提交一次', () => {
  const slot = new RequestSlot();
  const a = slot.begin();
  const b = slot.begin();
  expect(slot.accept(a)).toBe(false);
  expect(slot.accept(b)).toBe(true);
  expect(slot.finish(b)).toBe(true);
  expect(slot.finish(b)).toBe(false);
});

function withServer(
  handler: http.RequestListener,
  fn: (url: string) => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', async () => {
      const port = (server.address() as any).port;
      const url = `http://127.0.0.1:${port}/v1`;
      try {
        await fn(url);
        server.close(() => resolve());
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test('分块中文流式输出正确传递 tokens 及 meta', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache'
      });
      res.write('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"世界"},"finish_reason":null}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    },
    async (url) => {
      const client = new ModelClient();
      const tokens: string[] = [];
      let finishReason = '';
      await client.streamChat(
        {
          baseUrl: url,
          modelName: 'test-model',
          messages: [{ role: 'user', content: 'hello' }],
          sessionId: 's-1',
          generation: 1,
          requestId: 'r-1'
        },
        {
          onToken: (t, meta) => {
            tokens.push(t);
            expect(meta.requestId).toBe('r-1');
            expect(meta.generation).toBe(1);
          },
          onFinish: (reason) => {
            finishReason = reason;
          }
        }
      );
      expect(tokens.join('')).toBe('你好世界');
      expect(finishReason).toBe('done');
    }
  );
});

test('非流式完整返回能够解析', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '完整回答' }, finish_reason: 'stop' }]
        })
      );
    },
    async (url) => {
      const client = new ModelClient();
      const tokens: string[] = [];
      let finishReason = '';
      await client.streamChat(
        {
          baseUrl: url,
          modelName: 'test-model',
          messages: [{ role: 'user', content: 'hello' }],
          sessionId: 's-1',
          generation: 1,
          requestId: 'r-1',
          stream: false
        },
        {
          onToken: (t) => tokens.push(t),
          onFinish: (r) => {
            finishReason = r;
          }
        }
      );
      expect(tokens.join('')).toBe('完整回答');
      expect(finishReason).toBe('stop');
    }
  );
});

test('401 鉴权失败报错', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    },
    async (url) => {
      const client = new ModelClient();
      let errGot: Error | null = null;
      await client.streamChat(
        {
          baseUrl: url,
          modelName: 'test-model',
          messages: [],
          sessionId: 's',
          generation: 1,
          requestId: 'r'
        },
        {
          onError: (err) => {
            errGot = err;
          }
        }
      );
      expect((errGot as any)?.message).toContain('HTTP_401');
      expect((errGot as any)?.message).toContain('Invalid API key');
    }
  );
});

test('无输出时 429 触发重试一次', async () => {
  let attempts = 0;
  await withServer(
    (req, res) => {
      attempts++;
      if (attempts === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Rate limit' } }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n');
      }
    },
    async (url) => {
      const client = new ModelClient();
      const tokens: string[] = [];
      await client.streamChat(
        {
          baseUrl: url,
          modelName: 'test-model',
          messages: [],
          sessionId: 's',
          generation: 1,
          requestId: 'r'
        },
        {
          onToken: (t) => tokens.push(t)
        }
      );
      expect(attempts).toBe(2);
      expect(tokens).toEqual(['ok']);
    }
  );
});

test('500 服务端错误报错', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('Internal Server Error');
    },
    async (url) => {
      const client = new ModelClient();
      let errGot: Error | null = null;
      await client.streamChat(
        {
          baseUrl: url,
          modelName: 'test-model',
          messages: [],
          sessionId: 's',
          generation: 1,
          requestId: 'r'
        },
        {
          onError: (err) => {
            errGot = err;
          }
        }
      );
      expect((errGot as any)?.message).toContain('HTTP_500');
    }
  );
});

test('重定向请求被拒绝', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(302, { Location: 'https://evil.com/redirected' });
      res.end();
    },
    async (url) => {
      const client = new ModelClient();
      let errGot: Error | null = null;
      await client.streamChat(
        {
          baseUrl: url,
          modelName: 'test-model',
          messages: [],
          sessionId: 's',
          generation: 1,
          requestId: 'r'
        },
        {
          onError: (err) => {
            errGot = err;
          }
        }
      );
      // node/fetch redirect:error throws on redirect
      expect(errGot).not.toBeNull();
    }
  );
});

test('主动取消及迟到结果被忽略', async () => {
  const slot = new RequestSlot();
  const generation = slot.begin();
  const controller = new AbortController();

  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"first"},"finish_reason":null}]}\n\n');
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"late"},"finish_reason":null}]}\n\n');
        res.end();
      }, 50);
    },
    async (url) => {
      const client = new ModelClient();
      const tokens: string[] = [];
      let finishReason = '';

      const promise = client.streamChat(
        {
          baseUrl: url,
          modelName: 'test-model',
          messages: [],
          sessionId: 's',
          generation,
          requestId: 'r',
          signal: controller.signal
        },
        {
          onToken: (t) => {
            if (slot.accept(generation)) tokens.push(t);
          },
          onFinish: (r) => {
            if (slot.finish(generation)) finishReason = r;
          }
        }
      );

      // 收到第一块后立即取消
      controller.abort();
      slot.cancel();

      await promise;
      expect(tokens).toEqual([]);
      expect(finishReason).toBe('');
    }
  );
});

test('流异常截断视为 interrupted', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"part"},"finish_reason":null}]}\n\n');
      // 直接关闭连接，没有 [DONE] 或 finish_reason
      res.destroy();
    },
    async (url) => {
      const client = new ModelClient();
      let finishReason = '';
      let errGot: Error | null = null;
      await client.streamChat(
        {
          baseUrl: url,
          modelName: 'test-model',
          messages: [],
          sessionId: 's',
          generation: 1,
          requestId: 'r'
        },
        {
          onFinish: (r) => {
            finishReason = r;
          },
          onError: (e) => {
            errGot = e;
          }
        }
      );
      expect(finishReason === 'interrupted' || errGot !== null).toBe(true);
    }
  );
});

test('显式低延迟参数写入请求，思考事件仅报告字符数量，不当作可见回答',async()=>{
 let sent:any;const visible:string[]=[];const reasoning:number[]=[];let headers=0;
 const fetchFn=async(_url:any,options:any)=>{sent=JSON.parse(options.body);return new Response('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'不应展示的测试思考'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:'最终回答'},finish_reason:'stop'}]})+'\n\n',{headers:{'content-type':'text/event-stream'}});};
 await new ModelClient().streamChat({baseUrl:'http://127.0.0.1/v1',modelName:'synthetic',messages:[],sessionId:'s',generation:1,requestId:'r',thinking:'disabled',fetchFn} as any,{onToken:(t:string)=>visible.push(t),onResponse:()=>headers++,onReasoning:(n:number)=>reasoning.push(n)} as any);
 expect(sent.thinking).toEqual({type:'disabled'});expect(visible).toEqual(['最终回答']);expect(headers).toBe(1);expect(reasoning).toEqual(['不应展示的测试思考'.length]);
});
