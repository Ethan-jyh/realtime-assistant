// These roles describe capture channels, not biometric speaker identification.
export function speakerRole(sourceId?:string):'self'|'peer'|'unknown'{return sourceId==='microphone'?'self':sourceId==='system'?'peer':'unknown';}
export function speakerLabel(sourceId?:string):string{return sourceId==='microphone'?'我 · 麦克风':sourceId==='system'?'对方 · 系统音频':'来源未确认';}
export function isPeerSpeech(sourceId?:string):boolean{return speakerRole(sourceId)==='peer';}
