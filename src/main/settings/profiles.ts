import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';import {randomUUID} from 'node:crypto';
import {completionUrl,type ModelSettings} from './model';
import type {AsrSettings,CodexSettings} from './extras';
export interface RealtimeSettings {workspaceId:string;region:'cn-beijing'|'ap-southeast-1';modelName:string;}
export interface ProviderProfile {id:string;name:string;answerProvider:'api'|'codex'|'realtime';model?:ModelSettings;asr?:AsrSettings|null;codex?:CodexSettings;realtime?:RealtimeSettings;}
export class ProviderProfiles {
 private data:{activeId:string;profiles:ProviderProfile[]}={activeId:'',profiles:[]};
 migrated=false;
 private queue=Promise.resolve();private mutations=Promise.resolve();
 constructor(private path:string){}
 static cleanRealtime(value:any):RealtimeSettings {
  if(typeof value?.workspaceId!=='string'||!/^([a-z0-9][a-z0-9-]{0,99})?$/.test(value.workspaceId)||!['cn-beijing','ap-southeast-1'].includes(value.region)||typeof value.modelName!=='string'||!/^qwen[\w.-]{1,100}-realtime(?:-[\d-]+)?$/.test(value.modelName))throw Error('INVALID_REALTIME_SETTINGS');
  return {workspaceId:value.workspaceId,region:value.region,modelName:value.modelName};
 }
 private clean(value:any):ProviderProfile {
  if(typeof value.id!=='string'||!value.id||typeof value.name!=='string'||!value.name.trim()||value.name.length>100||!['api','codex','realtime'].includes(value.answerProvider))throw Error('INVALID_PROVIDER_PROFILE');
  const result:ProviderProfile={id:value.id,name:value.name.trim(),answerProvider:value.answerProvider};
  if(value.model){completionUrl(value.model.baseUrl);if(typeof value.model.modelName!=='string'||!value.model.modelName.trim())throw Error('INVALID_MODEL');result.model={baseUrl:value.model.baseUrl,modelName:value.model.modelName};}
  if(value.asr){const u=new URL(value.asr.endpoint);if(u.protocol!=='wss:'||u.username||u.password||u.search||u.hash||typeof value.asr.modelName!=='string'||!value.asr.modelName)throw Error('INVALID_ASR_SETTINGS');result.asr={provider:'aliyun',endpoint:u.toString(),modelName:value.asr.modelName,language:value.asr.language??'zh'};}else result.asr=null;
  if(value.codex)result.codex={modelName:String(value.codex.modelName??''),effort:String(value.codex.effort??'')};
  if(value.realtime)result.realtime=ProviderProfiles.cleanRealtime(value.realtime);
  return result;
 }
 async initialize(current:Omit<ProviderProfile,'id'|'name'>){
  try{const d=JSON.parse(await readFile(this.path,'utf8'));if(!Array.isArray(d.profiles))throw Error('INVALID_PROFILES');const profiles=d.profiles.map((p:any)=>this.clean(p));if(!profiles.some((p:ProviderProfile)=>p.id===d.activeId)||new Set(profiles.map((p:ProviderProfile)=>p.id)).size!==profiles.length)throw Error('INVALID_PROFILES');this.data={activeId:d.activeId,profiles};}
  catch(e:any){if(e.code!=='ENOENT')throw e;this.migrated=true;const first=this.clean({...current,id:randomUUID(),name:current.answerProvider==='codex'?'Codex':'DeepSeek 问答'});this.data={activeId:first.id,profiles:[first]};await this.persist();}
 }
 snapshot(){return structuredClone(this.data)}
 active(){return structuredClone(this.data.profiles.find(p=>p.id===this.data.activeId)!)}
 upsert(input:Omit<ProviderProfile,'id'> & {id?:string}):Promise<ProviderProfile>{const run=this.mutations.catch(()=>{}).then(()=>this.upsertNow(input));this.mutations=run.then(()=>{},()=>{});return run;}
 private async upsertNow(input:Omit<ProviderProfile,'id'> & {id?:string}){const value=this.clean({...input,id:input.id??randomUUID()});const existing=this.data.profiles.findIndex(p=>p.id===value.id);if(input.id&&existing<0)throw Error('PROFILE_NOT_FOUND');const next=structuredClone(this.data);if(existing<0)next.profiles.push(value);else next.profiles[existing]=value;await this.persist(next);this.data=next;return value;}
 select(id:string):Promise<ProviderProfile>{const run=this.mutations.catch(()=>{}).then(()=>this.selectNow(id));this.mutations=run.then(()=>{},()=>{});return run;}
 private async selectNow(id:string){if(!this.data.profiles.some(p=>p.id===id))throw Error('PROFILE_NOT_FOUND');const next={...this.data,activeId:id};await this.persist(next);this.data=next;return this.active();}
 private persist(data=this.data){const text=JSON.stringify(data);const job=this.queue.catch(()=>{}).then(async()=>{await mkdir(dirname(this.path),{recursive:true});const temp=this.path+'.'+randomUUID()+'.tmp';await writeFile(temp,text,{mode:0o600});await rename(temp,this.path)});this.queue=job;return job;}
}
export const realtimeEndpoint=(config:RealtimeSettings)=>`wss://${config.workspaceId}.${config.region}.maas.aliyuncs.com/api-ws/v1/realtime?model=${encodeURIComponent(config.modelName)}`;
