import {ProviderProfiles,type RealtimeSettings} from './profiles';
import { readFile,writeFile,rename,mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';import { randomUUID } from 'node:crypto';
export interface AsrSettings { provider:string; endpoint:string; modelName:string; language:string; }
export interface CodexSettings {modelName:string;effort:string;}
export interface ExtraSettings { showTranscripts?:boolean;deepProfileId?:string|null; answerProvider?:'api'|'codex'|'realtime';realtime?:RealtimeSettings;codex?:CodexSettings; opacity:number; mouseThrough?:boolean; asr:AsrSettings|null; profile?:Record<string,unknown>; }
export class ExtraSettingsStore {
  private queue:Promise<void>=Promise.resolve();
  constructor(private path:string) {}
  async load():Promise<ExtraSettings> {
    try {
      const obj=JSON.parse(await readFile(this.path,'utf8'));
      if(!Number.isFinite(obj.opacity)||obj.opacity<0||obj.opacity>1)throw Error('INVALID_OPACITY');
      return {showTranscripts:obj.showTranscripts!==false,deepProfileId:typeof obj.deepProfileId==='string'?obj.deepProfileId:null,answerProvider:obj.answerProvider==='codex'?'codex':obj.answerProvider==='realtime'?'realtime':'api',...(obj.realtime?{realtime:ProviderProfiles.cleanRealtime(obj.realtime)}:{}),codex:this.cleanCodex(obj.codex),...(typeof obj.mouseThrough==='boolean'?{mouseThrough:obj.mouseThrough}:{}),opacity:obj.opacity,asr:obj.asr?this.cleanAsr(obj.asr):null,profile:obj.profile??{}};
    }catch(e:any){if(e.code==='ENOENT')return {opacity:1,asr:null,answerProvider:'api',codex:{modelName:'',effort:''}};throw e;}
  }
  cleanCodex(input:any):CodexSettings {const modelName=input?.modelName??'',effort=input?.effort??'';if(typeof modelName!=='string'||modelName.length>200||typeof effort!=='string'||!/^([a-z]{1,32})?$/.test(effort))throw Error('INVALID_CODEX_SETTINGS');return {modelName:modelName.trim(),effort};}
  cleanAsr(input:any):AsrSettings {
    const u=new URL(input.endpoint);
    if(u.protocol!=='wss:'||u.username||u.password||u.search||u.hash)throw Error('INVALID_ASR_ENDPOINT');
    if(typeof input.modelName!=='string'||!input.modelName.trim())throw Error('INVALID_ASR_MODEL');
    return {provider:String(input.provider),endpoint:u.toString(),modelName:input.modelName,language:input.language??'zh'};
  }
  save(settings:ExtraSettings):Promise<void> {
    const text=JSON.stringify({showTranscripts:settings.showTranscripts!==false,deepProfileId:settings.deepProfileId??null,answerProvider:settings.answerProvider??'api',...(settings.realtime?{realtime:ProviderProfiles.cleanRealtime(settings.realtime)}:{}),codex:this.cleanCodex(settings.codex),mouseThrough:settings.mouseThrough??true,opacity:settings.opacity,asr:settings.asr?this.cleanAsr(settings.asr):null,profile:settings.profile??{}});
    const job=this.queue.catch(()=>{}).then(async()=>{
      await mkdir(dirname(this.path),{recursive:true});const temp=`${this.path}.${randomUUID()}.tmp`;
      await writeFile(temp,text,{mode:0o600});await rename(temp,this.path);
    });this.queue=job;return job;
  }
}
