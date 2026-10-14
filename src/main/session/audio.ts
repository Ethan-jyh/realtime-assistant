import {open,rename,mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
export function pcm16(input:Float32Array):Uint8Array{
 const bytes=new Uint8Array(input.length*2),view=new DataView(bytes.buffer);
 input.forEach((sample,i)=>{const x=Number.isFinite(sample)?Math.max(-1,Math.min(1,sample)):0;view.setInt16(i*2,Math.round(x<0?x*32768:x*32767),true);});return bytes;
}
export function wavHeader(bytes:number):Uint8Array{
 if(bytes<0||bytes%2||bytes>0xffffffff-36)throw Error('INVALID_WAV_SIZE');
 const b=new Uint8Array(44),v=new DataView(b.buffer);const tag=(at:number,text:string)=>b.set(new TextEncoder().encode(text),at);
 tag(0,'RIFF');v.setUint32(4,bytes+36,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,bytes,true);return b;
}
export class LocalRecording {
 private file:Awaited<ReturnType<typeof open>>|null=null;private queue=Promise.resolve();private bytes=0;private pending=0;private failed:Error|null=null;
 constructor(readonly path:string){}
 async start(){await mkdir(dirname(this.path),{recursive:true});this.file=await open(this.path+'.part','w');await this.file.write(wavHeader(0));}
 push(bytes:Uint8Array){
  if(this.failed||!this.file)return;
  if(this.pending+bytes.length>32000*10){this.failed=Error('RECORDING_BACKPRESSURE');return;}
  this.pending+=bytes.length;const data=Buffer.from(bytes);
  this.queue=this.queue.then(async()=>{await this.file!.write(data);this.bytes+=data.length;}).catch(e=>{this.failed=e;}).finally(()=>{this.pending-=data.length;});
 }
 async abort(){const file=this.file;this.file=null;this.failed=Error('RECORDING_ABORTED');await file?.close().catch(()=>{});}
 async finish(){await this.queue;const file=this.file;this.file=null;if(!file)return;
  try{await file.write(wavHeader(this.bytes),0,44,0);await file.sync();}finally{await file.close();}
  if(this.failed)throw this.failed;await rename(this.path+'.part',this.path);
 }
}
export async function writeHistory(path:string,record:unknown){await mkdir(dirname(path),{recursive:true});const temp=path+'.tmp';await writeFile(temp,JSON.stringify(record,null,2),{mode:0o600});await rename(temp,path);}
