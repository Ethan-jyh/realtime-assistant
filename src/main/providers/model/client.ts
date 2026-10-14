import { completionUrl } from '../../settings/model';
import { SseDecoder } from './sse';
import { decodeChunk } from './chunk';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{type:'text';text:string}|{type:'image_url';image_url:{url:string}}>;
}

export interface ModelRequestOptions {
  baseUrl: string;
  apiKey?: string;
  modelName: string;
  messages: ModelMessage[];
  sessionId: string;
  generation: number;
  requestId: string;
  stream?: boolean;
  thinking?: 'enabled'|'disabled';
  reasoningEffort?: 'low'|'high'|'max';
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  initialTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface ModelStreamHandlers {
  onResponse?: () => void;
  onReasoning?: (characters:number) => void;
  onToken?: (token: string, meta: { requestId: string; generation: number }) => void;
  onFinish?: (reason: string, meta: { requestId: string; generation: number }) => void;
  onError?: (err: Error, meta: { requestId: string; generation: number }) => void;
}

export class ModelClient {
  private fetchFn: typeof fetch;

  constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async streamChat(
    options: ModelRequestOptions,
    handlers: ModelStreamHandlers = {}
  ): Promise<void> {
    const meta = { requestId: options.requestId, generation: options.generation };
    let url: string;
    const initialTimeout = options.initialTimeoutMs ?? 30000;
    const idleTimeout = options.idleTimeoutMs ?? 30000;
    const streamMode = options.stream ?? true;

    let terminal = false;
    const finish = (reason: string) => {
      if (terminal) return;
      terminal = true;
      handlers.onFinish?.(reason, meta);
    };
    const fail = (error: Error) => {
      if (terminal) return;
      terminal = true;
      handlers.onError?.(error, meta);
    };
    const token = (text: string) => { if (!terminal) handlers.onToken?.(text, meta); };
    try { url = completionUrl(options.baseUrl); }
    catch (error) { fail(error instanceof Error ? error : new Error('INVALID_PREFIX')); return; }
    let hasProducedOutput = false;
    let attempt = 0;

    const executeRequest = async (): Promise<void> => {
      attempt++;
      const internalAbort = new AbortController();

      const onExternalAbort = () => {
        internalAbort.abort();
      };

      if (options.signal) {
        if (options.signal.aborted) {
          finish('interrupted');
          return;
        }
        options.signal.addEventListener('abort', onExternalAbort, { once: true });
      }

      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

      const resetTimer = (ms: number, reason: string) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          internalAbort.abort(new Error(reason));
        }, ms);
      };

      resetTimer(initialTimeout, 'INITIAL_RESPONSE_TIMEOUT');

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json'
        };
        if (options.apiKey) {
          headers.Authorization = `Bearer ${options.apiKey}`;
        }

        const body = JSON.stringify({
          model: options.modelName,
          messages: options.messages,
          stream: streamMode,
          ...(options.thinking?{thinking:{type:options.thinking}}:{}),
          ...(options.reasoningEffort?{reasoning_effort:options.reasoningEffort}:{})
        });

        const res = await (options.fetchFn ?? this.fetchFn)(url, {
          method: 'POST',
          headers,
          body,
          redirect: 'error',
          signal: internalAbort.signal
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          let errMsg = `HTTP_${res.status}`;
          try {
            const parsed = JSON.parse(errText);
            if (parsed.error?.message) {
              errMsg = `${errMsg}: ${parsed.error.message}`;
            }
          } catch {
            // ignore
          }
          throw new Error(errMsg);
        }

        handlers.onResponse?.();
        const contentType = res.headers.get('content-type') || '';
        const isSse = contentType.includes('text/event-stream');

        if (!isSse) {
          // 非流式完整 JSON 返回
          const jsonText = await res.text();
          if (timeoutTimer) clearTimeout(timeoutTimer);
          const data = JSON.parse(jsonText);
          const choice = data?.choices?.[0];
          if (!Array.isArray(data?.choices) || !choice ||
              typeof choice.message?.content !== 'string') {
            throw new Error('INVALID_COMPLETION');
          }
          if (choice.message.tool_calls || choice.finish_reason === 'tool_calls') {
            throw new Error('UNSUPPORTED_OUTPUT: tool_calls');
          }
          if (!['stop', 'length', 'content_filter'].includes(choice.finish_reason)) {
            throw new Error('INVALID_FINISH_REASON');
          }
          const text = choice.message.content;
          if (text) {
            hasProducedOutput = true;
            token(text);
          }
          finish(choice.finish_reason);
          return;
        }

        if (!res.body) {
          throw new Error('EMPTY_RESPONSE_BODY');
        }

        const reader = res.body.getReader();
        let finished = false;

        const sse = new SseDecoder((eventData) => {
          if (terminal) return;
          try {
            const decoded = decodeChunk(eventData);
            if(decoded.reasoningChars)handlers.onReasoning?.(decoded.reasoningChars);
            if (decoded.text) {
              hasProducedOutput = true;
              token(decoded.text);
            }
            if (decoded.finish) {
              finished = true;
              finish(decoded.finish);
            }
          } catch (err: any) {
            finished = true;
            fail(err);
          }
        });

        try {
          for (;;) {
            resetTimer(idleTimeout, 'STREAM_IDLE_TIMEOUT');
            const { done, value } = await reader.read();
            if (done) { sse.end(); break; }
            if (value) sse.push(value);
            if (finished) break;
          }
          if (!finished) finish('interrupted');
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }

      } catch (err: any) {
        if (timeoutTimer) clearTimeout(timeoutTimer);

        if (options.signal?.aborted || internalAbort.signal.aborted) {
          const abortReason = (internalAbort.signal.reason as any)?.message;
          if (abortReason === 'INITIAL_RESPONSE_TIMEOUT' || abortReason === 'STREAM_IDLE_TIMEOUT') {
            fail(new Error(abortReason));
          } else {
            finish('interrupted');
          }
          return;
        }

        // 重试逻辑：尚无输出且是第一次尝试，且错误为临时网络/服务端错误时，最多重试一次
        const canRetry =
          !hasProducedOutput &&
          attempt === 1 &&
          (err.message.includes('HTTP_5') ||
            err.message.includes('HTTP_429') ||
            err.message.includes('fetch failed') ||
            err.message.includes('network'));

        if (canRetry) {
          return await executeRequest();
        }

        fail(err);
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (options.signal) {
          options.signal.removeEventListener('abort', onExternalAbort);
        }
      }
    };

    await executeRequest();
  }
}
