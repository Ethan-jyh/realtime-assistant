import { validateIpcPayload } from '../../shared/ipc';

export function authorizeSender(id: number, allowed: Set<number>): void {
  if (!allowed.has(id)) {
    throw new Error('UNTRUSTED_SENDER');
  }
}

export function validateFrame(isMainFrame: boolean): void {
  if (!isMainFrame) {
    throw new Error('SUBFRAME_FORBIDDEN');
  }
}

export function validateSenderUrl(url: string, allowedOrigins: string[]): void {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const isAllowed = allowedOrigins.some((allowed) => {
      if (allowed === 'file:' || allowed.startsWith('file:')) {
        return parsed.protocol === 'file:';
      }
      return origin === allowed;
    });
    if (!isAllowed) {
      throw new Error('UNTRUSTED_ORIGIN');
    }
  } catch (err: any) {
    if (err.message === 'UNTRUSTED_ORIGIN') throw err;
    throw new Error('INVALID_SENDER_URL');
  }
}

export interface IpcSenderContext {
  senderId: number;
  isMainFrame: boolean;
  senderUrl: string;
}

export async function processIpcMessage(
  context: IpcSenderContext,
  allowedSenders: Set<number>,
  allowedOrigins: string[],
  channel: string,
  payload: unknown,
  handlers: Record<string, (validPayload: any) => Promise<any> | any>
): Promise<any> {
  authorizeSender(context.senderId, allowedSenders);
  validateFrame(context.isMainFrame);
  validateSenderUrl(context.senderUrl, allowedOrigins);

  const handler = handlers[channel];
  if (!handler) {
    throw new Error(`UNSUPPORTED_CHANNEL: ${channel}`);
  }

  const validPayload = validateIpcPayload(channel, payload);
  return await handler(validPayload);
}

export function registerIpcMainHandlers(
  ipcMain: Electron.IpcMain,
  allowedSenders: () => Set<number>,
  allowedOrigins: string[],
  handlers: Record<string, (validPayload: any) => Promise<any> | any>
): void {
  for (const channel of Object.keys(handlers)) {
    ipcMain.handle(channel, async (event, payload) => {
      const context: IpcSenderContext = {
        senderId: event.sender.id,
        isMainFrame: event.senderFrame === null || event.senderFrame?.parent === null,
        senderUrl: event.sender.getURL()
      };
      return processIpcMessage(context, allowedSenders(), allowedOrigins, channel, payload, handlers);
    });
  }
}

export function rendererOrigins(rendererUrl?:string):string[]{
  if(!rendererUrl)return ['file:'];
  const u=new URL(rendererUrl);
  if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('INVALID_DEV_ORIGIN');
  return ['file:',u.origin];
}
