interface ShortcutOptions {
 register:(key:string,action:()=>void)=>boolean;unregister:(key:string)=>void;
 opacity:(delta:number)=>void;capture:()=>void;onFailure:(key:string)=>void;
}
/** Global while the overlay is visible, including mouse-through mode. */
export class OverlayShortcuts {
 private visible=false;private registered=new Set<string>();
 constructor(private options:ShortcutOptions){}
 setVisible(visible:boolean):void {
  if(this.visible===visible)return;this.visible=visible;
  if(!visible){for(const key of this.registered)this.options.unregister(key);this.registered.clear();return;}
  const bindings:[string,()=>void][]=[['Alt+Left',()=>this.options.opacity(-0.1)],['Alt+Right',()=>this.options.opacity(0.1)],['Control+Z',this.options.capture]];
  for(const [key,fn] of bindings){if(this.options.register(key,()=>{if(this.visible)fn();}))this.registered.add(key);else this.options.onFailure(key);}
 }
 dispose():void {this.setVisible(false);}
}
