export interface MouseThroughState {enabled:boolean;held:boolean;available:boolean;ignoring:boolean;dragging:boolean}
export class MouseThrough {
 private dragging=false;private dragLease:ReturnType<typeof setTimeout>|null=null;
 private enabled=false;private held=false;private available=false;private watchdog:ReturnType<typeof setTimeout>|null=null;
 constructor(private apply:(state:MouseThroughState)=>void){}
 get state():MouseThroughState{return {enabled:this.enabled,held:this.held,available:this.available,ignoring:this.enabled&&this.available&&!this.held&&!this.dragging,dragging:this.dragging};}
 enable(enabled:boolean){this.enabled=enabled;this.publish();}
 pulse(held:boolean){if(this.watchdog)clearTimeout(this.watchdog);const changed=!this.available||this.held!==held;this.available=true;this.held=held;this.watchdog=setTimeout(()=>this.failed(),3000);if(changed)this.publish();}
 setDragging(dragging:boolean){this.clearDrag();this.dragging=dragging;if(dragging)this.touchDrag();this.publish();}
 touchDrag(){if(!this.dragging)return;if(this.dragLease)clearTimeout(this.dragLease);this.dragLease=setTimeout(()=>{this.clearDrag();this.publish();},30000);}
 private clearDrag(){if(this.dragLease)clearTimeout(this.dragLease);this.dragLease=null;this.dragging=false;}
 failed(){this.clearDrag();if(this.watchdog)clearTimeout(this.watchdog);this.watchdog=null;this.available=false;this.held=false;this.publish();}
 dispose(){this.clearDrag();if(this.watchdog)clearTimeout(this.watchdog);this.watchdog=null;this.enabled=false;this.available=false;this.publish();}
 private publish(){this.apply(this.state);}
}
