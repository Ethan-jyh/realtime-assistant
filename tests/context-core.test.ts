import {test,expect} from 'vitest';
import {buildContext} from '../src/main/session/context';
test('资料和确认转写进入上下文，临时转写不进入',()=>{
 const messages=buildContext({name:'张三',projects:'实现缓存',language:'中文',style:'简洁明了'},[{text:'数组是什么',isFinal:true},{text:'临时文字',isFinal:false}],'回答这个问题','profile');
 expect(JSON.stringify(messages)).toContain('实现缓存');expect(JSON.stringify(messages)).toContain('数组是什么');expect(JSON.stringify(messages)).not.toContain('临时文字');
 expect(messages.at(-1)?.content).toBe('回答这个问题');
});

test('区分双方发言并将自定义提示词作为系统指令',()=>{
 const messages=buildContext({customPrompt:'回答先给结论，再给一个实际例子。',language:'中文'},[{sourceId:'microphone',text:'我做过缓存项目',isFinal:true},{sourceId:'system',text:'请解释缓存失效',isFinal:true}] as any,'回答问题');
 expect(messages[0].content).toContain('回答先给结论');expect(messages[1].content).toContain('[我 · 麦克风] 我做过缓存项目');expect(messages[1].content).toContain('[对方 · 系统音频] 请解释缓存失效');
});

test('完整会话不能因超过旧16000字符窗口而丢失早期双方记录',()=>{
 const segments=Array.from({length:30},(_,i)=>({sourceId:i%2?'system':'microphone',text:`发言${i}：`+'合成上下文。'.repeat(160),isFinal:true}));
 const messages=buildContext({},segments,'结合全部发言回答');const context=String(messages[1].content);
 expect(context.includes('[我 · 麦克风] 发言0：')).toBe(true);expect(context.includes('[对方 · 系统音频] 发言29：')).toBe(true);expect([...context.matchAll(/发言(\d+)：/g)].map(x=>Number(x[1]))).toEqual(Array.from({length:30},(_,i)=>i));expect(context).toContain('本次会话完整确认转写');
});

test('已完成回答进入真实assistant历史，待答任务仍是最后一条，取消回答不充当事实',()=>{
 const messages=buildContext({},[{text:'我补充背景',sourceId:'microphone',isFinal:true}],'1. 数组是什么\n2. 链表是什么','knowledge', [{question:'缓存是什么',text:'缓存保存重复使用的数据',state:'completed'},{question:'旧问题',text:'被取消的答案',state:'cancelled'}]);
 expect(messages.some(x=>x.role==='assistant'&&x.content==='缓存保存重复使用的数据')).toBe(true);
 expect(JSON.stringify(messages)).not.toContain('被取消的答案');expect(messages.at(-1)?.content).toContain('2. 链表是什么');expect(messages[0].content).toContain('逐项');
});

test('普通文字回答携带已配置资料与项目，完整双方转写不丢失',()=>{
 const messages=buildContext({documents:'合成唯一事实：部署端口为7123',projects:'商品缓存项目'},[{sourceId:'microphone',text:'我补充部署背景',isFinal:true},{sourceId:'system',text:'部署使用哪个端口？',isFinal:true}],'部署使用哪个端口？');
 expect(String(messages[1].content)).toContain('部署端口为7123');expect(String(messages[1].content)).toContain('商品缓存项目');expect(String(messages[1].content)).toContain('我补充部署背景');
});
test('截图保留旧参考范围，翻译不附加项目资料',()=>{
 const form={documents:'PRIVATE_DOCUMENT',projects:'PRIVATE_PROJECT',language:'中文'};
 expect(JSON.stringify(buildContext(form,[],'图中有什么','knowledge',[],false))).not.toContain('PRIVATE_DOCUMENT');
 expect(JSON.stringify(buildContext(form,[],'hello','translate'))).not.toContain('PRIVATE_PROJECT');
});
