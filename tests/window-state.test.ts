import {test,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {WindowStateStore} from '../src/main/window/state';
test('浮窗位置在重启后恢复，拖动保存去抖并在退出时刷新',()=>{
 const dir=mkdtempSync(join(tmpdir(),'window-state-')),path=join(dir,'window-state.json');
 try {const store=new WindowStateStore(path);expect(store.load()).toBeUndefined();store.update({x:-1200,y:140});store.update({x:-1150,y:200});store.flush();expect(JSON.parse(readFileSync(path,'utf8'))).toEqual({x:-1150,y:200});expect(new WindowStateStore(path).load()).toEqual({x:-1150,y:200});}finally{rmSync(dir,{recursive:true,force:true});}
});
test('损坏或非法坐标不用于恢复，也不覆盖有效位置',()=>{
 const dir=mkdtempSync(join(tmpdir(),'window-state-')),path=join(dir,'window-state.json');
 try {for(const value of ['bad','null','{"x":null,"y":0}','{"x":0,"y":"2"}']){writeFileSync(path,value);expect(new WindowStateStore(path).load()).toBeUndefined();}const store=new WindowStateStore(path);store.update({x:200,y:100});store.update({x:NaN,y:Infinity});store.flush();expect(store.load()).toEqual({x:200,y:100});}finally{rmSync(dir,{recursive:true,force:true});}
});

test('完整大小持久化，纯移动不丢尺寸，兼容旧版只有坐标的记录',()=>{
 const dir=mkdtempSync(join(tmpdir(),'window-state-')),path=join(dir,'window-state.json');
 try {writeFileSync(path,'{"x":10,"y":20}');const store=new WindowStateStore(path);expect(store.load()).toEqual({x:10,y:20});store.update({x:100,y:200,width:600,height:400});store.update({x:150,y:220});store.flush();expect(new WindowStateStore(path).load()).toEqual({x:150,y:220,width:600,height:400});}finally{rmSync(dir,{recursive:true,force:true});}
});
test('拒绝非法尺寸',()=>{
 const dir=mkdtempSync(join(tmpdir(),'window-state-')),path=join(dir,'window-state.json');
 try {for(const size of [{width:0,height:400},{width:600,height:-1},{width:600},{width:'600',height:400}]){writeFileSync(path,JSON.stringify({x:10,y:20,...size}));expect(new WindowStateStore(path).load()).toBeUndefined();}}finally{rmSync(dir,{recursive:true,force:true});}
});
