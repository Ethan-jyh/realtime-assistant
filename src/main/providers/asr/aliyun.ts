import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
export function runTask(taskId:string,modelName:string){return {header:{action:'run-task',task_id:taskId,streaming:'duplex'},payload:{task_group:'audio',task:'asr',function:'recognition',model:modelName,parameters:{format:'pcm',sample_rate:16000},input:{}}};}
export function decodeSentence(event:any){
 const s=event.payload?.output?.sentence;
 if(!s||s.heartbeat||typeof s.text!=='string')return null;
 return {segmentId:String(s.sentence_id??s.begin_time??'unknown'),text:s.text,isFinal:!!s.sentence_end,startMs:s.begin_time??null,endMs:s.end_time??null};
}
export interface AsrOptions {endpoint:string;modelName:string;apiKey:string;workspaceId?:string;timeoutMs?:number;}
export class AliyunAsr {
 private ws:WebSocket|null=null;private taskId=randomUUID();private ready=false;private stopped=false;private ending=false;
 private startResolve:(()=>void)|null=null;private startReject:((e:Error)=>void)|null=null;
 private endResolve:(()=>void)|null=null;private endReject:((e:Error)=>void)|null=null;
 private timer:ReturnType<typeof setTimeout>|null=null;private finishPromise:Promise<void>|null=null;
 constructor(private options:AsrOptions,private onResult:(event:NonNullable<ReturnType<typeof decodeSentence>>)=>void,private onError:(error:Error)=>void){}
 async connect():Promise<void>{
  if(this.stopped)throw Error('ASR_STOPPED');
  return new Promise((resolve,reject)=>{
   this.startResolve=resolve;this.startReject=reject;
   const headers:Record<string,string>={Authorization:'Bearer '+this.options.apiKey};
   if(this.options.workspaceId)headers['X-DashScope-WorkSpace']=this.options.workspaceId;
   const ws=this.ws=new WebSocket(this.options.endpoint,{headers,handshakeTimeout:this.options.timeoutMs??10000});
   this.timer=setTimeout(()=>this.fail(Error('ASR_START_TIMEOUT')),this.options.timeoutMs??10000);
   ws.on('open',()=>{if(this.stopped){ws.terminate();return;}ws.send(JSON.stringify(runTask(this.taskId,this.options.modelName)));});
   ws.on('message',data=>{
    if(this.stopped)return;
    let event:any;try{event=JSON.parse(data.toString());}catch{this.fail(Error('ASR_INVALID_JSON'));return;}
    if(event.header?.task_id!==this.taskId)return;
    switch(event.header.event){
     case 'task-started':this.ready=true;this.clearTimer();this.startResolve?.();this.startResolve=null;this.startReject=null;break;
     case 'result-generated':{const result=decodeSentence(event);if(result)this.onResult(result);break;}
     case 'task-finished':if(!this.ending){this.fail(Error('ASR_TASK_ENDED'));break;}this.clearTimer();this.endResolve?.();this.endResolve=null;this.endReject=null;this.close();break;
     case 'task-failed':this.fail(Error(String(event.header.error_message??event.header.error_code??'ASR_TASK_FAILED').replace(/sk-[A-Za-z0-9_.-]+/g,'[redacted]')));break;
    }
   });
   ws.on('error',e=>this.fail(Error(e.message.replace(/sk-[A-Za-z0-9_.-]+/g,'[redacted]'))));
   ws.on('close',()=>{if(!this.stopped)this.fail(Error('ASR_CONNECTION_CLOSED'));});
  });
 }
 send(bytes:Uint8Array):boolean{
  if(!this.ready||this.stopped||this.ending||this.ws?.readyState!==WebSocket.OPEN)return false;
  if(this.ws.bufferedAmount>16000*2*5)return false;
  try{this.ws.send(bytes);return true;}catch{return false;}
 }
 finish():Promise<void>{if(this.finishPromise)return this.finishPromise;this.finishPromise=this.endTask();return this.finishPromise;}
 private async endTask():Promise<void>{
  if(this.stopped)return;
  this.ending=true;
  if(!this.ready){this.close();return;}
  return new Promise((resolve,reject)=>{
   this.endResolve=resolve;this.endReject=reject;
   this.timer=setTimeout(()=>this.fail(Error('ASR_FINISH_TIMEOUT')),3000);
   this.ws!.send(JSON.stringify({header:{action:'finish-task',task_id:this.taskId,streaming:'duplex'},payload:{input:{}}}));
  });
 }
 close():void{
  if(this.stopped)return;this.stopped=true;this.ready=false;this.clearTimer();
  this.startReject?.(Error('ASR_STOPPED'));this.endReject?.(Error('ASR_STOPPED'));
  this.startResolve=this.endResolve=null;this.startReject=this.endReject=null;
  this.ws?.terminate();this.ws=null;
 }
 private clearTimer(){if(this.timer)clearTimeout(this.timer);this.timer=null;}
 private fail(error:Error){if(this.stopped)return;this.startReject?.(error);this.endReject?.(error);this.startReject=this.endReject=null;const ending=this.ending;this.close();if(!ending)this.onError(error);}
}
