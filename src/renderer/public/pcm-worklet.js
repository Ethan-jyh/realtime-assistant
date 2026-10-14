class PcmWorklet extends AudioWorkletProcessor {
 constructor(){super();this.parts=new Float32Array(1600);this.used=0;}
 process(inputs){const input=inputs[0];if(input?.length){const length=input[0].length;for(let i=0;i<length;i++){
  let sample=0;for(const channel of input)sample+=channel[i]??0;this.parts[this.used++]=sample/input.length;
  if(this.used===1600){const part=this.parts;this.parts=new Float32Array(1600);this.used=0;this.port.postMessage(part,[part.buffer]);}
 }}return true;}
}registerProcessor('pcm-capture',PcmWorklet);
