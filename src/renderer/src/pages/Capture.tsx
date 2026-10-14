import React,{useEffect} from 'react';
import {EchoReference,openMicrophone} from '../../../audio/echo';
import {CaptureLifecycle} from '../../../audio/capture-lifecycle';
export function CapturePage():React.JSX.Element {
 useEffect(()=>{
  let token=new URLSearchParams(window.location.search).get('captureToken')??'';let paused=true;let inflight=0;let reported=false;let operation:string|undefined;
  const life=new CaptureLifecycle<any>(async(config)=>{
   const tracks:MediaStreamTrack[]=[],nodes:AudioNode[]=[];let closed=false;let nativeRequested=false;let offSystem:(()=>void)|undefined;
   const echo=new EchoReference();const delayed=new Set<ReturnType<typeof setTimeout>>();
   const context=new AudioContext({sampleRate:16000});
   const dispose=async()=>{closed=true;offSystem?.();delayed.forEach(clearTimeout);delayed.clear();echo.clear();tracks.splice(0).forEach(t=>{t.onended=null;t.stop();});nodes.splice(0).forEach(n=>n.disconnect());await Promise.all([context.close().catch(()=>{}),nativeRequested?window.api.systemAudio({token,action:'stop'}).catch(()=>{}):Promise.resolve()]);};
   const send=(sourceId:string,float:Float32Array)=>{
    if(closed||paused)return;
    if(inflight>=40){void window.api.captureStatus({token,state:'warning',message:'音频通道拥塞，部分帧已跳过'});return;}
    const bytes=new Uint8Array(float.length*2),view=new DataView(bytes.buffer);
    float.forEach((v,i)=>{const x=Math.max(-1,Math.min(1,v));view.setInt16(i*2,Math.round(x<0?x*32768:x*32767),true);});
    inflight++;window.api.capturePcm({token,sourceId,bytes}).catch(()=>{if(!reported){reported=true;void window.api.captureStatus({token,state:'warning',message:'音频桥接失败'});}}).finally(()=>inflight--);
   };
   const connect=(stream:MediaStream,sourceId:string)=>{
    tracks.push(...stream.getTracks());const audio=stream.getAudioTracks();if(!audio.length)throw Error('未获得'+sourceId+'音频');
    const source=context.createMediaStreamSource(new MediaStream(audio)),worklet=new AudioWorkletNode(context,'pcm-capture'),gain=context.createGain();
    gain.gain.value=0;source.connect(worklet).connect(gain).connect(context.destination);nodes.push(source,worklet,gain);
    worklet.port.onmessage=e=>{
     const frame=e.data as Float32Array;
     if(sourceId==='system'){echo.push(frame);send(sourceId,frame);return;}
     if(!config.sources.includes('system')){send(sourceId,frame);return;}
     const timer=setTimeout(()=>{delayed.delete(timer);if(closed||paused)return;send(sourceId,echo.clean(frame));if(echo.frames%100===0)void window.api.telemetry('capture.echo',{frames:echo.frames,suppressed:echo.suppressed,correlation:echo.correlation});},120);delayed.add(timer);
    };audio.forEach(t=>t.onended=()=>{if(!closed)void window.api.captureStatus({token,state:'warning',message:sourceId+'音轨已断开，可暂停后继续以重新连接'});});
   };
   try{
    if(context.sampleRate!==16000)throw Error('此设备不支持 16k 音频上下文');
    await context.audioWorklet.addModule(new URL('./pcm-worklet.js',window.location.href).href);
    if(config.sources.includes('microphone')){const mic=await openMicrophone(config.deviceId);const settings=mic.getAudioTracks()[0]?.getSettings();void window.api.telemetry('capture.settings',{sourceId:'microphone',sampleRate:settings?.sampleRate??0,echoCancellation:!!settings?.echoCancellation,noiseSuppression:!!settings?.noiseSuppression,autoGainControl:!!settings?.autoGainControl});connect(mic,'microphone');}
    if(config.sources.includes('system')){
     offSystem=window.api.onSystemAudio((event:{token:string;samples:Float32Array})=>{if(closed||event.token!==token)return;const frame=new Float32Array(event.samples);echo.push(frame);send('system',frame);});
     nativeRequested=true;await window.api.systemAudio({token,action:'start'});
    }
    await context.resume();return {dispose};
   }catch(error){await dispose();throw error;}
  });
  const unsub=window.api.onCapture(async(e:any)=>{
   if(e.action==='stop'){operation=undefined;paused=true;await life.stop();await window.api.captureStatus({token,state:'stopped'});return;}
   if(e.action==='pause'&&e.paused){operation=undefined;paused=true;await life.pause();return;}
   if(e.action!=='start'&&e.action!=='pause')return;
   const commandId=operation=e.commandId;
   if(e.action==='start')token=e.token;paused=true;reported=false;
   try{
    void window.api.telemetry('capture.rebuild');
    if(e.action==='start')await life.start(e);else await life.resume();
    if(operation!==commandId)return;paused=false;await window.api.captureStatus({token,commandId,state:'running'});
   }catch(error:any){if(operation!==commandId)return;paused=true;if(error.message!=='CAPTURE_CANCELLED')await window.api.captureStatus({token,commandId,state:'failed',message:error.message});}
  });
  if(token)void window.api.captureStatus({token,state:'ready'});
  return ()=>{unsub();paused=true;void life.stop();};
 },[]);
 return <span>Audio capture</span>;
}
