import { test, expect } from 'vitest';
import { validateIpcPayload } from '../src/shared/ipc';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';
test('接受零到一的不透明度，拒绝越界和缺失值',()=>{
  expect(validateIpcPayload(IPC_CHANNELS.WINDOW_COMMAND,{action:'set_opacity',opacity:0.4}).opacity).toBe(0.4);
  expect(validateIpcPayload(IPC_CHANNELS.WINDOW_COMMAND,{action:'set_opacity',opacity:0}).opacity).toBe(0);
  for(const opacity of [-0.01,1.01,NaN])expect(()=>validateIpcPayload(IPC_CHANNELS.WINDOW_COMMAND,{action:'set_opacity',opacity})).toThrow();
  expect(()=>validateIpcPayload(IPC_CHANNELS.WINDOW_COMMAND,{action:'set_opacity'})).toThrow();
});

import {ExtraSettingsStore} from '../src/main/settings/extras';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('零不透明度保存后可读取，不回退为默认配置',async()=>{const dir=await mkdtemp(join(tmpdir(),'zero-opacity-'));try{const store=new ExtraSettingsStore(join(dir,'settings.json'));await store.save({opacity:0,asr:null});expect((await store.load()).opacity).toBe(0);}finally{await rm(dir,{recursive:true,force:true});}});
