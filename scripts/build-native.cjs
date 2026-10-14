const {execFileSync}=require('node:child_process');
const {mkdirSync}=require('node:fs');const {resolve}=require('node:path');
if(process.platform==='darwin'){
 mkdirSync(resolve('build'),{recursive:true});
 execFileSync('xcrun',['swiftc','native/system-audio.swift','-target','arm64-apple-macos14.2','-O','-warnings-as-errors','-o','build/system-audio'],{stdio:'inherit'});
 execFileSync('xcrun',['swiftc','native/option-modifier.swift','-target','arm64-apple-macos13.0','-O','-o','build/option-modifier'],{stdio:'inherit'});
}
