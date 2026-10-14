const transient=new Set(['REALTIME_CONNECTION_FAILED','REALTIME_CONNECTION_CLOSED','REALTIME_SEND_FAILED','REALTIME_RESPONSE_TIMEOUT','REALTIME_NOT_CONNECTED','REALTIME_STOPPED']);
export function recoverableRealtimeError(error:Error):boolean{return transient.has(error.message);}
export class RealtimeRecovery {
 private attempts=new Map<string,number>();
 allow(items:string[]):boolean {
  if(!items.length||items.some(id=>(this.attempts.get(id)??0)>=3))return false;
  for(const id of new Set(items))this.attempts.set(id,(this.attempts.get(id)??0)+1);
  return true;
 }
 completed(items:string[]):void {for(const id of items)this.attempts.delete(id);}
 clear():void {this.attempts.clear();}
}
