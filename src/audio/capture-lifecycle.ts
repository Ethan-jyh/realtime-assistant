export interface CaptureResource {dispose:()=>void|Promise<void>}
/** Commands serialize disposal; generation invalidates streams opened after stop/pause. */
export class CaptureLifecycle<T> {
 private options:T|undefined;private generation=0;private resource:CaptureResource|null=null;
 private tail:Promise<void>=Promise.resolve();
 constructor(private open:(options:T)=>Promise<CaptureResource>){}
 private run(work:()=>Promise<void>):Promise<void>{const job=this.tail.then(work);this.tail=job.catch(()=>{});return job;}
 private async release(){const resource=this.resource;this.resource=null;await resource?.dispose();}
 start(options:T){this.options=options;return this.rebuild();}
 resume(){if(this.options===undefined)return Promise.reject(Error('CAPTURE_NOT_CONFIGURED'));return this.rebuild();}
 private rebuild(){const generation=++this.generation,options=this.options!;return this.run(async()=>{
  await this.release();if(generation!==this.generation)throw Error('CAPTURE_CANCELLED');
  const resource=await this.open(options);if(generation!==this.generation){await resource.dispose();throw Error('CAPTURE_CANCELLED');}this.resource=resource;
 });}
 pause(){++this.generation;return this.run(()=>this.release());}
 stop(){this.options=undefined;++this.generation;return this.run(()=>this.release());}
}
