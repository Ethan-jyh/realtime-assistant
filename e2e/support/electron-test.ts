import {test as base} from '@playwright/test';
/** Native Electron/debugger lifetime is isolated per spec, even with one UI worker. */
export function electronTest(file:string){
 return base.extend<{}, {electronSpec:string}>({electronSpec:[file,{scope:'worker',auto:true}]});
}
