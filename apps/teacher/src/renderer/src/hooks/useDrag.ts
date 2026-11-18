import { useCallback, useRef } from 'react';

// 拖拽 hook：返回 onPointerDown 处理器，用于拖动悬浮组件。
// axis: 'free' 自由移动 / 'x' 仅水平 / 'y' 仅垂直。
// onMove 回调返回新坐标（相对视口），由调用方 setState。
export interface DragPos {
  x: number;
  y: number;
}

export function useDrag(
  axis: 'free' | 'x' | 'y',
  onMove: (pos: DragPos) => void,
) {
  const startRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // 只响应主键，且不拦截内部按钮/输入框的点击
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, textarea, select, a')) return;

      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const originX = (e.currentTarget as HTMLElement).getBoundingClientRect().left;
      const originY = (e.currentTarget as HTMLElement).getBoundingClientRect().top;

      startRef.current = { sx: startX, sy: startY, ox: originX, oy: originY };

      const handleMove = (ev: PointerEvent) => {
        const s = startRef.current;
        if (!s) return;
        const dx = ev.clientX - s.sx;
        const dy = ev.clientY - s.sy;
        onMove({
          x: axis === 'y' ? s.ox : s.ox + dx,
          y: axis === 'x' ? s.oy : s.oy + dy,
        });
      };
      const handleUp = () => {
        startRef.current = null;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [axis, onMove],
  );

  return onPointerDown;
}
