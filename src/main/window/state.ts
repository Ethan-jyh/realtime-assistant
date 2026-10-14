import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
export interface OverlayPosition {x:number;y:number;width?:number;height?:number}
function valid(value:unknown):value is OverlayPosition {
 const p=value as OverlayPosition|undefined;
 return !!p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&((p.width===undefined&&p.height===undefined)||(Number.isFinite(p.width)&&Number.isFinite(p.height)&&(p.width??0)>=1&&(p.height??0)>=1));
}
/** Independent of provider profiles; debounce disk writes while dragging. */
export class WindowStateStore {
 private position:OverlayPosition|undefined;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private dirty=false;
 constructor(private path:string,private onError:()=>void=()=>{}){}
 load():OverlayPosition|undefined {
  try{const p:unknown=JSON.parse(readFileSync(this.path,'utf8'));if(valid(p))this.position={x:Math.round(p.x),y:Math.round(p.y),...(p.width!==undefined?{width:Math.round(p.width),height:Math.round(p.height!)}:{})};}catch{}
  return this.position;
 }
 update(p:OverlayPosition):void {
  if(!valid(p))return;
  const next={...this.position,x:Math.round(p.x),y:Math.round(p.y),...(p.width!==undefined?{width:Math.round(p.width),height:Math.round(p.height!)}:{})};
  if(this.position?.x===next.x&&this.position.y===next.y&&this.position.width===next.width&&this.position.height===next.height)return;
  this.position=next;this.dirty=true;
  if(this.timer)clearTimeout(this.timer);
  this.timer=setTimeout(()=>this.flush(),200);this.timer.unref();
 }
 flush():void {
  if(this.timer)clearTimeout(this.timer);this.timer=undefined;
  if(!this.dirty||!this.position)return;
  try{mkdirSync(dirname(this.path),{recursive:true,mode:0o700});const temp=this.path+'.tmp';writeFileSync(temp,JSON.stringify(this.position),{mode:0o600});renameSync(temp,this.path);this.dirty=false;}catch{this.onError();}
 }
}
