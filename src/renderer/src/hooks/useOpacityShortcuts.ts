import {useEffect} from 'react';
/** Main-process shortcuts remain usable while the overlay ignores mouse input. */
export function useOpacityShortcuts(show:(text:string)=>void,_fail:(text:string)=>void):void {
 useEffect(()=>window.api.onOpacityChanged(({opacity}:any)=>show(`不透明度：${Math.round(opacity*100)}%`)),[show]);
}
