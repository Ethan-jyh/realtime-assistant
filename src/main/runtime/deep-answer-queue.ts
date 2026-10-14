export interface DeepJob {question:string;kind:string;image?:string;automatic?:boolean}
/** Independent FIFO; pausing restores the active question and invalidates late callbacks. */
export class DeepAnswerQueue {
 private pending:DeepJob[]=[];private current:{job:DeepJob;controller:AbortController}|null=null;private held=false;private automatic=true;
 constructor(private run:(job:DeepJob,signal:AbortSignal,complete:()=>void)=>Promise<void>){}
 offer(job:DeepJob){if(job.automatic&&!this.automatic)return;this.pending.push(job);this.drain();}
 pause(restore=true){this.held=true;const active=this.current;this.current=null;if(active){if(restore)this.pending.unshift(active.job);active.controller.abort();}}
 setAutomatic(enabled:boolean){this.automatic=enabled;if(!enabled){this.pending=this.pending.filter(job=>!job.automatic);const active=this.current;if(active?.job.automatic){this.current=null;active.controller.abort();}}this.drain();}
 resume(){this.held=false;this.drain();}
 stop(){this.pause(false);this.pending=[];}
 private drain(){if(this.held||this.current||!this.pending.length)return;const active={job:this.pending.shift()!,controller:new AbortController()};this.current=active;
  const complete=()=>{if(this.current!==active)return;this.current=null;queueMicrotask(()=>this.drain());};
  void this.run(active.job,active.controller.signal,complete).catch(()=>{}).finally(complete);
 }
}
