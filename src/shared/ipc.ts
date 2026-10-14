import { z } from 'zod';

export const SettingsSaveSchema = z.object({
  showTranscripts:z.boolean().optional(),deepProfileId:z.string().uuid().nullable().optional(),
  answerProvider:z.enum(['api','codex','realtime']).optional(),
  realtime:z.object({workspaceId:z.string().max(100),region:z.enum(['cn-beijing','ap-southeast-1']),modelName:z.string().min(1).max(120),apiKey:z.string().optional()}).optional(),
  codex:z.object({modelName:z.string().max(200).default(''),effort:z.string().max(32).regex(/^([a-z]+)?$/).default('')}).optional(),
  profile: z.record(z.string(),z.unknown()).optional(),
  model: z
    .object({
      baseUrl: z.string().min(1),
      apiKey: z.string().optional(),
      modelName: z.string().min(1)
    })
    .optional(),
  asr: z
    .object({
      provider: z.literal('aliyun'),
      modelName: z.string().min(1),
      endpoint: z.string().min(1),
      apiKey: z.string().optional(),
      language: z.string().default('zh')
    })
    .optional()
});

export const ProviderTestSchema = z.object({
  kind: z.enum(['model', 'asr']),profileId:z.string().uuid().optional()
});

export const SessionStartSchema = z.object({
  sources: z.array(z.enum(['microphone', 'system'])).min(1),
  instruction: z.string().optional(),
  recordAudio: z.boolean().default(false),
  form: z.record(z.string(),z.unknown()).optional().default({})
});

export const SessionStopSchema = z.object({}).optional().default({});

export const AnswerAskSchema = z.object({
  question: z.string().min(1),
  kind: z.enum(['knowledge','profile','document','translate']).optional(),
  contextSegmentIds: z.array(z.string()).optional()
});

export const AnswerCancelSchema = z.object({}).optional().default({});

export const WindowCommandSchema = z.object({
  action: z.enum(['toggle_expand', 'set_content_protection', 'show_overlay', 'hide_overlay', 'set_opacity', 'minimize_prepare', 'minimize_overlay', 'quit_app', 'close_prepare', 'show_prepare', 'hide_prepare','get_bounds','move_window','get_mouse_mode','set_mouse_through','begin_drag','end_drag']),
  view:z.enum(['settings']).optional(),
  dragToken:z.string().uuid().optional(),
  enabled:z.boolean().optional(),
  target:z.enum(['prepare','overlay']).optional(),
  x:z.number().finite().min(-100000).max(100000).optional(),
  y:z.number().finite().min(-100000).max(100000).optional(),
  protectedContent: z.boolean().optional(),
  requireOverlayFocus: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional()
}).refine(value=>value.action!=='set_opacity'||value.opacity!==undefined, {message:'OPACITY_REQUIRED'}).refine(value=>!['get_bounds','move_window','begin_drag','end_drag'].includes(value.action)||value.target!==undefined,{message:'TARGET_REQUIRED'}).refine(value=>value.action!=='move_window'||(value.x!==undefined&&value.y!==undefined),{message:'POSITION_REQUIRED'}).refine(value=>value.action!=='set_mouse_through'||typeof value.enabled==='boolean',{message:'ENABLED_REQUIRED'}).refine(value=>!['begin_drag','end_drag'].includes(value.action)||value.dragToken!==undefined,{message:'DRAG_TOKEN_REQUIRED'});

export const HistoryListSchema = z
  .object({
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional()
  })
  .optional()
  .default({});

export const HistoryDeleteSchema = z.object({
  sessionId: z.string().uuid()
});

export const HistoryExportSchema = z.object({
  sessionId: z.string().uuid(),
  targetPath: z.string().optional()
});

export const DocumentPickSchema = z.object({}).optional().default({});

export const DocumentConfirmSchema = z.object({
  token: z.string().min(1)
});

export { IPC_CHANNELS } from './ipc-channels';
import { IPC_CHANNELS } from './ipc-channels';

export const IPC_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [IPC_CHANNELS.CODEX_STATUS]:z.object({}).optional().default({}),
  [IPC_CHANNELS.DIAGNOSTICS]: z.object({action:z.enum(['get','open'])}),
  [IPC_CHANNELS.TELEMETRY]: z.object({event:z.enum(['capture.settings','capture.echo','capture.rebuild','drag.start','drag.end']),data:z.record(z.string(),z.union([z.number(),z.boolean(),z.string()])).default({})}),
  [IPC_CHANNELS.PROFILES_LIST]:z.object({}).optional().default({}),
  [IPC_CHANNELS.PROFILES_SAVE]:SettingsSaveSchema.extend({id:z.string().uuid().optional(),name:z.string().min(1).max(100),answerProvider:z.enum(['api','codex','realtime'])}),
  [IPC_CHANNELS.PROFILES_SELECT]:z.object({id:z.string().uuid()}),
  [IPC_CHANNELS.SETTINGS_SAVE]: SettingsSaveSchema,
  [IPC_CHANNELS.SETTINGS_GET]: z.object({}).optional().default({}),
  [IPC_CHANNELS.PROVIDER_TEST]: ProviderTestSchema,
  [IPC_CHANNELS.SESSION_START]: SessionStartSchema,
  [IPC_CHANNELS.SESSION_STOP]: SessionStopSchema,
  [IPC_CHANNELS.SESSION_GET]: z.object({}).optional().default({}),
  [IPC_CHANNELS.SESSION_UPDATE]: z.object({auto:z.boolean().optional(),paused:z.boolean().optional(),form:z.record(z.string(),z.unknown()).optional()}),
  [IPC_CHANNELS.CAPTURE_PCM]: z.object({token:z.string().uuid(),sourceId:z.enum(['microphone','system']),bytes:z.custom<Uint8Array>(v=>v instanceof Uint8Array&&v.byteLength>0&&v.byteLength<=65536)}),
  [IPC_CHANNELS.CAPTURE_STATUS]: z.object({token:z.string().uuid(),commandId:z.string().uuid().optional(),state:z.enum(['ready','running','failed','stopped','warning']),message:z.string().optional()}),
  [IPC_CHANNELS.SYSTEM_AUDIO]: z.object({token:z.string().uuid(),action:z.enum(['start','stop'])}),
  [IPC_CHANNELS.HISTORY_GET]: z.object({sessionId:z.string().uuid()}),
  [IPC_CHANNELS.HISTORY_AUDIO]: z.object({sessionId:z.string().uuid(),sourceId:z.enum(['microphone','system'])}),
  [IPC_CHANNELS.HISTORY_REVEAL]: z.object({sessionId:z.string().uuid()}),
  [IPC_CHANNELS.ANSWER_ASK]: AnswerAskSchema,
  [IPC_CHANNELS.CAPTURE_QUESTION]: z.object({question:z.string().min(1).max(8000)}),
  [IPC_CHANNELS.ANSWER_CANCEL]: AnswerCancelSchema,
  [IPC_CHANNELS.WINDOW_COMMAND]: WindowCommandSchema,
  [IPC_CHANNELS.HISTORY_LIST]: HistoryListSchema,
  [IPC_CHANNELS.HISTORY_DELETE]: HistoryDeleteSchema,
  [IPC_CHANNELS.HISTORY_EXPORT]: HistoryExportSchema,
  [IPC_CHANNELS.DOCUMENT_PICK]: DocumentPickSchema,
  [IPC_CHANNELS.DOCUMENT_CONFIRM]: DocumentConfirmSchema
};

export function validateIpcPayload(channel: string, payload: unknown): any {
  const schema = IPC_SCHEMAS[channel];
  if (!schema) {
    throw new Error(`UNSUPPORTED_CHANNEL: ${channel}`);
  }
  const result = schema.safeParse(payload ?? {});
  if (!result.success) {
    throw new Error(`MALFORMED_PAYLOAD: ${result.error.message}`);
  }
  return result.data;
}
