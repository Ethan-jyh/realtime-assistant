import { test, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelSettingsStore } from '../src/main/settings/store';

test('模型配置重启可恢复，公开文件不写 API Key，非法配置不覆盖原值',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'settings-test-'));const file=join(dir,'settings.json');
  try{
    const store=new ModelSettingsStore(file);
    const settings={baseUrl:'http://localhost:8080/v1',modelName:'own-model',apiKey:'synthetic-key'};
    await store.save(settings);
    expect(await new ModelSettingsStore(file).load()).toEqual({baseUrl:'http://localhost:8080/v1',modelName:'own-model'});
    expect(await readFile(file,'utf8')).not.toContain('synthetic-key');
    await expect(store.save({baseUrl:'bad-url',modelName:'broken'})).rejects.toThrow('INVALID_PREFIX');
    expect((await store.load())?.modelName).toBe('own-model');
  }finally{await rm(dir,{recursive:true,force:true});}
});
