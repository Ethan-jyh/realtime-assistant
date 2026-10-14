import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import type {ModelMessage,ModelRequestOptions,ModelStreamHandlers} from './client';
type Packet=Record<string,any>;
export interface CodexModel {id:string;model?:string;displayName?:string;isDefault?:boolean;defaultReasoningEffort?:string;supportedReasoningEfforts?:{reasoningEffort:string;description?:string}[];inputModalities?:string[];}
export const codexEfforts=(m:CodexModel|undefined):string[]=>[...new Set((m?.supportedReasoningEfforts??[]).map(e=>e.reasoningEffort))];
export function codexInput(messages:ModelMessage[],includeHistory:boolean):Packet[]{return messages.filter(m=>m.role!=='system'&&(includeHistory||m.role==='user')).flatMap(m=>typeof m.content==='string'?[{type:'text',text:includeHistory?`[${m.role}] ${m.content}`:m.content}]:m.content.map(c=>c.type==='text'?{type:'text',text:c.text}:{type:'image',url:c.image_url.url}));}
export function codexPath():string{if(process.env.ASSISTANT_CODEX_PATH)return process.env.ASSISTANT_CODEX_PATH;for(const p of ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex','/Applications/Codex.app/Contents/Resources/codex',join(process.env.HOME??'','.npm-global/bin/codex')])if(existsSync(p))return p;throw Error('未找到Codex CLI，请先安装或打开ChatGPT/Codex应用');}
export class CodexHost extends EventEmitter{
 private child:ChildProcessWithoutNullStreams|null=null;private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();private sequence=0;private starting:Promise<void>|null=null;
 connected=false;signedIn=false;models:CodexModel[]=[];epoch=0;
 constructor(private cwd:string,private createProcess:typeof spawn=spawn){super();mkdirSync(cwd,{recursive:true});}
 async connect():Promise<void>{if(this.connected)return;if(this.starting)return this.starting;const job=this.initialize();this.starting=job;try{await job;}finally{if(this.starting===job)this.starting=null;}}
 private async initialize():Promise<void>{const child=this.createProcess(codexPath(),['app-server','--listen','stdio://','-c','features.shell_tool=false','-c','features.unified_exec=false','-c','features.code_mode=false','-c','features.apps=false','-c','web_search="disabled"','-c','permissions.assistant-text.filesystem={":minimal"="read",":workspace_roots"="read"}','-c','permissions.assistant-text.network.enabled=false','-c','default_permissions="assistant-text"'],{cwd:this.cwd,stdio:['pipe','pipe','pipe']}) as ChildProcessWithoutNullStreams;this.child=child;this.epoch++;
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{if(child!==this.child)return;try{this.receive(JSON.parse(line));}catch{this.fail(Error('Codex协议数据无效'));}});child.stderr.on('data',()=>{});child.once('error',()=>{if(child===this.child)this.fail(Error('Codex启动失败，请检查CLI安装'));});child.once('exit',()=>{lines.close();if(child===this.child)this.fail(Error('Codex进程已退出，请重新连接'));});
 try{await this.rpc('initialize',{clientInfo:{name:'local_realtime_assistant',title:'Local Assistant',version:'0.2.9'},capabilities:{experimentalApi:true}});this.notify('initialized',{});const a=await this.rpc('account/read',{});this.signedIn=!!a.account;
 this.models=[];let cursor:string|null=null;do{const r=await this.rpc('model/list',{limit:100,...(cursor?{cursor}:{})});this.models.push(...r.data);cursor=r.nextCursor??null;}while(cursor&&this.models.length<500);this.connected=true;}catch(e){this.close();throw e;}}
 rpc(method:string,params:Packet):Promise<any>{const child=this.child;if(!child||child.stdin.destroyed)return Promise.reject(Error('Codex尚未连接'));const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex请求超时：'+method));},45000);this.pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(Error('Codex连接中断'));}});});}
 private notify(method:string,params:Packet):void{this.child?.stdin.write(JSON.stringify({method,params})+'\n');}
 private receive(m:Packet):void{if(m.id!==undefined&&!m.method){const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message??'Codex请求失败')):p.resolve(m.result);return;}
 if(m.id!==undefined){this.child?.stdin.write(JSON.stringify(m.method.endsWith('requestApproval')?{id:m.id,result:{decision:'decline'}}:{id:m.id,error:{code:-32601,message:'Text-only client does not support tool execution'}})+'\n');return;}this.emit('notification',m);}
 private fail(error:Error):void{this.connected=false;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.emit('failure',error);}
 close():void{const child=this.child;this.child=null;this.fail(Error('Codex连接已关闭'));child?.kill();}
 async catalog(){await this.connect();return {connected:this.connected,signedIn:this.signedIn,models:this.models.map(m=>({...m,efforts:codexEfforts(m)}))};}
}
export class CodexModelClient{
 readonly host:CodexHost;private tail:Promise<void>=Promise.resolve();private thread:{id:string;key:string;epoch:number}|null=null;
 constructor(cwd:string,host?:CodexHost){this.host=host??new CodexHost(cwd);}
 streamChat(options:ModelRequestOptions&{codexEffort?:string},handlers:ModelStreamHandlers={}):Promise<void>{const run=()=>this.run(options,handlers);const job=this.tail.catch(()=>{}).then(run);this.tail=job;return job;}
 private async run(options:ModelRequestOptions&{codexEffort?:string},handlers:ModelStreamHandlers):Promise<void>{const meta={requestId:options.requestId,generation:options.generation};let terminal=false;let finishResolve:()=>void=()=>{};let turnId:string|null=null;let threadId:string|null=null;const pending:Packet[]=[];const commentary=new Set<string>();
 const finish=(reason:string)=>{if(terminal)return;terminal=true;handlers.onFinish?.(reason,meta);finishResolve();};const fail=(error:Error)=>{if(terminal)return;terminal=true;handlers.onError?.(error,meta);finishResolve();};
 const interrupted=()=>{finish('interrupted');this.host.close();};const onFailure=(e:Error)=>{if(options.signal?.aborted)finish('interrupted');else fail(e);};
 const onNotification=(m:Packet)=>{const p=m.params??{};if(p.threadId!==threadId||terminal)return;if(!turnId){pending.push(m);return;}if((p.turnId??p.turn?.id)!==turnId)return;
 if(m.method==='item/started'&&p.item?.phase==='commentary')commentary.add(p.item.id);
 if(m.method==='item/agentMessage/delta'&&!commentary.has(p.itemId))handlers.onToken?.(p.delta,meta);
 if(m.method==='turn/completed'){p.turn?.status==='failed'?fail(Error(p.turn.error?.message??'Codex生成失败')):finish(p.turn?.status==='interrupted'?'interrupted':'stop');}
 if(m.method==='error'&&!p.willRetry)fail(Error(p.error?.message??'Codex请求失败'));};
 const done=new Promise<void>(resolve=>{finishResolve=resolve;});const timeout=setTimeout(()=>{fail(Error('Codex生成超时，请重试'));this.host.close();},600000);
 this.host.on('notification',onNotification);this.host.on('failure',onFailure);options.signal?.addEventListener('abort',interrupted,{once:true});
 try{if(options.signal?.aborted){finish('interrupted');return;}await this.host.connect();if(terminal)return;if(!this.host.signedIn)throw Error('Codex尚未登录，请先在Codex CLI或ChatGPT应用中登录');
 const model=this.host.models.find(m=>(m.model??m.id)===options.modelName)??(!options.modelName?this.host.models.find(m=>m.isDefault):undefined);if(!model)throw Error('Codex模型不在当前可用目录中，请刷新模型列表');const name=model.model??model.id;const effort=options.codexEffort||model.defaultReasoningEffort;if(effort&&!codexEfforts(model).includes(effort))throw Error('当前Codex模型不支持该思考强度');
 const instructions=options.messages.filter(m=>m.role==='system').map(m=>typeof m.content==='string'?m.content:'').join('\n');const key=createHash('sha256').update(options.sessionId+'\0'+name+'\0'+instructions).digest('hex');const newThread=this.thread?.key!==key;
 if(newThread){const r=await this.host.rpc('thread/start',{model:name,permissions:'assistant-text',approvalPolicy:'on-request',developerInstructions:instructions+'\n只生成文字回答，不调用工具、不读写文件、不执行命令。'});this.thread={id:r.thread.id,key,epoch:this.host.epoch};}
 else if(this.thread!.epoch!==this.host.epoch){await this.host.rpc('thread/resume',{threadId:this.thread!.id,model:name,permissions:'assistant-text',approvalPolicy:'on-request'});this.thread!.epoch=this.host.epoch;}
 if(terminal)return;threadId=this.thread!.id;const r=await this.host.rpc('turn/start',{threadId,input:codexInput(options.messages,newThread),permissions:'assistant-text',...(effort?{effort}:{})});if(terminal)return;turnId=r.turn.id;handlers.onResponse?.();for(const m of pending.splice(0))onNotification(m);await done;
 }catch(error){if(options.signal?.aborted)finish('interrupted');else fail(error instanceof Error?error:Error('Codex请求失败'));}finally{clearTimeout(timeout);options.signal?.removeEventListener('abort',interrupted);this.host.off('notification',onNotification);this.host.off('failure',onFailure);}}
 close():void{this.host.close();}
}
