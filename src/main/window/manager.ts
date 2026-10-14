import { BrowserWindow, screen, globalShortcut } from 'electron';
import type {OverlayPosition} from './state';
import { windowPolicy, clampBoundsToDisplay, computeToggleBounds, Bounds } from './policy';

export interface WindowManagerOptions {
  preloadPath: string;
  overlayPosition?: OverlayPosition;
  onOverlayVisibility?: (visible:boolean)=>void;
  onOverlayPosition?: (position:OverlayPosition)=>void;
  rendererUrl?: string;
  rendererHtmlPath?: string;
}

export class WindowManager {
  private prepareWindow: BrowserWindow | null = null;
  private overlayWindow: BrowserWindow | null = null;
  private isExpanded = true;
  private activeView:'prepare'|'overlay'='prepare';
  private isProtected = true;
  private opacity = 1;
  private mouseIgnoring=false;
  private mousePassive=false;
  private mousePolicies=new WeakMap<BrowserWindow,{ignore:boolean}>();
  private options: WindowManagerOptions;
  private registeredShortcuts = new Set<string>();

  constructor(options: WindowManagerOptions) {
    this.options = options;
  }

  createPrepareWindow(): BrowserWindow {
    this.activeView='prepare';this.getOverlayWindow()?.hide();
    if (this.prepareWindow && !this.prepareWindow.isDestroyed()) {
      if(this.prepareWindow.isMinimized())this.prepareWindow.restore();this.prepareWindow.show();this.prepareWindow.focus();
      return this.prepareWindow;
    }

    this.prepareWindow = new BrowserWindow({
      width: 620,
      height: 840,
      minWidth: 480,
      minHeight: 620,
      frame: false,
      minimizable: process.platform!=='darwin',
      acceptFirstMouse: true,
      transparent: true,
      hasShadow: false,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.options.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.applyPolicy(this.prepareWindow, 'prepare');

    const prepare=this.prepareWindow;
    this.bindLifecycle(prepare,'prepare');
    prepare.once('ready-to-show',()=>{
      if(!prepare.isDestroyed()&&this.activeView==='prepare'){prepare.show();prepare.focus();}
    });

    this.loadUrl(this.prepareWindow, 'prepare');
    return this.prepareWindow;
  }

  createOverlayWindow(resetExpanded=false): BrowserWindow {
    this.activeView='overlay';this.getPrepareWindow()?.hide();
    if(resetExpanded){this.rememberOverlayBounds();this.isExpanded=true;const overlay=this.getOverlayWindow();if(overlay){const bounds=overlay.getBounds();overlay.setBounds(clampBoundsToDisplay({...bounds,...this.expandedSize()},screen.getDisplayMatching(bounds).workArea));}}
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.showOverlay(this.overlayWindow);
      this.applyPolicy(this.overlayWindow, 'overlay');
      return this.overlayWindow;
    }

    this.isExpanded=true;
    const primaryDisplay = screen.getPrimaryDisplay().workArea;
    const initialBounds: Bounds = {
      x: this.options.overlayPosition?.x ?? primaryDisplay.x + primaryDisplay.width - 880,
      y: this.options.overlayPosition?.y ?? primaryDisplay.y + 60,
      ...this.expandedSize()
    };
    const clamped = clampBoundsToDisplay(initialBounds, screen.getDisplayMatching(initialBounds).workArea);

    this.overlayWindow = new BrowserWindow({
      x: clamped.x,
      y: clamped.y,
      width: clamped.width,
      height: clamped.height,
      frame: false,
      minimizable: process.platform!=='darwin',
      acceptFirstMouse: true,
      transparent: true,
      hasShadow: false,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: this.options.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.applyPolicy(this.overlayWindow, 'overlay');

    const overlay=this.overlayWindow;
    this.bindLifecycle(overlay,'overlay');
    const remember=()=>this.rememberOverlayBounds();
    overlay.on('show',()=>this.options.onOverlayVisibility?.(true));
    overlay.on('restore',()=>this.options.onOverlayVisibility?.(true));
    overlay.on('hide',()=>this.options.onOverlayVisibility?.(false));
    overlay.on('minimize',()=>this.options.onOverlayVisibility?.(false));
    overlay.on('closed',()=>this.options.onOverlayVisibility?.(false));
    overlay.on('move',remember);
    overlay.on('resize',remember);
    overlay.on('close',remember);
    remember();
    overlay.once('ready-to-show',()=>{
      if(overlay.isDestroyed()||this.activeView!=='overlay') return;
      this.showOverlay(overlay);
      this.applyPolicy(overlay,'overlay');
    });

    // blur 不 hide
    this.overlayWindow.on('blur', () => {
      // 保持可见，不调用 hide
    });

    this.loadUrl(this.overlayWindow, 'overlay');
    return this.overlayWindow;
  }

  private expandedSize():{width:number;height:number} {return {width:this.options.overlayPosition?.width??860,height:this.options.overlayPosition?.height??520};}
  rememberOverlayBounds():void {
    const overlay=this.getOverlayWindow();if(!overlay)return;
    const bounds=overlay.getBounds();
    this.options.overlayPosition={...bounds,...(!this.isExpanded?this.expandedSize():{})};
    this.options.onOverlayPosition?.(this.options.overlayPosition);
  }
  wakeOverlay():BrowserWindow {
    const overlay=this.createOverlayWindow();
    const focus=()=>{if(!overlay.isDestroyed()&&this.activeView==='overlay'){overlay.show();overlay.focus();}};
    if(overlay.webContents.isLoading())overlay.once('ready-to-show',focus);else focus();
    return overlay;
  }

  isActiveWindowVisible():boolean {const win=this.activeView==='overlay'?this.getOverlayWindow():this.getPrepareWindow();return !!win&&win.isVisible()&&!win.isMinimized();}
  toggleVisibility():boolean {
    if(this.isActiveWindowVisible()){this.hideWindows();return false;}
    if(this.activeView==='overlay')this.wakeOverlay();else this.createPrepareWindow();
    return true;
  }

  restoreWindow():BrowserWindow {return this.activeView==='overlay'?this.createOverlayWindow():this.createPrepareWindow();}
  minimizeWindow(target:'prepare'|'overlay'):void {
    const win=target==='overlay'?this.getOverlayWindow():this.getPrepareWindow();
    // A native macOS minimize creates a Dock thumbnail even for accessory apps.
    if(process.platform==='darwin')win?.hide();else win?.minimize();
  }
  hideWindows():void {this.getPrepareWindow()?.hide();this.getOverlayWindow()?.hide();}

  getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow && !this.overlayWindow.isDestroyed() ? this.overlayWindow : null;
  }

  getPrepareWindow(): BrowserWindow | null {
    return this.prepareWindow && !this.prepareWindow.isDestroyed() ? this.prepareWindow : null;
  }

  moveWindow(target:'prepare'|'overlay',x:number,y:number):void {
    const win=target==='overlay'?this.getOverlayWindow():this.getPrepareWindow();if(!win)return;
    const current=win.getBounds();const proposed={...current,x:Math.round(x),y:Math.round(y)};
    const clamped=clampBoundsToDisplay(proposed,screen.getDisplayMatching(proposed).workArea);
    if(current.x!==clamped.x||current.y!==clamped.y){win.setPosition(clamped.x,clamped.y,false);if(target==='overlay'){this.rememberOverlayBounds();}}
  }

  setOpacity(opacity:number):void {
    if(!Number.isFinite(opacity)||opacity<0||opacity>1)throw new Error('INVALID_OPACITY');
    this.opacity=opacity;
    this.getOverlayWindow()?.setOpacity(opacity);
    this.getPrepareWindow()?.setOpacity(opacity===0?1:opacity);
  }

  setMouseIgnoring(ignore:boolean,passive=ignore):void {this.mouseIgnoring=ignore;this.mousePassive=passive;const win=this.getOverlayWindow();if(win)this.applyMousePolicy(win);}
  private applyMousePolicy(win:BrowserWindow):void {
    if(win.isDestroyed())return;
    const previous=this.mousePolicies.get(win);
    if(!previous||previous.ignore!==this.mouseIgnoring)win.setIgnoreMouseEvents(this.mouseIgnoring,{forward:true});
    // Keep native focusability fixed. Changing only mouse hit testing avoids
    // activation/ordering transitions; showInactive preserves passive restoration.
    this.mousePolicies.set(win,{ignore:this.mouseIgnoring});
  }

  private showOverlay(win:BrowserWindow):void {if(win.isMinimized())win.restore();if(this.mousePassive)win.showInactive();else{win.show();win.focus();}}

  setContentProtection(enable: boolean): void {
    this.isProtected = enable;
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.applyPolicy(this.overlayWindow, 'overlay');
    }
  }

  toggleExpand(): boolean {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return this.isExpanded;
    const currentBounds = this.overlayWindow.getBounds();
    this.rememberOverlayBounds();
    const nextBounds = this.isExpanded?{...currentBounds,width:320,height:64}:{...currentBounds,...this.expandedSize()};

    const display = screen.getDisplayMatching(currentBounds).workArea;
    const clamped = clampBoundsToDisplay(nextBounds, display);

    this.isExpanded = !this.isExpanded;
    this.overlayWindow.setBounds(clamped);
    this.rememberOverlayBounds();
    return this.isExpanded;
  }

  registerShortcut(accelerator: string, action: () => void): boolean {
    try {
      if (globalShortcut.isRegistered(accelerator)) {
        return false;
      }
      const ok = globalShortcut.register(accelerator, action);
      if (ok) {
        this.registeredShortcuts.add(accelerator);
      }
      return ok;
    } catch {
      return false;
    }
  }

  unregisterShortcut(accelerator: string): void {
    if (this.registeredShortcuts.has(accelerator)) {
      globalShortcut.unregister(accelerator);
      this.registeredShortcuts.delete(accelerator);
    }
  }

  unregisterAllShortcuts(): void {
    globalShortcut.unregisterAll();
    this.registeredShortcuts.clear();
  }

  private bindLifecycle(window:BrowserWindow,mode:'prepare'|'overlay'):void {
    window.once('closed',()=>{
      // Native macOS visibility events may arrive after destruction. Electron's
      // built-in visibility listener calls isVisible() without a destroyed guard.
      // A terminal window must no longer handle these or our ready-to-show callback.
      for(const event of ['show','hide','minimize','maximize','restore','ready-to-show']) {
        window.removeAllListeners(event);
      }
      if(mode==='prepare' && this.prepareWindow===window)this.prepareWindow=null;
      if(mode==='overlay' && this.overlayWindow===window)this.overlayWindow=null;
    });
  }

  private applyPolicy(window: BrowserWindow, mode: 'prepare' | 'overlay'): void {
    if(window.isDestroyed())return;
    const policy = windowPolicy(mode, this.isProtected);
    window.setAlwaysOnTop(policy.top, 'floating');
    window.setVisibleOnAllWorkspaces(policy.allWorkspaces, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.setContentProtection(policy.protected);
    window.setOpacity(mode==='prepare'&&this.opacity===0?1:this.opacity);
    if(mode==='overlay')this.applyMousePolicy(window);
  }

  private loadUrl(window: BrowserWindow, page: 'prepare' | 'overlay'): void {
    const loading=this.options.rendererUrl
      ? window.loadURL(`${this.options.rendererUrl}#/${page}`)
      : this.options.rendererHtmlPath?window.loadFile(this.options.rendererHtmlPath,{hash:`/${page}`}):null;
    void loading?.catch(error=>{
      // Closing a window while it loads is an expected cancellation.
      if(window.isDestroyed()||error.code==='ERR_ABORTED')return;
      console.warn('Unable to load assistant window:',error.message);
    });
  }
}
