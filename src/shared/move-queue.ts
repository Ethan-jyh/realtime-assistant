export interface MovePoint {x:number;y:number}
/** At most one IPC in flight. Pending mouse positions collapse to the latest. */
export class LatestMoveQueue {
 private pending:MovePoint|null=null;private busy=false;private last:MovePoint|null=null;private failure:unknown=null;
 private waiters:Array<{resolve:()=>void;reject:(error:unknown)=>void}>=[];sent=0;
 constructor(private send:(point:MovePoint)=>Promise<unknown>){}
 submit(point:MovePoint){this.failure=null;this.pending=point;if(!this.busy)this.flush();}
 drain():Promise<void>{return new Promise((resolve,reject)=>{this.waiters.push({resolve,reject});if(!this.busy)this.flush();});}
 private flush(){
  const point=this.pending;this.pending=null;
  if(!point||(this.last?.x===point.x&&this.last.y===point.y)){this.settle();return;}
  this.busy=true;this.failure=null;this.sent++;
  let delivery:Promise<unknown>;try{delivery=Promise.resolve(this.send(point));}catch(error){delivery=Promise.reject(error);}
  void delivery.then(()=>{this.last=point;},error=>{this.failure=error;}).finally(()=>{this.busy=false;if(this.pending)this.flush();else this.settle();});
 }
 private settle(){for(const waiter of this.waiters.splice(0)){if(this.failure)waiter.reject(this.failure);else waiter.resolve();}}
}
