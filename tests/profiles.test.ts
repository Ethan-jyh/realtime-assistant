import {test,expect} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ProviderProfiles} from '../src/main/settings/profiles';
test('方案配置隔离、切换持久化，公共文件不保存密钥',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'profiles-'));try{
  const store=new ProviderProfiles(join(dir,'profiles.json'));
  await store.initialize({answerProvider:'api',model:{baseUrl:'https://api.deepseek.com/v1',modelName:'deepseek-flash'},asr:null});
  const original=store.snapshot().activeId;
  const added=await store.upsert({name:'实时问答',answerProvider:'realtime',realtime:{workspaceId:'llm-example',region:'cn-beijing',modelName:'qwen3.8-omni-flash-realtime'}});
  expect(store.snapshot().activeId).toBe(original);
  await store.select(added.id);expect(store.active().realtime?.workspaceId).toBe('llm-example');
  const reopened=new ProviderProfiles(join(dir,'profiles.json'));await reopened.initialize({answerProvider:'codex'});expect(reopened.snapshot().activeId).toBe(added.id);
  expect(await readFile(join(dir,'profiles.json'),'utf8')).not.toMatch(/apiKey|sk-/);
  await expect(store.select('missing')).rejects.toThrow();
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('实时业务空间只能是合法标识，拒绝把URL和密钥当作标识',async()=>{
 expect(()=>ProviderProfiles.cleanRealtime({workspaceId:'https://example.com',region:'cn-beijing',modelName:'qwen3.8-omni-flash-realtime'})).toThrow();
 expect(()=>ProviderProfiles.cleanRealtime({workspaceId:'llm-test',region:'invalid',modelName:'qwen3.8-omni-flash-realtime'})).toThrow();
});

test('并发添加不会覆盖另一套方案',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'profiles-parallel-'));try{const store=new ProviderProfiles(join(dir,'profiles.json'));await store.initialize({answerProvider:'codex'});await Promise.all(['一','二'].map(name=>store.upsert({name,answerProvider:'codex'})));expect(store.snapshot().profiles).toHaveLength(3)}finally{await rm(dir,{recursive:true,force:true})}
});
