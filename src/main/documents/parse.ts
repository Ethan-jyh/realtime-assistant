import {readFile,stat} from 'node:fs/promises';import {extname} from 'node:path';import {Worker} from 'node:worker_threads';
export function checkDocx(bytes:Buffer){
 let e=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){e=i;break;}
 if(e<0)throw Error('INVALID_DOCX');const count=bytes.readUInt16LE(e+10);if(count===65535)throw Error('ZIP64_UNSUPPORTED');
 let offset=bytes.readUInt32LE(e+16),total=0;
 for(let i=0;i<count;i++){
  if(offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('INVALID_DOCX');
  total+=bytes.readUInt32LE(offset+24);if(total>100*1024*1024)throw Error('DOCX_EXPANSION_LIMIT');
  offset+=46+bytes.readUInt16LE(offset+28)+bytes.readUInt16LE(offset+30)+bytes.readUInt16LE(offset+32);
 }
}
export async function parseDocument(path:string):Promise<string>{
 if((await stat(path)).size>50*1024*1024)throw Error('DOCUMENT_TOO_LARGE');
 const ext=extname(path).toLowerCase();if(ext==='.txt')return (await readFile(path,'utf8')).slice(0,200000);
 if(ext==='.docx')checkDocx(await readFile(path));if(!['.pdf','.docx'].includes(ext))throw Error('UNSUPPORTED_DOCUMENT');
 const workerCode=`const {parentPort,workerData}=require('node:worker_threads');const fs=require('node:fs/promises');
 (async()=>{let text='';if(workerData.ext==='.docx'){text=(await require(workerData.mammoth).extractRawText({path:workerData.path})).value;}
 else{const pdf=await import(require('node:url').pathToFileURL(workerData.pdf).href);const doc=await pdf.getDocument({data:new Uint8Array(await fs.readFile(workerData.path)),isEvalSupported:false}).promise;
 for(let i=1;i<=Math.min(doc.numPages,100)&&text.length<200000;i++){const page=await doc.getPage(i);text+=(await page.getTextContent()).items.map(x=>x.str??'').join(' ')+'\n';}await doc.destroy();}
 parentPort.postMessage({text:text.slice(0,200000)});})().catch(()=>parentPort.postMessage({error:'DOCUMENT_PARSE_FAILED'}));`;
 return new Promise((resolve,reject)=>{
  const worker=new Worker(workerCode,{eval:true,workerData:{path,ext,mammoth:require.resolve('mammoth'),pdf:require.resolve('pdfjs-dist/legacy/build/pdf.mjs')},resourceLimits:{maxOldGenerationSizeMb:128}});
  const timer=setTimeout(()=>{void worker.terminate();reject(Error('DOCUMENT_PARSE_TIMEOUT'));},30000);
  worker.once('message',result=>{clearTimeout(timer);void worker.terminate();if(result.error)reject(Error(result.error));else if(!result.text.trim())reject(Error('没有可提取文字，扫描件需要 OCR'));else resolve(result.text);});
  worker.once('error',()=>{clearTimeout(timer);reject(Error('DOCUMENT_PARSE_FAILED'));});
 });
}
