import {DeepAnswers} from '../components/DeepAnswers';
import {useOpacityShortcuts} from '../hooks/useOpacityShortcuts';
import {useWindowDrag} from '../hooks/useWindowDrag';
import {MarkdownAnswer} from '../components/MarkdownAnswer';
import React,{useState,useEffect,useRef,useReducer,useLayoutEffect} from 'react';
import {answerCardsReducer,answerCardLabel,type CardEvent} from '../../../shared/answer-cards';
import {speakerLabel,speakerRole,isPeerSpeech} from '../../../shared/speakers';
export function OverlayPage():React.JSX.Element {
 const [showTranscripts,setShowTranscripts]=useState(true),[deepProfileId,setDeepProfileId]=useState(''),[deepProfiles,setDeepProfiles]=useState<any[]>([]);
 const dragRef=useWindowDrag('overlay');
 const [mouseMode,setMouseMode]=useState<any>({enabled:false,held:false,available:false});
 const [audioBusy,setAudioBusy]=useState(false);
 const [pendingQuestions,setPendingQuestions]=useState(0);const queueVersion=useRef(0);
 const [answerCards,dispatchAnswers]=useReducer(answerCardsReducer,[]);
 const answerScroll=useRef<HTMLDivElement>(null);const followLatestAnswer=useRef(true);const answerScrollTop=useRef(0);const [showLatestAnswer,setShowLatestAnswer]=useState(false);
 const [status,setStatus]=useState('就绪'),[expanded,setExpanded]=useState(true);
 const [session,setSession]=useState<any>({state:'idle',transcripts:[],form:{}}),[rows,setRows]=useState<any[]>([]),[question,setQuestion]=useState(''),[fontSize,setFontSize]=useState(13),[warning,setWarning]=useState(''),[elapsed,setElapsed]=useState(0);
 useOpacityShortcuts(setStatus,setWarning);
 const active=useRef<string|null>(null);const sessionVersion=useRef(0);const currentSessionId=useRef<string|null>(null);const bottom=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  let hydrating=true;let disposed=false;let bufferedEvents:CardEvent[]=[];
  const updateAnswerStatus=(e:CardEvent)=>{
   if(e.status?.lane==='deep')return;
   if(e.status?.state==='started'){active.current=e.status.requestId??null;setStatus('生成中');return;}
   if(e.status?.requestId&&e.status.requestId!==active.current)return;
   if(e.status?.state==='completed')setStatus(e.status.finishReason==='interrupted'?'停止接收':`完成 (${e.status.finishReason})`);
   if(e.status?.state==='cancelled')setStatus('停止接收');
   if(e.status?.state==='error')setStatus(`错误: ${e.status.error}`);
  };
  const unsubs=[window.api.onAnswerQueue((e:any)=>{queueVersion.current++;setPendingQuestions(e.pending??0);}),window.api.onInteraction(setMouseMode),window.api.onTranslation((e:any)=>setRows(prev=>prev.map(x=>x.sourceId===e.sourceId&&x.streamEpoch===e.streamEpoch&&x.segmentId===e.segmentId?{...x,translation:e.translation}:x))),window.api.onSessionState((s:any)=>{setSession(s);if(s.state==='starting'&&s.id!==currentSessionId.current){currentSessionId.current=s.id;sessionVersion.current++;active.current=null;queueVersion.current++;setPendingQuestions(0);setRows([]);followLatestAnswer.current=true;answerScrollTop.current=0;setShowLatestAnswer(false);dispatchAnswers({type:'clear'});bufferedEvents=[];hydrating=false;setExpanded(true);setStatus('正在启动…');}}),window.api.onTranscript((e:any)=>setRows(prev=>{if(e.deleted)return prev.filter(x=>!(x.sourceId===e.sourceId&&x.streamEpoch===e.streamEpoch&&x.segmentId===e.segmentId));const next=[...prev];const i=next.findIndex(x=>x.sourceId===e.sourceId&&x.streamEpoch===e.streamEpoch&&x.segmentId===e.segmentId);if(i<0)next.push(e);else next[i]=e;return next;})),window.api.onWarning((e:any)=>setWarning(e.message)),window.api.onAnswer((e:CardEvent)=>{
   if(hydrating){bufferedEvents.push(e);return;}
   dispatchAnswers({type:'event',event:e});updateAnswerStatus(e);
  })];
  void window.api.sendWindowCommand({action:'get_mouse_mode'}).then(setMouseMode);
  const version=sessionVersion.current;const initialQueueVersion=queueVersion.current;
  void window.api.getSession().then((s:any)=>{
   if(disposed||version!==sessionVersion.current)return;
   currentSessionId.current=s.id;setSession(s);setRows(s.transcripts||[]);
   dispatchAnswers({type:'hydrate',answers:s.answers||[],bufferedEvents});
   active.current=s.answers?.findLast((answer:any)=>answer.state==='generating'&&answer.lane!=='deep')?.requestId??null;
   if(active.current)setStatus('生成中');
   for(const event of bufferedEvents){const saved=s.answers?.find((answer:any)=>answer.requestId===event.status?.requestId);if(event.status?.sequence!==undefined&&saved?.sequence!==undefined&&event.status.sequence<=saved.sequence)continue;updateAnswerStatus(event);}
   bufferedEvents=[];hydrating=false;
   if(queueVersion.current===initialQueueVersion)setPendingQuestions(s.pendingQuestions??0);
  }).catch((error:any)=>{
   if(disposed||version!==sessionVersion.current)return;
   for(const event of bufferedEvents){dispatchAnswers({type:'event',event});updateAnswerStatus(event);}
   bufferedEvents=[];hydrating=false;setWarning(error.message??'会话恢复失败，请重试');
  });
  return ()=>{disposed=true;unsubs.forEach(fn=>fn());};
 },[]);
 useEffect(()=>{
  const display=(s:any)=>{setShowTranscripts(s.showTranscripts!==false);setDeepProfileId(s.deepProfileId??'');if(s.deepProfiles)setDeepProfiles(s.deepProfiles);};
  const refresh=()=>{void window.api.getSettings().then(display);void window.api.listProfiles().then((s:any)=>setDeepProfiles(s.profiles.filter((p:any)=>p.answerProvider!=='realtime')));};
  refresh();const off=window.api.onDisplaySettings(display);return off;
 },[]);
 useEffect(()=>{const t=setInterval(()=>setElapsed(session.startedAt?Math.max(0,Math.floor((Date.now()-session.startedAt)/1000)):0),1000);return ()=>clearInterval(t);},[session.startedAt]);
 useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest'});},[rows]);
 useLayoutEffect(()=>{
  const scroll=answerScroll.current;if(!scroll||scroll.clientHeight===0)return;
  if(followLatestAnswer.current){scroll.scrollTop=scroll.scrollHeight;answerScrollTop.current=scroll.scrollTop;setShowLatestAnswer(false);}
  else{scroll.scrollTop=answerScrollTop.current;setShowLatestAnswer(scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop>48);}
 },[answerCards,expanded,fontSize]);
 const onAnswerScroll=()=>{
  const scroll=answerScroll.current;if(!scroll)return;
  answerScrollTop.current=scroll.scrollTop;
  followLatestAnswer.current=scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<=48;
  setShowLatestAnswer(!followLatestAnswer.current);
 };
 const viewLatestAnswer=()=>{
  const scroll=answerScroll.current;if(!scroll)return;
  followLatestAnswer.current=true;scroll.scrollTop=scroll.scrollHeight;answerScrollTop.current=scroll.scrollTop;setShowLatestAnswer(false);
 };

 const running=['starting','running','stopping'].includes(session.state);
 const autoAvailable=running&&session.form.audioEnabled!==false&&session.form.recordMode!=='mic';
 const fastCards=answerCards.filter(c=>c.lane!=='deep'),deepCards=answerCards.filter(c=>c.lane==='deep');
 const capturing=running&&session.form.audioEnabled!==false;const generating=answerCards.some(card=>card.state==='generating')||status==='正在发送…';
 const perform=async(action:()=>Promise<any>)=>{setWarning('');try{return await action();}catch(e:any){setWarning(e.message??'操作失败，请重试');}};
 const ask=async(kind='knowledge')=>{const q=question.trim()||(rows.filter(x=>x.isFinal&&isPeerSpeech(x.sourceId)).at(-1)??rows.filter(x=>x.isFinal).at(-1))?.text;if(!q){setWarning('请输入问题或等待确认转写');return;}setWarning('');setStatus('正在发送…');try{await window.api.askAnswer({question:q,kind});setQuestion('');}catch(e:any){setStatus('请求失败');setWarning(e.message);}};
 const captureQuestion=async()=>{setWarning('');setStatus('正在发送…');try{await window.api.captureQuestion({question:question||'请分析屏幕中的问题并作答。'});}catch(e:any){setStatus('请求失败');setWarning(e.message);}};
 useEffect(()=>window.api.onScreenshotShortcut(()=>{void captureQuestion();}),[question]);
 const toggle=async()=>{const result=await window.api.sendWindowCommand({action:'toggle_expand'});setExpanded(result.expanded);};
 const stopAnswer=async()=>{await window.api.cancelAnswer();dispatchAnswers({type:'event',event:{status:{state:'cancelled',requestId:active.current??undefined}}});setStatus('停止接收');};
 const pause=async()=>{if(audioBusy)return;setAudioBusy(true);await perform(()=>window.api.updateSession({paused:!session.form.paused}));setAudioBusy(false);};
 const end=async()=>{setStatus('正在结束并保存…');try{const result=await window.api.stopSession();setStatus(result.recordingSaved===false?'会话已结束，录音保存失败':'会话已结束，记录已保存');}catch(e:any){setStatus(`保存失败: ${e.message}`);}};
 return <div ref={dragRef} className={`shell ${expanded?'':'compact'}`}><div className="glass">
 <header className="titlebar overlay-header"><button className="button small" onClick={()=>perform(toggle)}>{expanded?'收起':'展开'}</button><span><i className={running?'indicator recording':'indicator'}/>{running?`${Math.floor(elapsed/60).toString().padStart(2,'0')}:${(elapsed%60).toString().padStart(2,'0')}`:'企业微信私有版'}</span><div className="controls">
 <button className="icon-btn" aria-label="打开设置" onClick={()=>perform(()=>window.api.sendWindowCommand({action:'show_prepare',view:'settings'}))}>⚙</button><button className="icon-btn" aria-label="最小化浮窗" title="最小化，继续运行" onClick={()=>perform(()=>window.api.sendWindowCommand({action:'minimize_overlay'}))}>−</button><button className="icon-btn" aria-label="完全退出" title="停止采集、保存会话并退出" onClick={()=>perform(()=>window.api.sendWindowCommand({action:'quit_app'}))}>×</button></div></header>
 <div className="overlay-content">{!running&&<div className="session-entry"><div><strong>准备就绪</strong></div><button className="button primary" onClick={()=>perform(()=>window.api.sendWindowCommand({action:'show_prepare'}))}>开始</button></div>}<div className="overlay-tools"><button className="button small" onClick={()=>perform(async()=>setMouseMode(await window.api.sendWindowCommand({action:'set_mouse_through',enabled:!mouseMode.enabled})))}>{mouseMode.enabled?'穿透：开':'穿透：关'}</button> <button style={{display:session.form.mode==='academic'?'none':undefined}} className={`button small ${session.form.auto?'primary':''}`} disabled={!autoAvailable} title={autoAvailable?'只对系统音频中的对方发言生成回答':'自动回答需要开启对方的系统音频转写'} onClick={()=>perform(()=>window.api.updateSession({auto:!session.form.auto}))}>{autoAvailable?(session.form.auto?'自动回答：开':'自动回答：关'):'自动回答'}</button>
 <button className="button small" aria-label="显示转写" aria-pressed={showTranscripts} onClick={()=>perform(()=>window.api.saveSettings({showTranscripts:!showTranscripts}))}>{showTranscripts?'转写：显示':'转写：隐藏'}</button>
 <button className="icon-btn" aria-label="减小文字" onClick={()=>setFontSize(Math.max(11,fontSize-1))}>字号 −</button><span className="font-value" aria-live="polite">{fontSize} px</span><button className="icon-btn" aria-label="增大文字" onClick={()=>setFontSize(Math.min(22,fontSize+1))}>字号 +</button>
</div>{running&&session.form.audioEnabled===false&&<p className="status session-mode">文字模式</p>}<div className="overlay-toolbar"><span className="status">{status}{pendingQuestions>0&&<span className="answer-queue" data-testid="answer-queue"> · 待答 {pendingQuestions} 段</span>}</span><div className="row"><button className="button small" disabled={!capturing||audioBusy} title={capturing?'暂停或继续音频转写':'当前没有音频采集'} onClick={pause}>{audioBusy?'正在切换…':session.form.paused?'继续录音':'暂停录音'}</button><button className="button small" disabled={!generating} onClick={()=>perform(stopAnswer)}>停止接收</button><button className="button small" disabled={!running} onClick={end}>结束并保存</button></div></div>
 {warning&&<p className="error" role="alert">{warning}</p>}
 <div className={`assist-columns parallel-columns ${showTranscripts?'':'without-transcripts'}`} style={{fontSize}}>{showTranscripts&&<section className="transcript-panel"><h3>对话</h3><div className="transcript-scroll">{rows.length?rows.map((row,i)=><div key={i} className={'transcript-line speaker-'+speakerRole(row.sourceId)+' '+(row.isFinal?'':'provisional')}><span className="speaker-label">{speakerLabel(row.sourceId)}</span><p>{row.text||'…'}</p>{row.translation&&<p className="translated">译文：{row.translation}</p>}</div>):<p className="empty">{running?(session.form.audioEnabled===false?'文字模式：在右侧输入问题或截图提问':session.form.paused?'音频采集已暂停':'正在听取所选音频…'):'等待对话…'}</p>}<div ref={bottom}/></div></section>}
 <section className="answer-panel" style={{position:'relative'}}><div className="lane-heading"><h3>快速</h3></div><div className="overlay-answer" ref={answerScroll} onScroll={onAnswerScroll}>{fastCards.length?fastCards.map((card,index)=><article className="answer-card" data-request-id={card.requestId} data-state={card.state} key={card.requestId}><header className="answer-card-header"><strong>{card.question||`问题 ${index+1}`}</strong><span className={`answer-card-state ${card.state}`} role="status">{answerCardLabel(card)}</span></header>{card.text?<MarkdownAnswer text={card.text}/>:<p className="answer-card-placeholder">{card.state==='generating'?'等待助手输出…':card.state==='error'?'未生成回答':'尚无回答内容'}</p>}</article>):<p className="empty">等待助手输出...</p>}</div>{showLatestAnswer&&<button className="button small" style={{position:'absolute',bottom:10,right:10,zIndex:1}} onClick={viewLatestAnswer}>查看最新回答</button>}</section><DeepAnswers cards={deepCards} profiles={deepProfiles} selected={deepProfileId} onSelect={id=>void perform(()=>window.api.saveSettings({deepProfileId:id||null}))}/></div>
 <div className="row assist-actions"><button className="button small" onClick={()=>ask('knowledge')}>知识问答</button><button className="button small" onClick={()=>ask(session.form.mode==='academic'?'document':'profile')}>{session.form.mode==='academic'?'资料问答':'简历项目问答'}</button><button className="button small" onClick={()=>ask('translate')}>翻译</button><button className="button small" onClick={()=>void captureQuestion()}>截图提问</button></div>
 <div className="composer"><textarea aria-label="浮窗问题" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();void ask();}}} placeholder="输入问题，或 ⌘ Enter 对当前问题生成回答"/><button className="button primary" onClick={()=>ask()}>生成回答</button></div>
 <div className="overlay-bottom"><span>{mouseMode.enabled?(mouseMode.available?'按住 ⌥ 可点击/拖动 · ⌥1 显示/隐藏 · ` 切换穿透':'穿透暂不可用，窗口可直接点击'):'⌥1 显示/隐藏 · ` 切换穿透'}</span><span>{autoAvailable&&session.form.auto?'自动模式':'手动模式'} · {session.state}</span><span>⌘ ⇧ O 唤醒</span></div></div>
 </div></div>;
}
