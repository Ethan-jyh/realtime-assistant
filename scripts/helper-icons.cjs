const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const run = (file,args) => execFileSync(file,args,{encoding:'utf8'});
function iconName(app,execute){
 const name=execute('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIconFile',path.join(app,'Contents/Info.plist')]).trim();
 if(!name||/[\\/\x00-\x1f]/.test(name)||name==='.'||name==='..')throw Error('Invalid system icon name');
 return name;
}
function helpers(app){
 const root=path.join(app,'Contents/Frameworks');
 return fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&/ Helper(?: \((?:Renderer|GPU|Plugin)\))?\.app$/.test(e.name)).map(e=>path.join(root,e.name));
}
function install(app,execute=run){
 const name=iconName(app,execute),source=path.join(app,'Contents/Resources',name);
 if(!fs.statSync(source).isFile())throw Error('Main system icon missing');
 const list=helpers(app);if(list.length<2)throw Error('Electron system icon helpers missing');
 for(const helper of list){
  const plist=path.join(helper,'Contents/Info.plist'),resources=path.join(helper,'Contents/Resources');
  fs.mkdirSync(resources,{recursive:true});fs.copyFileSync(source,path.join(resources,name));
  let exists=false;try{execute('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIconFile',plist]);exists=true;}catch{}
  execute('/usr/libexec/PlistBuddy',['-c',`${exists?'Set':'Add'} :CFBundleIconFile ${exists?'':'string '}${name}`,plist]);
 }
 verify(app,execute);
}
function verify(app,execute=run){
 const name=iconName(app,execute),expected=fs.readFileSync(path.join(app,'Contents/Resources',name));
 const list=helpers(app);if(list.length<2)throw Error('Electron system icon helpers missing');
 for(const helper of list){
  const plist=path.join(helper,'Contents/Info.plist');
  let selected;try{selected=execute('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIconFile',plist]).trim();}catch{throw Error('Helper system icon declaration missing');}
  if(selected!==name)throw Error('Helper system icon does not match main icon');
  const file=path.join(helper,'Contents/Resources',name);
  if(!fs.existsSync(file)||!fs.readFileSync(file).equals(expected))throw Error('Helper system icon resource does not match main icon');
 }
}
async function afterPack(context){if(context.electronPlatformName==='darwin')install(path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app'));}
module.exports=afterPack;module.exports.install=install;module.exports.verify=verify;
