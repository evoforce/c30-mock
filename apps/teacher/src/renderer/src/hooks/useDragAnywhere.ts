import { useCallback, useRef } from 'react';

// 浮层「整块任意位置可拖」的 hook。
//
// 背景:之前拖动只能按住浮层边缘/手柄(按钮区域被排除),老师反馈「只有边边能拖」。
// 这里改成:在浮层上任意位置按下都能拖 —— 包括按钮上。
//   · 按住后位移 < threshold(=点击)→ 松手照常触发按钮点击;
//   · 位移 ≥ threshold(=拖动)→ 整块浮层跟着走,并吞掉松手后那一次 click,
//     不会「拖完顺手点开一个功能」。
//
// 用法:把返回的 onPointerDown / onClickCapture 挂到浮层容器上。
//   onPointerDown   启动拖动判定(不 preventDefault,保证普通点击不受影响);
//   onClickCapture  捕获阶段拦截拖动结束时的那一次 click。
//
// axis: 'x' 只水平 / 'y' 只垂直(浮层要么左右贴边竖排,要么贴底横排)。
// onMove 收到的是浮层「左上角」应处的位置(视口坐标),由调用方夹进屏幕内。

export function useDragAnywhere(
  axis: 'x' | 'y',
  onMove: (pos: { x: number; y: number }) => void,
  threshold = 5,
) {
  // 拖动刚结束、需要吞掉一次 click 的标记
  const suppressClickRef = useRef(false);
  // 兜底解锁:拖动结束但没产生 click 时,别让标记一直挂着把下一次点击也吞掉
  const unlockTimerRef = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // 输入类控件上不启动拖动:保留光标定位 / 输入法 / 选区
      if (target.closest('input, textarea, select')) return;

      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const originX = rect.left;
      const originY = rect.top;
      const startX = e.clientX;
      const startY = e.clientY;

      if (unlockTimerRef.current != null) {
        window.clearTimeout(unlockTimerRef.current);
        unlockTimerRef.current = null;
      }
      suppressClickRef.current = false;
      let moved = false;

      const onMoveEv = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved) {
          if (Math.hypot(dx, dy) < threshold) return; // 小抖动仍算点击
          moved = true;
          suppressClickRef.current = true;
        }
        // 已判定为拖动:阻止拖动过程中的文字选区等默认行为
        ev.preventDefault();
        onMove({
          x: axis === 'y' ? originX : originX + dx,
          y: axis === 'x' ? originY : originY + dy,
        });
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMoveEv);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (!moved) {
          suppressClickRef.current = false;
          return;
        }
        // 松手后立刻会派发一次 click:吃掉它;若没有 click,350ms 后自动解锁
        unlockTimerRef.current = window.setTimeout(() => {
          suppressClickRef.current = false;
          unlockTimerRef.current = null;
        }, 350);
      };

      window.addEventListener('pointermove', onMoveEv);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [axis, onMove, threshold],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  }, []);

  return { onPointerDown, onClickCapture };
}
