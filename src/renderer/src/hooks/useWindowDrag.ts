import {useEffect,useState} from 'react';
import {LatestMoveQueue} from '../../../shared/move-queue';
const interactive='button,input,textarea,select,a,audio,label,[role="button"],.markdown-body,.transcript-scroll,.overlay-answer,.answer,.composer,p,h1,h2,h3,pre';
export function useWindowDrag(target:'prepare'|'overlay'){
 const [root,setRoot]=useState<HTMLDivElement|null>(null);
 useEffect(()=>{
  if(!root)return;
  type Drag={id:number;token:string;startX:number;startY:number;lastX:number;lastY:number;bounds?:{x:number;y:number};ended:boolean;finished:boolean;frame:number;queue:LatestMoveQueue};
  let active:Drag|null=null;
  const endpoint=(drag:Drag)=>({x:Math.round(drag.bounds!.x+drag.lastX-drag.startX),y:Math.round(drag.bounds!.y+drag.lastY-drag.startY)});
  const move=(drag:Drag)=>{drag.frame=0;if(drag.bounds&&!drag.finished)drag.queue.submit(endpoint(drag));};
  const finish=(drag:Drag)=>{
   if(drag.finished)return;drag.ended=true;cancelAnimationFrame(drag.frame);drag.frame=0;
   if(root.hasPointerCapture(drag.id))root.releasePointerCapture(drag.id);
   if(!drag.bounds)return;
   drag.queue.submit(endpoint(drag));drag.finished=true;if(active===drag)active=null;
   // Final coordinate reaches the main process before pass-through is restored.
   void drag.queue.drain().catch(()=>{}).then(()=>window.api.sendWindowCommand({action:'end_drag',target,dragToken:drag.token})).catch(()=>{}).finally(()=>{void window.api.telemetry('drag.end',{mode:target,...endpoint(drag),count:drag.queue.sent});});
  };
  const schedule=(drag:Drag)=>{if(!drag.frame)drag.frame=requestAnimationFrame(()=>move(drag));};
  const down=(e:PointerEvent)=>{
   if(e.button!==0||(active&&!active.ended)||(e.target as Element).closest(interactive))return;
   e.preventDefault();const token=crypto.randomUUID();
   const drag:Drag={id:e.pointerId,token,startX:e.screenX,startY:e.screenY,lastX:e.screenX,lastY:e.screenY,ended:false,finished:false,frame:0,queue:new LatestMoveQueue(point=>window.api.sendWindowCommand({action:'move_window',target,dragToken:token,...point}))};active=drag;
   try{root.setPointerCapture(e.pointerId);}catch{/* Synthetic events have no active native pointer. */}
   void window.api.telemetry('drag.start',{mode:target});
   void window.api.sendWindowCommand({action:'begin_drag',target,dragToken:token}).then((result:any)=>{drag.bounds=result.bounds;if(drag.ended)finish(drag);else schedule(drag);}).catch(()=>{drag.finished=true;if(active===drag)active=null;});
  };
  const motion=(e:PointerEvent)=>{const drag=active;if(!drag||drag.id!==e.pointerId||drag.ended)return;drag.lastX=e.screenX;drag.lastY=e.screenY;schedule(drag);};
  const up=(e:PointerEvent)=>{const drag=active;if(!drag||drag.id!==e.pointerId)return;motion(e);finish(drag);};
  const cancel=(e:PointerEvent)=>{if(active?.id===e.pointerId)finish(active);};
  const interaction=window.api.onInteraction((state:any)=>{if(target==='overlay'&&state.ignoring&&active)finish(active);});
  root.addEventListener('pointerdown',down);window.addEventListener('pointermove',motion);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);
  return ()=>{interaction();if(active)finish(active);root.removeEventListener('pointerdown',down);window.removeEventListener('pointermove',motion);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);};
 },[root,target]);return setRoot;
}
