import { expect, test } from 'vitest';
import {
  windowPolicy,
  clampBoundsToDisplay,
  computeToggleBounds
} from '../src/main/window/policy';

test('浮窗保持置顶且保护状态独立', () => {
  expect(windowPolicy('overlay', true)).toEqual({ top: true, allWorkspaces: true, protected: true });
  expect(windowPolicy('overlay', false).top).toBe(true);
  expect(windowPolicy('prepare', true).top).toBe(false);
});

test('窗口边界被限制在屏幕可见工作区内', () => {
  const display = { x: 0, y: 0, width: 1440, height: 900 };

  // 超出右下角边界
  const clamped1 = clampBoundsToDisplay({ x: 1400, y: 850, width: 400, height: 400 }, display);
  expect(clamped1).toEqual({ x: 1040, y: 500, width: 400, height: 400 });

  // 超出左上角边界
  const clamped2 = clampBoundsToDisplay({ x: -100, y: -50, width: 300, height: 200 }, display);
  expect(clamped2).toEqual({ x: 0, y: 0, width: 300, height: 200 });

  // 正常范围内不变
  const normal = clampBoundsToDisplay({ x: 100, y: 100, width: 300, height: 200 }, display);
  expect(normal).toEqual({ x: 100, y: 100, width: 300, height: 200 });
});

test('展开/收起切换只改变尺寸并保留坐标', () => {
  const current = { x: 500, y: 200, width: 420, height: 480 };

  // 从展开 -> 收起
  const collapsed = computeToggleBounds(true, current);
  expect(collapsed).toEqual({ x: 500, y: 200, width: 320, height: 80 });

  // 从收起 -> 展开
  const expanded = computeToggleBounds(false, collapsed);
  expect(expanded).toEqual({ x: 500, y: 200, width: 420, height: 480 });
});
