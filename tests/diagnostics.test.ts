import {test,expect} from 'vitest';
import {mkdtemp,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DiagnosticsLog} from '../src/main/diagnostics/log';
test('diagnostics only stores bounded metadata, rotates and restricts permissions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'diagnostics-'));const log=new DiagnosticsLog(dir,300);
 for(let i=0;i<20;i++)log.write('answer.started',{generation:i,count:2,apiKey:'private-key',text:'private-dialogue',message:'private-error',state:'running'});
 await log.flush();const files=await readdir(dir);expect(files.length).toBeLessThanOrEqual(3);expect(files.length).toBeGreaterThan(1);
 for(const file of files){const path=join(dir,file);const data=await readFile(path,'utf8');expect(data).not.toContain('private');expect(data).toContain('answer.started');expect((await stat(path)).mode&0o777).toBe(0o600);data.trim().split('\n').forEach(line=>expect(JSON.parse(line).data).toHaveProperty('generation'));}
});

test('logs survive reopening and reject sensitive strings disguised as metadata',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'persistent-logs-'));
 const first=new DiagnosticsLog(dir);first.write('app.started',{state:'secret-key',reason:'private-dialogue'});await first.flush();
 const reopened=new DiagnosticsLog(dir);reopened.write('app.started',{count:1});await reopened.flush();
 const data=await readFile(join(dir,'diagnostics.log'),'utf8');expect(data.trim().split('\n')).toHaveLength(2);expect(data).not.toContain('secret');expect(data).not.toContain('private');
});

test('failure classification records category without raw provider error',async()=>{
 const {diagnosticReason}=await import('../src/main/diagnostics/log');
 expect(diagnosticReason(Error('secret-key timeout with private-dialogue'))).toBe('timeout');
 expect(diagnosticReason(Error('NotAllowedError: microphone permission'))).toBe('permission_denied');
});

test('crash location keeps code line while removing message and user path',async()=>{
 const {diagnosticLocations}=await import('../src/main/diagnostics/log');const error=Error('PRIVATE_MESSAGE');error.stack='Error: PRIVATE_MESSAGE\n    at work (/Users/private/person/out/main/index.js:123:45)\n    at secret (/Users/private/person/private.js:3:5)';
 expect(diagnosticLocations(error)).toEqual(['index.js:123:45']);
});

test('unknown metadata keys cannot crash the diagnostic writer',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'log-unknown-'));const log=new DiagnosticsLog(dir);
 expect(()=>log.write('capture.settings',JSON.parse('{"constructor":"private","__proto__":"private"}'))).not.toThrow();await log.flush();
});


test('native capture errors keep safe stage and numeric status only',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-log-'));const log=new DiagnosticsLog(dir);
 log.write('capture.native_error',{stage:'audio_start_failed',status:-10863,reason:'device_unavailable',message:'PRIVATE_AUDIO',key:'PRIVATE_KEY'});await log.flush();
 const data=JSON.parse((await readFile(join(dir,'diagnostics.log'),'utf8')).trim()).data;
 expect(data).toEqual({stage:'audio_start_failed',status:-10863,reason:'device_unavailable'});
});

test('turn diagnostics link hashed segments and timings without retaining content or reasoning',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'turn-log-'));const log=new DiagnosticsLog(dir);
 log.write('answer.dispatched',{turn:2,queueWaitMs:901,pendingCount:3,segmentKeys:['0123456789abcdef','PRIVATE_SEGMENT'],question:'PRIVATE_QUESTION',reasoning_content:'PRIVATE_REASONING',thinkingEnabled:false});await log.flush();
 const text=await readFile(join(dir,'diagnostics.log'),'utf8');expect(text).not.toContain('PRIVATE');expect(JSON.parse(text).data).toEqual({turn:2,queueWaitMs:901,pendingCount:3,thinkingEnabled:false,segmentKeys:['0123456789abcdef']});
});

test('上下文大小和重连次数可定位延时，但不写入正文',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'context-log-'));const log=new DiagnosticsLog(dir);
 log.write('answer.context',{generation:7,contextCharacters:3210,messageCount:4,transcriptCount:2,referenceCharacters:120,attempt:2,text:'PRIVATE_TEXT'});await log.flush();
 const data=JSON.parse(await readFile(join(dir,'diagnostics.log'),'utf8')).data;
 expect(data).toEqual({generation:7,contextCharacters:3210,messageCount:4,transcriptCount:2,referenceCharacters:120,attempt:2});
});

test('快捷键注册和触发只记录固定动作，不接受任意输入内容',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'shortcut-log-')),log=new DiagnosticsLog(dir);
 log.write('window.shortcut_registered',{shortcut:'opacity_down',enabled:true});log.write('window.shortcut_pressed',{shortcut:'private-dialogue',key:'private-key'});await log.flush();
 const rows=(await readFile(join(dir,'diagnostics.log'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(rows[0].data).toEqual({shortcut:'opacity_down',enabled:true});expect(rows[1].data).toEqual({});
});
