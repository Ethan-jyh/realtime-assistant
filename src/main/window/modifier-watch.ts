import {spawn,type ChildProcess} from 'node:child_process';
import {createInterface,type Interface} from 'node:readline';
export class ModifierWatch {
 private child:ChildProcess|null=null;private lines:Interface|null=null;
 constructor(private path:string,private pulse:(held:boolean)=>void,private failed:()=>void){}
 start(){if(this.child)return;const child=this.child=spawn(this.path,[],{stdio:['ignore','pipe','ignore']});
  const ended=()=>{if(this.child!==child)return;this.child=null;child.kill();this.lines?.close();this.lines=null;this.failed();};
  child.once('error',ended);child.once('exit',ended);
  this.lines=createInterface({input:child.stdout!});this.lines.on('error',ended);this.lines.on('line',line=>{if(this.child===child&&(line==='0'||line==='1'))this.pulse(line==='1');});
 }
 stop(){const child=this.child;this.child=null;this.lines?.close();this.lines=null;child?.kill();}
}
