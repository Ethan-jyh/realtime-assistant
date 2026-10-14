import { test, expect } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const wrapper = require('../scripts/package-mac.cjs');
const manifest = { version: 1, appId: 'local.realtime.assistant', certificateSha1: 'A'.repeat(40), keychain: '/fixture/keychain', certificate: '/fixture/cert' };
const config = { appId: manifest.appId, productName: 'Realtime Assistant', directories: { output: 'release' }, mac: { identity: '-', sign: './scripts/sign-app.cjs' } };
function bundleFixture(dir:string, name='REA') {
  const app=join(dir,name+'.app');
  const values:Record<string,string>={CFBundleName:name,CFBundleExecutable:name,CFBundleIconFile:'app.icns'};
  mkdirSync(join(app,'Contents/Resources'),{recursive:true});
  writeFileSync(join(app,'Contents/Info.plist'),'<plist><dict>'+Object.entries(values).map(([key,value])=>'<key>'+key+'</key><string>'+value+'</string>').join('')+'</dict></plist>');
  const executables=[join(app,'Contents/MacOS',name),...[' Helper',' Helper (Renderer)'].map(suffix=>join(app,'Contents/Frameworks',name+suffix+'.app','Contents/MacOS',name+suffix))];
  for(const executable of executables){mkdirSync(join(executable,'..'),{recursive:true});writeFileSync(executable,Buffer.from('cffaedfe00000000','hex'),{mode:0o755});}
  writeFileSync(join(app,'Contents/Resources/app.icns'),'fixture icon');
  for(const executable of executables.slice(1)){const contents=join(executable,'../..');mkdirSync(join(contents,'Resources'),{recursive:true});writeFileSync(join(contents,'Info.plist'),'fixture');writeFileSync(join(contents,'Resources/app.icns'),'fixture icon');}
  return {app,values,executables,run(file:string,args:string[]){return file==='/usr/libexec/PlistBuddy'?values[args[1].replace('Print :','')]:'';}};
}
test('rejects unsafe environments and CLI overrides before any builder invocation', async () => {
  let called = false;
  const deps = { platform: 'darwin', env: {}, manifest, root: '/fixture/project', getConfig: async () => config, build: async () => { called = true; }, verify() {}, smoke:async()=>{} };
  for (const env of [{ CSC_LINK: 'fixture.p12' }, { CSC_KEY_PASSWORD: 'fixture' }, { CSC_INSTALLER_LINK: 'fixture.p12' }, { GITHUB_BASE_REF: 'main' }]) await expect(wrapper.packageMac([], { ...deps, env })).rejects.toThrow();
  await expect(wrapper.packageMac([], { ...deps, platform: 'linux' })).rejects.toThrow(/requires macOS/);
  await expect(wrapper.packageMac(['--config.mac.identity=null'], deps)).rejects.toThrow(/overrides/);
  expect(called).toBe(false);
});
test('rejects root and platform certificate configuration before builder creates keychains', async () => {
  let called = false;
  for (const bad of [{ ...config, cscLink: 'fixture' }, { ...config, mac: { ...config.mac, cscLink: 'fixture' } }, { ...config, mac: { identity: '-' } }]) {
    await expect(wrapper.packageMac([], { platform: 'darwin', env: {}, manifest, root: '/fixture/project', getConfig: async () => bad, build: async () => { called = true; } })).rejects.toThrow();
  }
  expect(called).toBe(false);
});
test('always post-verifies output and fails if builder skips or produces an invalid signature', async () => {
  let built = false;
  let verified = false;
  await expect(wrapper.packageMac(['--dir'], { platform: 'darwin', env: {}, manifest, root: '/fixture/project', getConfig: async () => config,
    build: async (_file: string, args: string[]) => { built = true; expect(args).toContain('--dir'); expect(args).toContain('--arm64'); },
    verify(app: string, pin: any) { verified = true; expect(app).toBe('/fixture/project/release/mac-arm64/Realtime Assistant.app'); expect(pin.certificateSha1).toBe(manifest.certificateSha1); throw new Error('signature rejected'); }
  })).rejects.toThrow(/signature rejected/);
  expect(built && verified).toBe(true);
});
test('post-verification binds main and both helper identifiers to the pinned certificate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rea-package-verify-'));
  try {
    const fixture=bundleFixture(dir); const app=fixture.app;
    writeFileSync(join(app, 'Contents/Resources/system-audio'), Buffer.from('cffaedfe00000000', 'hex'));
    const calls: string[][] = [];
    wrapper.verifyPackage(app, manifest, (file: string, args: string[]) => {calls.push(args);return fixture.run(file,args);});
    expect(calls[0]).toContain('--deep'); expect(calls[0]).toContain('--strict');
    for (const suffix of ['', '.system-audio', '.option-modifier']) expect(calls.some(args => args.includes('-R=identifier "' + manifest.appId + suffix + '" and anchor H"' + manifest.certificateSha1 + '"'))).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rejects a bundle-name override that breaks Electron helper lookup but allows display-only renaming',async()=>{
 let built=false;
 const deps={platform:'darwin',env:{},manifest,root:'/fixture/project',build:async()=>{built=true;},verify(){},smoke:async()=>{}};
 await expect(wrapper.packageMac(['--dir'],{...deps,getConfig:async()=>({...config,mac:{...config.mac,extendInfo:{CFBundleName:'腾讯会议私有部署'}}})})).rejects.toThrow(/helper/);
 expect(built).toBe(false);
 await wrapper.packageMac(['--dir'],{...deps,getConfig:async()=>({...config,mac:{...config.mac,extendInfo:{CFBundleDisplayName:'腾讯会议私有部署'}}})});
 expect(built).toBe(true);
});

test('verifies consistent Chinese main and Electron helper names plus resource icon',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rea-layout-chinese-'));
 try{const fixture=bundleFixture(dir,'企业微信私有版');expect(()=>wrapper.verifyPackage(fixture.app,manifest,fixture.run)).not.toThrow();}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('rejects a missing Electron helper even when codesign checks return success',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rea-layout-helper-'));
 try{const fixture=bundleFixture(dir);rmSync(fixture.executables[2]);expect(()=>wrapper.verifyPackage(fixture.app,manifest,fixture.run)).toThrow(/helper|Renderer/i);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('rejects a missing app resource icon',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rea-layout-icon-'));
 try{const fixture=bundleFixture(dir);rmSync(join(fixture.app,'Contents/Resources/app.icns'));expect(()=>wrapper.verifyPackage(fixture.app,manifest,fixture.run)).toThrow(/icon/i);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('rejects a missing main executable',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rea-layout-main-'));
 try{const fixture=bundleFixture(dir);rmSync(fixture.executables[0]);expect(()=>wrapper.verifyPackage(fixture.app,manifest,fixture.run)).toThrow(/executable/i);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('rejects traversal and control characters in bundle metadata names',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rea-layout-name-'));
 try{for(const key of ['CFBundleName','CFBundleExecutable','CFBundleIconFile'])for(const value of ['../REA','..','.','REA/other','REA\\other','REA\nother']){
  const fixture=bundleFixture(dir);fixture.values[key]=value;expect(()=>wrapper.verifyPackage(fixture.app,manifest,fixture.run)).toThrow(/invalid/i);
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
