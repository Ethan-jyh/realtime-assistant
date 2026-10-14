import { expect, test } from 'vitest';
import {
  authorizeSender,
  validateFrame,
  validateSenderUrl,
  processIpcMessage
} from '../src/main/ipc/register';
import { IPC_CHANNELS } from '../src/shared/ipc';

test('未知页面不能使用主进程能力', () => {
  expect(() => authorizeSender(9, new Set([1, 2]))).toThrow('UNTRUSTED_SENDER');
  expect(() => authorizeSender(1, new Set([1, 2]))).not.toThrow();
});

test('子 frame 请求被拒绝', () => {
  expect(() => validateFrame(false)).toThrow('SUBFRAME_FORBIDDEN');
  expect(() => validateFrame(true)).not.toThrow();
});

test('非白名单 origin 或恶意 URL 被拒绝', () => {
  const allowed = ['http://localhost:5173', 'file:'];
  expect(() => validateSenderUrl('http://malicious.com', allowed)).toThrow('UNTRUSTED_ORIGIN');
  expect(() => validateSenderUrl('not-a-valid-url', allowed)).toThrow('INVALID_SENDER_URL');
  expect(() => validateSenderUrl('http://localhost:5173/index.html', allowed)).not.toThrow();
  expect(() => validateSenderUrl('file:///path/to/index.html', allowed)).not.toThrow();
});

test('未知命令拒绝', async () => {
  const context = { senderId: 1, isMainFrame: true, senderUrl: 'file:///app/index.html' };
  const allowedSenders = new Set([1]);
  const allowedOrigins = ['file:'];
  const handlers = {};

  await expect(
    processIpcMessage(context, allowedSenders, allowedOrigins, 'unknown.channel', {}, handlers)
  ).rejects.toThrow('UNSUPPORTED_CHANNEL');
});

test('畸形 payload 校验失败', async () => {
  const context = { senderId: 1, isMainFrame: true, senderUrl: 'file:///app/index.html' };
  const allowedSenders = new Set([1]);
  const allowedOrigins = ['file:'];
  const handlers = {
    [IPC_CHANNELS.SESSION_START]: async (payload: any) => payload
  };

  // sources 为空数组违反 min(1) 约束
  await expect(
    processIpcMessage(context, allowedSenders, allowedOrigins, IPC_CHANNELS.SESSION_START, { sources: [] }, handlers)
  ).rejects.toThrow('MALFORMED_PAYLOAD');
});

test('合法请求调用对应 handler 并返回结果，且密钥提交仅返回 configured 状态不回传明文', async () => {
  const context = { senderId: 1, isMainFrame: true, senderUrl: 'file:///app/index.html' };
  const allowedSenders = new Set([1]);
  const allowedOrigins = ['file:'];
  const handlers = {
    [IPC_CHANNELS.SETTINGS_SAVE]: async (payload: any) => {
      // 模拟主进程只返回 configured 状态，绝不回传 apiKey
      return { configured: true, hasModelKey: Boolean(payload.model?.apiKey) };
    }
  };

  const res = await processIpcMessage(
    context,
    allowedSenders,
    allowedOrigins,
    IPC_CHANNELS.SETTINGS_SAVE,
    {
      model: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret-key-123',
        modelName: 'gpt-4o'
      }
    },
    handlers
  );

  expect(res).toEqual({ configured: true, hasModelKey: true });
  expect(res).not.toHaveProperty('apiKey');
});


test('开发端口变化仍只授权实际 renderer origin',async()=>{
  const {rendererOrigins}=await import('../src/main/ipc/register');
  const origins=rendererOrigins('http://localhost:5174/');
  expect(()=>validateSenderUrl('http://localhost:5174/#/prepare',origins)).not.toThrow();
  expect(()=>validateSenderUrl('http://localhost:5173/',origins)).toThrow('UNTRUSTED_ORIGIN');
  expect(()=>rendererOrigins('https://example.com')).toThrow('INVALID_DEV_ORIGIN');
});


test('audio-only control requires a scoped capture token and explicit operation',async()=>{
 const {validateIpcPayload}=await import('../src/shared/ipc');
 expect(()=>validateIpcPayload(IPC_CHANNELS.SYSTEM_AUDIO,{action:'start'})).toThrow('MALFORMED_PAYLOAD');
 expect(()=>validateIpcPayload(IPC_CHANNELS.SYSTEM_AUDIO,{token:'bad',action:'stop'})).toThrow('MALFORMED_PAYLOAD');
 expect(validateIpcPayload(IPC_CHANNELS.SYSTEM_AUDIO,{token:'e0fb2d5c-c9d4-4c52-a36b-a894f41dbda9',action:'stop'}).action).toBe('stop');
});
