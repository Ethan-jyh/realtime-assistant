/** High-confidence linear residual removal; ambiguous/double-talk frames pass through. */
export class EchoReference {
 private reference=new Float32Array(0);private updatedAt=0;
 frames=0;suppressed=0;correlation=0;
 clear(){this.reference=new Float32Array(0);this.updatedAt=0;}
 push(frame:Float32Array){const next=new Float32Array(Math.min(16000,this.reference.length+frame.length));const keep=Math.max(0,next.length-frame.length);next.set(this.reference.subarray(this.reference.length-keep),0);next.set(frame.subarray(Math.max(0,frame.length-next.length)),keep);this.reference=next;this.updatedAt=Date.now();}
 clean(mic:Float32Array):Float32Array {
  this.frames++;const ref=this.reference,n=mic.length;if(ref.length<n||Date.now()-this.updatedAt>1000)return mic;
  let micEnergy=0;for(let i=0;i<n;i+=16)micEnergy+=mic[i]*mic[i];if(micEnergy<1e-6)return mic;
  let best=0,offset=-1;
  for(let start=0;start<=ref.length-n;start++){
   let dot=0,refEnergy=0;for(let i=0;i<n;i+=16){const x=ref[start+i];dot+=mic[i]*x;refEnergy+=x*x;}
   if(refEnergy<1e-6)continue;const correlation=dot/Math.sqrt(micEnergy*refEnergy);if(correlation>best){best=correlation;offset=start;}
  }
  if(best<.92||offset<0)return mic;
  let dot=0,refEnergy=0,energy=0;for(let i=0;i<n;i++){dot+=mic[i]*ref[offset+i];refEnergy+=ref[offset+i]*ref[offset+i];energy+=mic[i]*mic[i];}
  const correlation=dot/Math.sqrt(energy*refEnergy);this.correlation=correlation;
  const gain=dot/refEnergy;if(correlation<.92||gain<=0||gain>3)return mic;
  this.suppressed++;return mic.map((x,i)=>x-ref[offset+i]*gain*.98);
 }
}
export function microphoneConstraints(deviceId?:string,systemWide=true):MediaStreamConstraints {
 return {audio:{...(deviceId?{deviceId:{exact:deviceId}}:{}),echoCancellation:systemWide?{ideal:'all'} as any:true,noiseSuppression:true,autoGainControl:false,channelCount:{ideal:1},sampleRate:{ideal:16000}}};
}
export async function openMicrophone(deviceId?:string):Promise<MediaStream>{
 try{return await navigator.mediaDevices.getUserMedia(microphoneConstraints(deviceId));}
 catch(error:any){if(error.name!=='TypeError'&&error.name!=='OverconstrainedError')throw error;return navigator.mediaDevices.getUserMedia(microphoneConstraints(deviceId,false));}
}
