export type AnswerCardState='generating'|'completed'|'error'|'cancelled';
export interface AnswerCard {requestId:string;lane?:'fast'|'deep';question:string;text:string;state:AnswerCardState;error?:string;finishReason?:string;automatic?:boolean;segmentIds?:string[];sequence?:number}
export interface CardEvent {text?:string;question?:string;automatic?:boolean;segmentIds?:string[];status?:{requestId?:string;lane?:'fast'|'deep';state:string;sequence?:number;question?:string;automatic?:boolean;segmentIds?:string[];error?:string;finishReason?:string}}
interface SavedAnswer {requestId:string;lane?:'fast'|'deep';question?:string;text?:string;state?:string;error?:string;finishReason?:string;automatic?:boolean;segmentIds?:string[];sequence?:number}
export type AnswerCardsAction={type:'event';event:CardEvent}|{type:'hydrate';answers:SavedAnswer[];bufferedEvents?:CardEvent[]}|{type:'clear'};
export function answerCardsReducer(cards:AnswerCard[],action:AnswerCardsAction):AnswerCard[]{
 if(action.type==='clear')return [];
 if(action.type==='hydrate'){
  const live=new Map(cards.map(card=>[card.requestId,card]));
  const restored=action.answers.filter(answer=>answer.requestId).map(answer=>live.get(answer.requestId)??{
   requestId:answer.requestId,lane:answer.lane??'fast',question:answer.question??'',text:answer.text??'',
   state:answer.state==='failed'||answer.state==='error'?'error':answer.state==='cancelled'?'cancelled':answer.state==='generating'?'generating':'completed',
   error:answer.error,finishReason:answer.finishReason,automatic:answer.automatic,segmentIds:answer.segmentIds,sequence:answer.sequence
  } as AnswerCard);
  const restoredIds=new Set(restored.map(card=>card.requestId));
  const merged=[...restored,...cards.filter(card=>!restoredIds.has(card.requestId))];
  return (action.bufferedEvents??[]).reduce((current,event)=>answerCardsReducer(current,{type:'event',event}),merged);
 }
 const {event}=action;const status=event.status;const requestId=status?.requestId;
 if(!requestId||!status)return cards;
 const index=cards.findIndex(card=>card.requestId===requestId);
 if(index>=0&&status.sequence!==undefined&&cards[index].sequence!==undefined&&status.sequence<=cards[index].sequence!)return cards;
 if(status.state==='started'){
  if(index>=0)return cards;
  return [...cards.map(card=>card.state==='generating'&&(card.lane??'fast')===(status.lane??'fast')?{...card,state:'cancelled' as const}:card),{
   requestId,lane:status.lane??'fast',question:status.question??event.question??'',text:'',state:'generating',automatic:status.automatic??event.automatic,segmentIds:status.segmentIds??event.segmentIds,sequence:status.sequence
  }];
 }
 if(status.state==='question'&&index>=0){const next=[...cards];next[index]={...cards[index],question:status.question??event.question??cards[index].question,sequence:status.sequence??cards[index].sequence};return next;}
 // Unknown requests and terminal cards cannot accept delayed stream callbacks.
 if(index<0||cards[index].state!=='generating')return cards;
 const card={...cards[index]};
 if(status.sequence!==undefined)card.sequence=status.sequence;
 if(event.text)card.text+=event.text;
 if(status.state==='completed'){card.state=status.finishReason==='interrupted'?'cancelled':'completed';card.finishReason=status.finishReason;}
 else if(status.state==='cancelled'){card.state='cancelled';card.finishReason=status.finishReason;}
 else if(status.state==='error'){card.state='error';card.error=status.error;}
 const next=[...cards];next[index]=card;return next;
}
export function answerCardLabel(card:AnswerCard):string{
 if(card.state==='generating')return '生成中';
 if(card.state==='cancelled')return card.finishReason==='revised'?'已按补充更新':'停止接收';
 if(card.state==='error')return card.error?`错误：${card.error}`:'生成失败';
 return card.finishReason==='length'?'已完成（达到长度限制）':card.finishReason==='content_filter'?'已完成（内容过滤）':'已完成';
}
