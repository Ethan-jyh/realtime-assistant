import {randomUUID} from 'node:crypto';import {join} from 'node:path';
import {AliyunAsr,AsrOptions,decodeSentence} from '../providers/asr/aliyun';
import {LocalRecording,writeHistory} from './audio';
export type Source='microphone'|'system';
export interface SessionForm { [key:string]:unknown; }
export interface Transcript {sourceId:Source;streamEpoch:number;segmentId:string;text:string;isFinal:boolean;startMs:number|null;endMs:number|null;}
export interface AudioChannel {connect():Promise<void>;send(bytes:Uint8Array):boolean;finish():Promise<void>;close():void;}
export type AudioChannelFactory=(source:Source,options:AsrOptions,onResult:(result:NonNullable<ReturnType<typeof decodeSentence>>)=>void,onError:(error:Error)=>void)=>AudioChannel;
export class CoreSession {
 id:string|null=null;state='idle';form:SessionForm={};segments:Transcript[]=[];answers:any[]=[];startedAt=0;recordingSaved:boolean|null=null;
 private audioOptions=new Map<Source,AsrOptions>();private audioTask:Promise<void>|null=null;private audioTarget=false;
 private channels=new Map<Source,AudioChannel>();private recordings=new Map<Source,LocalRecording>();private epochs=new Map<Source,number>();
 private retry=new Map<Source,{timer:ReturnType<typeof setTimeout>|null;attempt:number}>();private samples=new Map<Source,number>();private gapAt=new Map<Source,number>();private stopPromise:Promise<void>|null=null;private pendingStart:Promise<string>|null=null;
 constructor(private directory:string,private emit:(type:string,data:any)=>void,private final:(text:string,segment:Transcript)=>void,private createChannel:AudioChannelFactory=(_source,options,onResult,onError)=>new AliyunAsr(options,onResult,onError)){}
 snapshot(){return {id:this.id,state:this.state,form:this.form,startedAt:this.startedAt,transcripts:this.segments,answers:this.answers,recordingSaved:this.recordingSaved};}
 async start(form:SessionForm,sources:Source[],asr:AsrOptions|null,record:boolean){
  const job=this.initialize(form,sources,asr,record);this.pendingStart=job;
  try{return await job;}finally{if(this.pendingStart===job)this.pendingStart=null;}
 }
 private async initialize(form:SessionForm,sources:Source[],asr:AsrOptions|null,record:boolean):Promise<string>{
  if(['starting','running','stopping'].includes(this.state))throw Error('SESSION_ALREADY_ACTIVE');
  this.id=randomUUID();this.state='starting';this.form={...form,paused:false};this.audioOptions.clear();this.segments=[];this.answers=[];this.startedAt=Date.now();this.recordingSaved=null;this.stopPromise=null;this.samples.clear();this.retry.clear();this.epochs.clear();this.publish();
  try{
   if(form.audioEnabled!==false){if(!asr)throw Error('ASR_NOT_CONFIGURED');
    for(const source of sources){this.audioOptions.set(source,asr);this.retry.set(source,{timer:null,attempt:0});await this.open(source,asr);if(this.state!=='starting')throw Error('SESSION_CANCELLED');if(record){const writer=new LocalRecording(join(this.directory,this.id,source+'.wav'));await writer.start();this.recordings.set(source,writer);}}
   }
   if(this.state!=='starting')throw Error('SESSION_CANCELLED');this.state='running';this.publish();return this.id;
  }catch(error){for(const c of this.channels.values())c.close();this.channels.clear();for(const w of this.recordings.values())await w.finish().catch(()=>{});this.recordings.clear();if(this.state!=='stopping'){this.state='failed';this.publish();}throw error;}
 }
 private async open(source:Source,options:AsrOptions){
  const epoch=(this.epochs.get(source)??0)+1;this.epochs.set(source,epoch);const id=this.id;
  const offset=Math.floor((this.samples.get(source)??0)/16);
  this.emit('asr.lifecycle',{sourceId:source,epoch,state:'starting',attempt:this.retry.get(source)?.attempt??0});
  const client=this.createChannel(source,options,result=>{
   if(this.id!==id||!['starting','running','stopping'].includes(this.state)||this.epochs.get(source)!==epoch)return;
   const value:Transcript={...result,sourceId:source,streamEpoch:epoch,startMs:result.startMs===null?null:result.startMs+offset,endMs:result.endMs===null?null:result.endMs+offset};
   const index=this.segments.findIndex(x=>x.sourceId===source&&x.streamEpoch===epoch&&x.segmentId===result.segmentId);
   if(!result.text.trim()){
    if(result.isFinal&&index>=0){this.segments.splice(index,1);this.emit('transcript.event',{...value,deleted:true});}
    return;
   }
   if(index>=0&&this.segments[index].isFinal)return;
   // Only recovered recognition clears failures; merely opening a flapping socket does not.
   const retry=this.retry.get(source);if(retry)retry.attempt=0;
   if(index>=0)this.segments[index]=value;else this.segments.push(value);
   this.emit('transcript.event',value);if(result.isFinal&&result.text.trim())this.final(result.text,value);
  },error=>{
   if(this.id!==id||this.epochs.get(source)!==epoch)return;
   this.emit('session.warning',{source,message:error.message});
   this.emit('asr.lifecycle',{sourceId:source,epoch,state:'failed',attempt:this.retry.get(source)?.attempt??0});
   const retry=this.retry.get(source);
   if(this.state!=='running'||this.form.paused||!retry)return;
   if(retry.attempt>=3||/401|403|Invalid|Authentication|余额|balance/i.test(error.message)){this.emit('session.warning',{source,message:'转写连接未恢复，请检查连接或配置，再暂停并继续重试'});return;}
   const delay=1000*2**retry.attempt++;retry.timer=setTimeout(()=>{retry.timer=null;if(this.state==='running'&&!this.form.paused&&this.id===id)this.open(source,options).catch(()=>{});},delay);
  });this.channels.set(source,client);await client.connect();
  if(this.id===id&&this.epochs.get(source)===epoch)this.emit('asr.lifecycle',{sourceId:source,epoch,state:'ready',attempt:this.retry.get(source)?.attempt??0});
 }
 setPaused(paused:boolean):Promise<void>{
  if(this.state!=='running')return Promise.reject(Error('SESSION_NOT_RUNNING'));
  if(this.audioTask)return this.audioTarget===paused?this.audioTask:Promise.reject(Error('AUDIO_TRANSITION_BUSY'));
  this.audioTarget=paused;const job=this.changePaused(paused);this.audioTask=job;
  void job.finally(()=>{if(this.audioTask===job)this.audioTask=null;}).catch(()=>{});return job;
 }
 private async changePaused(paused:boolean):Promise<void>{
  if(!!this.form.paused===paused)return;
  const id=this.id;
  if(paused){
   this.form.paused=true;for(const value of this.retry.values()){if(value.timer)clearTimeout(value.timer);value.timer=null;value.attempt=0;}this.publish();
   const clients=[...this.channels.entries()];await Promise.allSettled(clients.map(([,client])=>client.finish()));
   for(const [source,client] of clients){client.close();if(this.id===id&&this.channels.get(source)===client)this.channels.delete(source);}return;
  }
  try{
   for(const [source,options] of this.audioOptions){
    if(this.id!==id||this.state!=='running')throw Error('SESSION_CANCELLED');
    this.retry.set(source,{timer:null,attempt:0});await this.open(source,options);
   }
   if(this.id!==id||this.state!=='running')throw Error('SESSION_CANCELLED');
   this.form.paused=false;this.publish();
  }catch(error){
   if(this.id===id&&this.state==='running'){for(const client of this.channels.values())client.close();this.channels.clear();this.form.paused=true;this.publish();}
   throw error;
  }
 }
 pcm(source:Source,bytes:Uint8Array){
  if(this.state!=='running'||this.form.paused)return false;
  this.samples.set(source,(this.samples.get(source)??0)+bytes.length/2);
  const sent=this.channels.get(source)?.send(bytes)??false;
  this.recordings.get(source)?.push(bytes);
  if(!sent&&Date.now()-(this.gapAt.get(source)??0)>1000){this.gapAt.set(source,Date.now());this.emit('session.warning',{source,message:'音频发送中断，转写可能有缺口'});}
  return sent;
 }
 async stop(){if(this.stopPromise)return this.stopPromise;this.stopPromise=this.end();return this.stopPromise;}
 private async end(){
  if(!this.id||!['running','starting'].includes(this.state))return;
  const wasStarting=this.state==='starting';this.state='stopping';for(const value of this.retry.values())if(value.timer)clearTimeout(value.timer);this.publish();
  if(wasStarting){for(const c of this.channels.values())c.close();await this.pendingStart?.catch(()=>{});}
  const drained=await Promise.allSettled([...this.channels.values()].map(c=>c.finish()));if(drained.some(x=>x.status==='rejected'))this.emit('session.warning',{message:'ASR 收尾中断，转写可能不完整'});for(const c of this.channels.values())c.close();this.channels.clear();await this.audioTask?.catch(()=>{});
  const writers=[...this.recordings.values()];
  const saves=await Promise.allSettled(writers.map(async w=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([w.finish(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('RECORDING_FINISH_TIMEOUT')),10000);})]);}
    catch(e){void w.abort();throw e;}finally{if(timer)clearTimeout(timer);}
  }));this.recordings.clear();
  this.recordingSaved=writers.length?saves.every(x=>x.status==='fulfilled'):null;
  if(this.recordingSaved===false)this.emit('session.warning',{message:'录音保存失败，未完成文件已保留在会话目录'});
  this.state='stopped';const record={...this.snapshot(),endedAt:Date.now()};
  await writeHistory(join(this.directory,this.id,'session.json'),record);this.publish();return;
 }
 private publish(){this.emit('session.state',this.snapshot());}
}
