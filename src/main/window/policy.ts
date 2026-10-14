export interface WindowPolicy {
  top: boolean;
  allWorkspaces: boolean;
  protected: boolean;
}

export function windowPolicy(mode: 'prepare' | 'overlay', protectedContent: boolean): WindowPolicy {
  return {
    top: mode === 'overlay',
    allWorkspaces: mode === 'overlay',
    protected: protectedContent
  };
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampBoundsToDisplay(bounds: Bounds, display: DisplayArea): Bounds {
  const width = Math.min(bounds.width, display.width);
  const height = Math.min(bounds.height, display.height);

  let x = bounds.x;
  let y = bounds.y;

  if (x < display.x) x = display.x;
  if (x + width > display.x + display.width) x = display.x + display.width - width;

  if (y < display.y) y = display.y;
  if (y + height > display.y + display.height) y = display.y + display.height - height;

  return { x, y, width, height };
}

export function computeToggleBounds(
  isExpanded: boolean,
  currentBounds: Bounds,
  collapsedSize = { width: 320, height: 80 },
  expandedSize = { width: 420, height: 480 }
): Bounds {
  if (isExpanded) {
    return {
      x: currentBounds.x,
      y: currentBounds.y,
      width: collapsedSize.width,
      height: collapsedSize.height
    };
  } else {
    return {
      x: currentBounds.x,
      y: currentBounds.y,
      width: expandedSize.width,
      height: expandedSize.height
    };
  }
}
