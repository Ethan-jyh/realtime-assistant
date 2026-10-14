import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';

const electron = vi.hoisted(() => {
  const image = { resize: vi.fn(), setTemplateImage: vi.fn() };
  image.resize.mockReturnValue(image);
  class FakeTray {
    static instances: FakeTray[] = [];
    destroyed = false;
    template: MenuItemConstructorOptions[] = [];
    setToolTip = vi.fn();
    setContextMenu = vi.fn((menu: MenuItemConstructorOptions[]) => { this.template = menu; });
    destroy = vi.fn(() => { this.destroyed = true; });
    isDestroyed() { return this.destroyed; }
    constructor(public icon: unknown) { FakeTray.instances.push(this); }
  }
  return { image, FakeTray, createFromPath: vi.fn(() => image) };
});
vi.mock('electron', () => ({
  Tray: electron.FakeTray,
  nativeImage: { createFromPath: electron.createFromPath },
  Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => template }
}));
import { DesktopMenu, type DesktopMenuState, type DesktopMenuAction } from '../src/main/window/desktop-menu';

function setup(onAction: (action: DesktopMenuAction) => void | Promise<void> = vi.fn()) {
  const state: DesktopMenuState = { running: true, audioEnabled: true, paused: false, mouseThrough: false };
  const onError = vi.fn();
  const menu = new DesktopMenu({ iconPath: '/resource/tray.png', getState: () => state, onAction, onError });
  const tray = electron.FakeTray.instances.at(-1)!;
  const item = (id: DesktopMenuAction) => tray.template.find(entry => entry.id === id)!;
  const click = (id: DesktopMenuAction) => item(id).click?.(undefined as never, undefined as never, undefined as never);
  return { state, menu, tray, item, click, onError };
}
beforeEach(() => { electron.FakeTray.instances.length = 0; vi.clearAllMocks(); });

describe('desktop menu', () => {
  it('publishes all actions on a branded native menu with a template 18 DIP icon', () => {
    const { tray } = setup();
    expect(electron.createFromPath).toHaveBeenCalledWith('/resource/tray.png');
    expect(electron.image.resize).toHaveBeenCalledWith({ width: 18, height: 18 });
    expect(electron.image.setTemplateImage).toHaveBeenCalledWith(true);
    expect(tray.setToolTip).toHaveBeenCalledWith('企业微信私有版');
    expect(tray.template).toHaveLength(4);
    expect(tray.template.filter(item => item.id).map(item => [item.id, item.label])).toEqual([
      ['show', '显示'], ['hide', '隐藏'], ['settings', '设置'], ['quit', '退出']
    ]);
    expect(tray.setContextMenu).toHaveBeenCalledTimes(1);
  });

  it('disables all four actions while busy', () => {
    const {state,menu,tray}=setup();state.busy=true;menu.refresh();
    expect(tray.template.every(item=>item.enabled===false)).toBe(true);
  });

  it('routes each action once and refreshes the resulting state', async () => {
    const seen: DesktopMenuAction[] = [];
    const { state, item, click } = setup(action => { seen.push(action); state.paused = true; });
    for (const action of ['show', 'hide', 'settings', 'quit'] as const) {
      click(action); await Promise.resolve(); await Promise.resolve();
    }
    expect(seen).toEqual(['show', 'hide', 'settings', 'quit']);
    expect(item('show').enabled).toBe(true);
  });

  it('blocks duplicate and stale clicks while an asynchronous action is pending', async () => {
    let resolve!: () => void;
    const actions: DesktopMenuAction[] = [];
    const { click, item } = setup(action => { actions.push(action); return new Promise<void>(done => { resolve = done; }); });
    const staleClick = item('show').click!;
    click('show'); staleClick(undefined as never, undefined as never, undefined as never); click('show');
    expect(actions).toEqual(['show']);
    expect(item('show').enabled).toBe(false);
    resolve(); await Promise.resolve(); await Promise.resolve();
    expect(item('show').enabled).toBe(true);
  });

  it('rechecks busy state when an old menu item is invoked', () => {
    const actions: DesktopMenuAction[] = [];
    const { state, click } = setup(action => { actions.push(action); });
    state.busy = true;
    click('show');
    expect(actions).toEqual([]);
  });

  it.each(['sync', 'async'] as const)('reports %s action failure and unlocks the menu', async kind => {
    const failure = new Error('action failed');
    const { click, item, onError } = setup(() => { if (kind === 'sync') throw failure; return Promise.reject(failure); });
    click('settings'); await Promise.resolve(); await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(item('show').enabled).toBe(true);
  });

  it('destroys the tray once and ignores refresh or stale actions afterward', async () => {
    let resolve!: () => void;
    const { menu, tray, click, item } = setup(() => new Promise<void>(done => { resolve = done; }));
    const staleClick = item('show').click!;
    click('settings'); menu.destroy(); menu.destroy(); menu.refresh();
    resolve(); await Promise.resolve(); await Promise.resolve();
    staleClick(undefined as never, undefined as never, undefined as never);
    expect(tray.destroy).toHaveBeenCalledTimes(1);
    expect(tray.setContextMenu).toHaveBeenCalledTimes(2);
  });
});
