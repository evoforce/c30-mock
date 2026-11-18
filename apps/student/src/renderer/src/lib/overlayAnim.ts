import type { CSSProperties } from 'react';

// 浮层入场动画:按浮层贴的屏幕边决定「从屏幕外哪个方向往里滑入」,并叠加淡入。
// 见 src/styles/global.css 里的 overlay-in-* keyframes。
//
// 关键:用独立的 `translate` 属性(而不是 transform)做位移,
// 所以不会覆盖浮层自己用来贴边/垂直居中的 transform。
//
// 用法:
//   <div data-overlay-anim style={{ ...base, ...overlayIn('right') }} />
// 需要「每次展开都重播」时,给同一节点加 key(例如 key={openSide})强制重挂载。

export type OverlayInDirection = 'left' | 'right' | 'up' | 'down' | 'fade';

/**
 * @param direction 滑入方向:'left' 从左边滑入 / 'right' 从右边滑入 /
 *                  'up' 从下方滑入 / 'down' 从上方滑入 / 'fade' 原地淡入 + 轻微上浮
 * @param durationMs 时长(默认 180ms)
 */
export function overlayIn(direction: OverlayInDirection, durationMs = 180): CSSProperties {
  const name = direction === 'fade' ? 'overlay-fade-in' : `overlay-in-${direction}`;
  return { animation: `${name} ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1) both` };
}

/** 浮层贴在哪一侧 → 应该从哪一侧滑入(贴右从右进、贴左从左进、贴底从下进) */
export function overlayInFromSide(side: 'left' | 'right' | 'bottom' | 'top'): OverlayInDirection {
  switch (side) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'bottom':
      return 'up';
    default:
      return 'down';
  }
}
