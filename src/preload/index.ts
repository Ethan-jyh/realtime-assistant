import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';

const api = {
  onDisplaySettings:(callback:(data:any)=>void)=>{const handler=(_:any,data:any)=>callback(data);ipcRenderer.on('settings.display',handler);return ()=>ipcRenderer.removeListener('settings.display',handler);},
  onOpenSettings:(callback:()=>void)=>{const h=()=>callback();ipcRenderer.on('prepare.settings',h);return ()=>ipcRenderer.removeListener('prepare.settings',h)},
  listProfiles:()=>ipcRenderer.invoke(IPC_CHANNELS.PROFILES_LIST),
  saveProfile:(payload:any)=>ipcRenderer.invoke(IPC_CHANNELS.PROFILES_SAVE,payload),
  selectProfile:(id:string)=>ipcRenderer.invoke(IPC_CHANNELS.PROFILES_SELECT,{id}),
  codexStatus:()=>ipcRenderer.invoke(IPC_CHANNELS.CODEX_STATUS),
  onAnswerQueue: (callback:(data:{pending:number;busy:boolean})=>void) => {const handler=(_:any,data:any)=>callback(data);ipcRenderer.on('answer.queue',handler);return ()=>ipcRenderer.removeListener('answer.queue',handler);},
  onScreenshotShortcut:(callback:()=>void)=>{const handler=()=>callback();ipcRenderer.on('window.screenshot_shortcut',handler);return ()=>ipcRenderer.removeListener('window.screenshot_shortcut',handler);},
  onOpacityChanged:(callback:(data:any)=>void)=>{const handler=(_:any,data:any)=>callback(data);ipcRenderer.on('window.opacity_changed',handler);return ()=>ipcRenderer.removeListener('window.opacity_changed',handler);},
  onInteraction: (callback:(data:any)=>void) => {const handler=(_:any,data:any)=>callback(data);ipcRenderer.on('window.interaction',handler);return ()=>ipcRenderer.removeListener('window.interaction',handler);},
  diagnostics: (action:'get'|'open') => ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS,{action}),
  telemetry: (event:string,data:any={}) => ipcRenderer.invoke(IPC_CHANNELS.TELEMETRY,{event,data}),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  saveSettings: (payload: any) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, payload),
  testProvider: (payload: any) => ipcRenderer.invoke(IPC_CHANNELS.PROVIDER_TEST, payload),
  startSession: (payload: any) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_START, payload),
  getSession: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET),
  updateSession: (payload:any) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_UPDATE,payload),
  capturePcm: (payload:any) => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_PCM,payload),
  captureStatus: (payload:any) => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_STATUS,payload),
  systemAudio: (payload:{token:string;action:'start'|'stop'}) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_AUDIO,payload),
  onSystemAudio: (callback:(data:{token:string;samples:Float32Array})=>void) => {const handler=(_:any,data:any)=>callback(data);ipcRenderer.on('capture.system.pcm',handler);return ()=>ipcRenderer.removeListener('capture.system.pcm',handler);},
  getHistoryAudio: (payload:any)=>ipcRenderer.invoke(IPC_CHANNELS.HISTORY_AUDIO,payload),
  getHistory: (payload:any) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET,payload),
  revealHistory: (payload:any) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_REVEAL,payload),
  onCapture: (callback:(event:any)=>void) => { const handler=(_:any,data:any)=>callback(data);ipcRenderer.on('capture.command',handler);return ()=>ipcRenderer.removeListener('capture.command',handler); },
  onWarning: (callback:(event:any)=>void) => { const handler=(_:any,data:any)=>callback(data);ipcRenderer.on('session.warning',handler);return ()=>ipcRenderer.removeListener('session.warning',handler); },
  stopSession: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_STOP),
  captureQuestion: (payload:any) => ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_QUESTION,payload),
  askAnswer: (payload: any) => ipcRenderer.invoke(IPC_CHANNELS.ANSWER_ASK, payload),
  cancelAnswer: () => ipcRenderer.invoke(IPC_CHANNELS.ANSWER_CANCEL),
  sendWindowCommand: (payload: any) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_COMMAND, payload),
  listHistory: (payload?: any) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_LIST, payload),
  deleteHistory: (payload: any) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_DELETE, payload),
  exportHistory: (payload: any) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_EXPORT, payload),
  pickDocument: () => ipcRenderer.invoke(IPC_CHANNELS.DOCUMENT_PICK),
  confirmDocument: (payload: any) => ipcRenderer.invoke(IPC_CHANNELS.DOCUMENT_CONFIRM, payload),

  onTranslation: (callback:(data:any)=>void) => {const handler=(_:any,data:any)=>callback(data);ipcRenderer.on('translation.event',handler);return ()=>ipcRenderer.removeListener('translation.event',handler);},
  onTranscript: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('transcript.event', handler);
    return () => ipcRenderer.removeListener('transcript.event', handler);
  },
  onAnswer: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('answer.event', handler);
    return () => ipcRenderer.removeListener('answer.event', handler);
  },
  onSessionState: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('session.state', handler);
    return () => ipcRenderer.removeListener('session.state', handler);
  }
};

contextBridge.exposeInMainWorld('api', api);

export type ElectronApi = typeof api;
