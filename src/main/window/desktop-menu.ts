import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';

export type DesktopMenuAction = 'show' | 'hide' | 'settings' | 'quit';

export interface DesktopMenuState {
  running: boolean;
  audioEnabled: boolean;
  paused: boolean;
  mouseThrough: boolean;
  busy?: boolean;
}

export interface DesktopMenuOptions {
  iconPath: string;
  getState: () => DesktopMenuState;
  onAction: (action: DesktopMenuAction) => void | Promise<void>;
  onError: (error: unknown) => void;
}

/** Owns the native status item; app/session behavior remains in the main process. */
export class DesktopMenu {
  readonly tray: Tray;
  private destroyed = false;
  private pending = false;

  constructor(private readonly options: DesktopMenuOptions) {
    const icon = nativeImage.createFromPath(options.iconPath).resize({ width: 18, height: 18 });
    icon.setTemplateImage(true);
    this.tray = new Tray(icon);
    this.tray.setToolTip('企业微信私有版');
    this.refresh();
  }

  refresh(): void {
    if (this.destroyed || this.tray.isDestroyed()) return;
    const state = this.options.getState();
    const available = !this.pending && !state.busy;
    const action = (id: DesktopMenuAction, label: string, enabled = available): MenuItemConstructorOptions => ({
      id, label, enabled, click: () => { void this.dispatch(id); }
    });
    const template: MenuItemConstructorOptions[] = [
      action('show', '显示'), action('hide', '隐藏'),
      action('settings', '设置'), action('quit', '退出')
    ];
    // On macOS setContextMenu supplies the native dropdown for the status item click.
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (!this.tray.isDestroyed()) this.tray.destroy();
  }

  private async dispatch(action: DesktopMenuAction): Promise<void> {
    if (this.destroyed || this.tray.isDestroyed() || this.pending) return;
    try {
      const state = this.options.getState();
      if (state.busy) return;
      this.pending = true;
      this.refresh();
      await this.options.onAction(action);
    } catch (error) {
      this.reportError(error);
    } finally {
      this.pending = false;
      try { this.refresh(); } catch (error) { this.reportError(error); }
    }
  }

  private reportError(error: unknown): void {
    // A failing diagnostics callback must not turn a menu click into an unhandled rejection.
    try { this.options.onError(error); } catch { /* The callback owns its diagnostics. */ }
  }
}
